import { createServer } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { readRuntimeConfig } from "../config";
import { createRuntime } from "../runtime";
import type { RuntimeDependency } from "../ports";

const token = "synthetic_probe_token_12345678901234567890";
const runtimes: ReturnType<typeof createRuntime>[] = [];
const clients: WebSocket[] = [];
function runtime(
  options: Parameters<typeof createRuntime>[1] = {},
  env: NodeJS.ProcessEnv = {},
) {
  const host = createRuntime(
    readRuntimeConfig({
      RUNTIME_PORT: "0",
      RUNTIME_PROBE_TOKEN: token,
      ...env,
    }),
    options,
  );
  runtimes.push(host);
  return host;
}
function connect(
  port: number,
  path = "/internal/probe",
  headers: Record<string, string> = { Authorization: `Bearer ${token}` },
) {
  return new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers,
      handshakeTimeout: 1000,
    });
    clients.push(client);
    client.once("open", () => resolve(client));
    client.on("error", reject);
  });
}
function fakeDependency(
  name: "mqtt" | "ai",
): RuntimeDependency & { ready: boolean } {
  return {
    name,
    ready: false,
    start: vi.fn(async function (this: { ready: boolean }) {
      this.ready = true;
    }),
    isReady() {
      return this.ready;
    },
    stop: vi.fn(async function (this: { ready: boolean }) {
      this.ready = false;
    }),
  };
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(
    runtimes.splice(0).map((host) => host.stop().catch(() => {})),
  );
});

