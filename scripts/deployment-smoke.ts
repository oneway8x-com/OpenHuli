import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  appendFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLocalDeployment } from "./deployment-local.ts";

// Destructive cleanup is permitted only against a local daemon and smoke-owned projects.
try {
  const local = (endpoint: string) =>
    endpoint.startsWith("unix://") || endpoint.startsWith("npipe://");
  if (process.env.DOCKER_HOST && !local(process.env.DOCKER_HOST))
    throw new Error();
  const endpoint = execFileSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8", timeout: 10000 },
  ).trim();
  if (!local(endpoint)) throw new Error();
  execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    stdio: "ignore",
    timeout: 10000,
  });
} catch {
  console.error(
    "Deployment smoke requires a responsive local Docker daemon; remote contexts are refused",
  );
  process.exit(1);
}

// Opt-in: creates/removes only unique smoke-owned projects and directories. Never uses an operator .env.
const parent = mkdtempSync(join(tmpdir(), "openhuli-stack-smoke-"));
const project = `openhuli-smoke-${process.pid}`;
const restored = `${project}-restore`;
const root = createLocalDeployment(join(parent, "local"));
const env = join(root, "stack.env");
chmodSync(join(root, "secrets", "email_api_key"), 0o600);
chmodSync(join(root, "secrets", "gemini_api_key"), 0o600);
writeFileSync(
  join(root, "secrets", "email_api_key"),
  "synthetic-unused-email-key",
);
writeFileSync(
  join(root, "secrets", "gemini_api_key"),
  "synthetic-unused-provider-key",
);
chmodSync(join(root, "secrets", "email_api_key"), 0o444);
chmodSync(join(root, "secrets", "gemini_api_key"), 0o444);
appendFileSync(
  env,
  `\nCOMPOSE_PROJECT_NAME=${project}\nRUNTIME_VOICE_ENABLED=true\n`,
);
const args = ["compose", "--env-file", env, "-f", "docker-compose.deploy.yml"];
function compose(command: string[], input?: string) {
  return execFileSync("docker", [...args, ...command], {
    encoding: "utf8",
    timeout: command.includes("down") ? 30000 : 600000,
    maxBuffer: 4 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
    stdio: ["pipe", "pipe", "pipe"],
  });
}
const sql = (query: string, target = project) =>
  compose([
    "-p",
    target,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "openhuli",
    "-d",
    "openhuli",
    "-Atc",
    query,
  ]);
const curl = (host: string, path: string, statusOnly = false) =>
  execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "10",
      "--cacert",
      join(root, "tls", "ca.crt"),
      "--resolve",
      `${host}:8443:127.0.0.1`,
      ...(statusOnly ? ["-o", "/dev/null", "-w", "%{http_code}"] : ["--fail"]),
      `https://${host}:8443${path}`,
    ],
    { encoding: "utf8" },
  );
