import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const rejectedSockets: Socket[] = [];
const children: { child: ChildProcess; exited: Promise<number | null> }[] = [];
function launch(env: NodeJS.ProcessEnv = {}) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/runtime/src/main.ts"],
    {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: "test",
        RUNTIME_VOICE_ENABLED: "false",
        TSX_TSCONFIG_PATH: fileURLToPath(
          new URL("../../tsconfig.test.json", import.meta.url),
        ),
        RUNTIME_PORT: "0",
        RUNTIME_HOST: "127.0.0.1",
        RUNTIME_PROBE_TOKEN: "",
        RUNTIME_MQTT_URL: "",
        RUNTIME_MQTT_USERNAME: "",
        RUNTIME_MQTT_PASSWORD: "",
        RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        RUNTIME_SHUTDOWN_TIMEOUT_MS: "5000",
        RUNTIME_IDLE_TIMEOUT_MS: "30000",
        RUNTIME_MAX_CONNECTIONS: "100",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  const result = { child, exited, output: () => ({ stdout, stderr }) };
  children.push(result);
  return result;
}
async function started(process: ReturnType<typeof launch>): Promise<number> {
  await vi.waitFor(
    () => expect(process.output().stdout).toContain('"runtime.started"'),
    { timeout: 5000 },
  );
  const line = process
    .output()
    .stdout.split("\n")
    .find((text) => text.includes('"runtime.started"'));
  if (!line) throw new Error("No startup event");
  return z.object({ port: z.number() }).parse(JSON.parse(line)).port;
}
afterEach(async () => {
  for (const socket of rejectedSockets.splice(0)) socket.destroy();
  for (const { child, exited } of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await exited;
  }
});

describe("runtime process entrypoint", () => {
  it("handles SIGTERM and SIGINT and can reload on the released port", async () => {
    const first = launch();
    const port = await started(first);
    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(
      200,
    );
    // A rejected upgrade must not leave an untracked half-open socket in the process.
    const rejected = connect({ host: "127.0.0.1", port, allowHalfOpen: true });
    rejectedSockets.push(rejected);
    await once(rejected, "connect");
    const ended = once(rejected, "end");
    rejected.resume();
    rejected.write(
      "GET /voice HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    await ended;
    first.child.kill("SIGTERM");
    expect(await first.exited).toBe(0);
    const replacement = launch({ RUNTIME_PORT: String(port) });
    expect(await started(replacement)).toBe(port);
    replacement.child.kill("SIGINT");
    expect(await replacement.exited).toBe(0);
  });
  it("fails invalid startup with setting names and no secret-bearing values", async () => {
    const secret = "synthetic_only_do_not_print_1234567890";
    const process = launch({
      RUNTIME_MQTT_URL: `mqtts://owner:${secret}@broker.example.com`,
    });
    expect(await process.exited).toBe(1);
    expect(process.output().stderr).toContain("RUNTIME_MQTT_URL");
    expect(process.output().stderr).not.toContain(secret);
    expect(process.output().stderr).not.toContain("broker.example.com");
    expect(process.output().stdout).not.toContain("runtime.started");
  });
});