describe("persistent runtime lifecycle", () => {
  it("serves health, maintains a real socket and runs abort/close hooks", async () => {
    const signal: AbortSignal[] = [];
    const close = vi.fn(async () => {});
    const host = runtime({
      connections: {
        opened: (context) => {
          signal.push(context.signal);
          return { close };
        },
      },
    });
    const address = await host.start();
    expect(await host.start()).toEqual(address);
    const ready = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ready: true,
      voice: "unconfigured",
      dependencies: { mqtt: "disabled", ai: "unconfigured" },
    });
    const client = await connect(address.port);
    const pong = once(client, "pong");
    client.ping("probe");
    await pong;
    expect(host.health().connections).toBe(1);
    expect(signal[0]?.aborted).toBe(false);
    const closed = once(client, "close");
    await host.stop();
    expect((await closed)[0]).toBe(1001);
    expect(close).toHaveBeenCalledTimes(1);
    expect(signal[0]?.aborted).toBe(true);
    expect(host.health()).toMatchObject({
      phase: "stopped",
      live: false,
      ready: false,
      connections: 0,
    });
    await host.stop();
    await expect(host.start()).rejects.toThrow(/closed/);
    const replacement = runtime({}, { RUNTIME_PORT: String(address.port) });
    await replacement.start();
  });
  it("keeps liveness healthy while dependency outages remove readiness and block new sockets", async () => {
    const mqtt = fakeDependency("mqtt");
    const ai = fakeDependency("ai");
    const host = runtime({ dependencies: [mqtt, ai] });
    const { port } = await host.start();
    for (const dependency of [mqtt, ai]) {
      dependency.ready = false;
      expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(
        200,
      );
      const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
      expect(ready.status).toBe(503);
      expect(JSON.stringify(await ready.json())).not.toContain(token);
      await expect(connect(port)).rejects.toThrow(/503/);
      dependency.ready = true;
      expect(
        (await fetch(`http://127.0.0.1:${port}/health/ready`)).status,
      ).toBe(200);
    }
    await host.stop();
    expect(mqtt.stop).toHaveBeenCalledTimes(1);
    expect(ai.stop).toHaveBeenCalledTimes(1);
  });
  it("rejects missing/forged authorization, query tokens, browser origins and all device paths", async () => {
    const host = runtime();
    const { port } = await host.start();
    for (const headers of [
      {},
      { Authorization: "Bearer forged" },
      { Authorization: `Bearer ${token}`, Origin: "https://example.com" },
    ]) {
      await expect(connect(port, "/internal/probe", headers)).rejects.toThrow(
        /401/,
      );
    }
    for (const path of [
      "/voice",
      "/internal/probe?token=forged",
      "/api/todos",
    ]) {
      await expect(connect(port, path)).rejects.toThrow(/404/);
    }
    expect((await fetch(`http://127.0.0.1:${port}/voice`)).status).toBe(404);
    expect(host.health().connections).toBe(0);
    const disabled = runtime({}, { RUNTIME_PROBE_TOKEN: "" });
    await expect(connect((await disabled.start()).port)).rejects.toThrow(/404/);
  });
  it("does not accept business messages on the lifecycle probe", async () => {
    const host = runtime();
    const { port } = await host.start();
    const client = await connect(port);
    const closed = once(client, "close");
    client.send(JSON.stringify({ type: "session.start", tenantId: "forged" }));
    expect((await closed)[0]).toBe(1008);
    await vi.waitFor(() => expect(host.health().connections).toBe(0));
  });
  it("bounds concurrent connections and releases idle/disconnected resources", async () => {
    const close = vi.fn(async () => {});
    const host = runtime(
      { connections: { opened: () => ({ close }) } },
      { RUNTIME_MAX_CONNECTIONS: "1", RUNTIME_IDLE_TIMEOUT_MS: "150" },
    );
    const { port } = await host.start();
    const first = await connect(port);
    await expect(connect(port)).rejects.toThrow(/503/);
    await once(first, "close");
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(host.health().connections).toBe(0);
    const second = await connect(port);
    second.terminate();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  });
  it("rejects oversized WebSocket messages and cleans their sessions", async () => {
    const host = runtime();
    const { port } = await host.start();
    const client = await connect(port);
    const closed = once(client, "close");
    client.send(Buffer.alloc(16_385));
    await closed;
    await vi.waitFor(() => expect(host.health().connections).toBe(0));
  });
  it("cancels timed-out startup and closes every partially started dependency", async () => {
    const mqtt = fakeDependency("mqtt");
    let aborted = false;
    const ai: RuntimeDependency = {
      name: "ai",
      isReady: () => false,
      stop: vi.fn(async () => {}),
      start: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        }),
    };
    const host = runtime(
      { dependencies: [mqtt, ai] },
      { RUNTIME_STARTUP_TIMEOUT_MS: "100" },
    );
    const pending = host.start();
    expect(host.health()).toMatchObject({
      phase: "starting",
      ready: false,
      live: true,
    });
    await expect(pending).rejects.toThrow(/startup failed/);
    expect(aborted).toBe(true);
    expect(mqtt.stop).toHaveBeenCalledTimes(1);
    expect(ai.stop).toHaveBeenCalledTimes(1);
    expect(host.health().connections).toBe(0);
  });
  it("cleans up on a dependency startup failure or occupied listener", async () => {
    const dependency = fakeDependency("mqtt");
    dependency.start = vi.fn(async () => {
      throw new Error("sensitive-provider-detail");
    });
    const host = runtime({ dependencies: [dependency] });
    await expect(host.start()).rejects.toThrow("Runtime startup failed");
    expect(dependency.stop).toHaveBeenCalledTimes(1);
    const occupied = createServer();
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("No address");
    try {
      await expect(
        runtime({}, { RUNTIME_PORT: String(address.port) }).start(),
      ).rejects.toThrow("Runtime startup failed");
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });
  it("terminates peers that do not answer the close handshake within shutdown grace", async () => {
    const host = runtime({}, { RUNTIME_SHUTDOWN_TIMEOUT_MS: "1000" });
    const client = await connect((await host.start()).port);
    client.pause();
    await host.stop();
    expect(host.health().connections).toBe(0);
    client.terminate();
  });
  it("bounds cleanup failures, still stopping dependencies even when a hook never settles", async () => {
    const dependency = fakeDependency("ai");
    const host = runtime(
      {
        dependencies: [dependency],
        connections: { opened: () => ({ close: () => new Promise(() => {}) }) },
      },
      { RUNTIME_SHUTDOWN_TIMEOUT_MS: "100" },
    );
    await connect((await host.start()).port);
    await expect(host.stop()).rejects.toThrow(/shutdown failed/);
    expect(dependency.stop).toHaveBeenCalledTimes(1);
    expect(host.health().phase).toBe("failed");
  });
  it("reports cleanup errors after closing all connections", async () => {
    const dependency = fakeDependency("mqtt");
    const host = runtime({
      dependencies: [dependency],
      connections: {
        opened: () => ({
          close: async () => {
            throw new Error("private-detail");
          },
        }),
      },
    });
    await connect((await host.start()).port);
    await expect(host.stop()).rejects.toThrow("Runtime shutdown failed");
    expect(dependency.stop).toHaveBeenCalledTimes(1);
    expect(host.health().connections).toBe(0);
  });
});