try {
  compose(["up", "-d", "--build", "--wait", "--wait-timeout", "180"]);
  assert.match(curl("openhuli.localhost", "/login"), /<html/i);
  assert.equal(
    JSON.parse(curl("runtime.openhuli.localhost", "/health/ready")).ready,
    true,
  );
  assert.equal(curl("runtime.openhuli.localhost", "/auth", true), "404");
  const websocketStatus = execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "5",
      "--cacert",
      join(root, "tls", "ca.crt"),
      "--resolve",
      "runtime.openhuli.localhost:8443:127.0.0.1",
      "--http1.1",
      "-H",
      "Connection: Upgrade",
      "-H",
      "Upgrade: websocket",
      "-H",
      "Sec-WebSocket-Version: 13",
      "-H",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "https://runtime.openhuli.localhost:8443/voice",
    ],
    { encoding: "utf8" },
  );
  assert.equal(websocketStatus, "401"); // Authenticated WSS boundary, no provider session or paid request.
  assert.throws(() =>
    execFileSync(
      "curl",
      [
        "--silent",
        "--max-time",
        "5",
        "--resolve",
        "openhuli.localhost:8443:127.0.0.1",
        "https://openhuli.localhost:8443/login",
      ],
      { stdio: "ignore" },
    ),
  );
  for (const extra of [
    "-h mqtt.openhuli.localhost --cafile /run/secrets/tls_ca -u invalid -P invalid",
    "-h mqtt --cafile /run/secrets/tls_ca -u invalid -P invalid",
    "-h mqtt.openhuli.localhost --cafile /etc/ssl/certs/ca-certificates.crt -u invalid -P invalid",
  ])
    assert.throws(() =>
      compose([
        "exec",
        "-T",
        "mqtt",
        "/bin/sh",
        "-c",
        `exec mosquitto_sub ${extra} -p 8883 -V mqttv5 -E -W 3 -i openhuli-negative -t 'openhuli/v1/devices/+/telemetry'`,
      ]),
    );
  // Broker's own healthcheck verifies a successful authenticated TLS SUBACK.
  compose(["exec", "-T", "mqtt", "/bin/sh", "/deployment/broker-health.sh"]);
  const denied = compose([
    "exec",
    "-T",
    "mqtt",
    "/bin/sh",
    "-c",
    'exec mosquitto_sub -h "$OPENHULI_MQTT_HOST" -p 8883 --cafile /run/secrets/tls_ca -V mqttv5 -d -E -W 3 -i openhuli-denied -u openhuli-runtime -P "$(cat /run/secrets/mqtt_password)" -t "#"',
  ]);
  const suback = /^Subscribed \(mid: \d+\): (\d+)$/m.exec(denied);
  assert.ok(suback, "Denied subscription must receive a SUBACK");
  assert.ok(
    Number(suback[1]) >= 128 && Number(suback[1]) <= 255,
    "Wildcard SUBACK must deny access",
  );
  compose(["run", "--rm", "--no-deps", "bootstrap"]);
  sql(`INSERT INTO "AgentRun" (id,"tenantId",status,"updatedAt") SELECT 'smoke-run',id,'closed',now() FROM "Tenant" LIMIT 1;
    INSERT INTO "ToolExecution" (id,"tenantId","runId","toolCallId","toolName","inputJson",status,effect) SELECT 'smoke-write',"tenantId",id,'smoke-call','notes.create','{}','unknown','write' FROM "AgentRun" WHERE id='smoke-run';`);
  compose(["restart", "postgres", "runtime", "mqtt"]);
  compose([
    "up",
    "-d",
    "--no-deps",
    "--wait",
    "--wait-timeout",
    "120",
    "app",
    "runtime",
    "mqtt",
  ]);
  assert.equal(
    sql(`SELECT status FROM "ToolExecution" WHERE id='smoke-write'`).trim(),
    "unknown",
  );
  compose(["stop", "mqtt"]);
  // Dependency loss must surface; a live HTTP process is not readiness.
  let unavailable = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (curl("runtime.openhuli.localhost", "/health/ready", true) === "503") {
      unavailable = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(unavailable);
  compose([
    "up",
    "-d",
    "--no-deps",
    "--wait",
    "--wait-timeout",
    "120",
    "mqtt",
    "runtime",
  ]);
  const backup = join(parent, "backup");
  execFileSync("sh", ["docker/deploy/backup.sh", env, backup], {
    stdio: "pipe",
    timeout: 120000,
  });
  execFileSync("sh", ["docker/deploy/restore.sh", env, backup], {
    env: { ...process.env, COMPOSE_PROJECT_NAME: restored },
    stdio: "pipe",
    timeout: 120000,
  });
  assert.equal(
    sql(
      `SELECT status FROM "ToolExecution" WHERE id='smoke-write'`,
      restored,
    ).trim(),
    "unknown",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "ToolExecution" WHERE "toolCallId"='smoke-call'`,
      restored,
    ).trim(),
    "1",
  );
  assert.throws(() =>
    execFileSync("sh", ["docker/deploy/restore.sh", env, backup], {
      env: { ...process.env, COMPOSE_PROJECT_NAME: restored },
      stdio: "pipe",
      timeout: 15000,
    }),
  );
  console.log(
    "Deployment smoke passed: HTTPS/WSS auth boundary, MQTT TLS/auth/ACL, dependency failure, restart, backup, isolated restore, preserved unknown write identity. No live provider call or hardware acceptance.",
  );
} catch (error) {
  // This suite creates its own synthetic secrets; redact even those before sharing failure evidence.
  const redact = (value: string) => {
    let safe = value;
    for (const file of readdirSync(join(root, "secrets"))) {
      const secret = readFileSync(join(root, "secrets", file), "utf8").trim();
      if (secret) safe = safe.replaceAll(secret, "[redacted]");
    }
    return safe.slice(-16000);
  };
  if (error instanceof Error) console.error(redact(error.message));
  if (error && typeof error === "object") {
    for (const key of ["stderr", "stdout"]) {
      const value: unknown = Object.getOwnPropertyDescriptor(error, key)?.value;
      if (Buffer.isBuffer(value) || typeof value === "string")
        console.error(redact(value.toString()));
    }
  }
  try {
    console.error(redact(compose(["ps"])));
    console.error(
      redact(
        compose([
          "logs",
          "--no-color",
          "--tail",
          "50",
          "app",
          "runtime",
          "mqtt",
          "migrate",
        ]),
      ),
    );
  } catch {
    console.error("Smoke-owned container diagnostics unavailable");
  }
  console.error(
    "Deployment smoke failed; diagnostics above are from disposable synthetic services only.",
  );
  process.exitCode = 1;
} finally {
  // Fixed unique project names: never prune Docker or remove unrelated volumes.
  for (const name of [restored, project]) {
    try {
      compose(["-p", name, "down", "--volumes", "--remove-orphans"]);
    } catch {
      console.error(
        `Smoke cleanup incomplete for ${name}; inspect this project explicitly.`,
      );
      process.exitCode = 1;
    }
  }
  rmSync(resolve(parent), { recursive: true, force: true });
}
