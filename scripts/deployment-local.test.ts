import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLocalDeployment } from "./deployment-local.ts";

test("local deployment uses new private directories, unique secrets, verified SANs and no provider key", () => {
  const parent = mkdtempSync(join(tmpdir(), "openhuli-deployment-test-"));
  try {
    const directory = createLocalDeployment(join(parent, "local"));
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.throws(() => createLocalDeployment(directory));
    const secrets = [
      "postgres_password",
      "jwt_secret",
      "mqtt_password",
      "mqtt_auth_token",
    ].map((name) => readFileSync(join(directory, "secrets", name), "utf8"));
    assert.equal(new Set(secrets).size, secrets.length);
    assert.ok(secrets.every((secret) => /^[a-f0-9]{64}$/.test(secret)));
    assert.equal(
      readFileSync(join(directory, "secrets", "gemini_api_key"), "utf8"),
      "",
    );
    for (const host of [
      "openhuli.localhost",
      "runtime.openhuli.localhost",
      "mqtt.openhuli.localhost",
    ])
      execFileSync(
        "openssl",
        [
          "verify",
          "-CAfile",
          join(directory, "tls", "ca.crt"),
          "-verify_hostname",
          host,
          join(directory, "tls", "server.crt"),
        ],
        { stdio: "ignore" },
      );
    assert.throws(() =>
      execFileSync(
        "openssl",
        [
          "verify",
          "-CAfile",
          join(directory, "tls", "ca.crt"),
          "-verify_hostname",
          "wrong.example.test",
          join(directory, "tls", "server.crt"),
        ],
        { stdio: "ignore" },
      ),
    );
    assert.equal(
      statSync(join(directory, "tls", "ca.key")).mode & 0o777,
      0o600,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rendered deployment keeps database/app/bridge private and only publishes TLS entry points", (t) => {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  } catch {
    t.skip(
      "Docker Compose CLI unavailable; deployment CI renders and exercises this configuration",
    );
    return;
  }
  const rendered: unknown = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "docker/deploy/stack.env.example",
        "-f",
        "docker-compose.deploy.yml",
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", timeout: 10000 },
    ),
  );
  // Validate only the security invariants, not a snapshot of the Compose implementation.
  assert.ok(
    rendered &&
      typeof rendered === "object" &&
      "services" in rendered &&
      "networks" in rendered,
  );
  const { services, networks } = rendered;
  assert.ok(
    services &&
      typeof services === "object" &&
      networks &&
      typeof networks === "object",
  );
  for (const name of ["postgres", "app", "runtime"]) {
    assert.ok(name in services);
    const service: unknown = Object.getOwnPropertyDescriptor(
      services,
      name,
    )?.value;
    assert.ok(service && typeof service === "object");
    assert.ok(!("ports" in service));
  }
  for (const name of ["mqtt", "proxy"]) {
    const service: unknown = Object.getOwnPropertyDescriptor(
      services,
      name,
    )?.value;
    assert.ok(
      service &&
        typeof service === "object" &&
        "ports" in service &&
        Array.isArray(service.ports),
    );
    assert.ok(
      service.ports.every(
        (port: unknown) =>
          typeof port === "object" &&
          port !== null &&
          "host_ip" in port &&
          port.host_ip === "127.0.0.1",
      ),
    );
  }
  const privateNetwork: unknown = Object.getOwnPropertyDescriptor(
    networks,
    "private",
  )?.value;
  assert.ok(
    privateNetwork &&
      typeof privateNetwork === "object" &&
      "internal" in privateNetwork &&
      privateNetwork.internal === true,
  );
});

test("deployment smoke refuses a remote Docker endpoint before creating resources", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/deployment-smoke.ts"],
        {
          env: {
            ...process.env,
            DOCKER_HOST: "ssh://synthetic-remote.invalid",
          },
          encoding: "utf8",
          timeout: 10000,
        },
      ),
    /responsive local Docker daemon/,
  );
});

test("container secret failures return fixed diagnostics without secret values or file paths", () => {
  const parent = mkdtempSync(join(tmpdir(), "openhuli-entrypoint-test-"));
  try {
    const secret = join(parent, "database-secret");
    const value = "sensitive-value-that-must-not-appear@";
    writeFileSync(secret, value, { mode: 0o600 });
    for (const file of [secret, join(parent, "absent-private-file")]) {
      try {
        execFileSync(
          process.execPath,
          ["docker/deploy/entrypoint.mjs", "runtime"],
          {
            env: { ...process.env, POSTGRES_PASSWORD_FILE: file },
            stdio: "pipe",
          },
        );
        assert.fail("Invalid secret must fail before starting runtime");
      } catch (error) {
        assert.ok(
          error &&
            typeof error === "object" &&
            "stderr" in error &&
            Buffer.isBuffer(error.stderr),
        );
        const diagnostic = error.stderr.toString();
        assert.match(
          diagnostic,
          /Deployment secret files are missing or invalid/,
        );
        assert.ok(!diagnostic.includes(value) && !diagnostic.includes(parent));
      }
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("broker health requires an allowed SUBACK even when a denied client exits zero", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhuli-suback-test-"));
  try {
    mkdirSync(join(directory, "bin"));
    writeFileSync(
      join(directory, "bin", "cat"),
      "#!/bin/sh\nprintf synthetic-password\n",
      { mode: 0o755 },
    );
    writeFileSync(
      join(directory, "bin", "mosquitto_sub"),
      '#!/bin/sh\nprintf "%s\\n" "$SUBACK_TEST_OUTPUT"\nexit "${SUBACK_TEST_STATUS:-0}"\n',
      { mode: 0o755 },
    );
    const check = (output: string, status = "0") =>
      execFileSync("sh", ["docker/deploy/broker-health.sh"], {
        env: {
          ...process.env,
          PATH: `${join(directory, "bin")}:${process.env.PATH}`,
          OPENHULI_MQTT_HOST: "synthetic.invalid",
          SUBACK_TEST_OUTPUT: output,
          SUBACK_TEST_STATUS: status,
        },
        stdio: "pipe",
      });
    check("Subscribed (mid: 1): 0");
    for (const code of [128, 135])
      assert.throws(() => check(`Subscribed (mid: 1): ${code}`));
    assert.throws(() => check("No acknowledgement"));
    assert.throws(() => check("Subscribed (mid: 1): 0", "1"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
