import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
