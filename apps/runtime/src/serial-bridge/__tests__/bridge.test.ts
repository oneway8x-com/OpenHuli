import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SerialLink } from "../link";
import { BridgeCommands } from "../commands";
import { openFence } from "../fence";
import { bridgeDevice, brokerEndpoint } from "../config";
import {
  deviceMqttIdentity,
  deviceMqttClientId,
} from "@corely/modules-devices";
const temp = mkdtempSync(join(tmpdir(), "openhuli-bridge-")),
  bin = join(temp, "node");
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});
beforeAll(() => {
  execFileSync(
    process.env.CXX || "c++",
    [
      "-std=c++11",
      "-Ilibraries/OpenHuliSerial/src",
      "libraries/OpenHuliSerial/src/OpenHuliWire.cpp",
      "libraries/OpenHuliSerial/src/OpenHuliNode.cpp",
      "libraries/OpenHuliSerial/test/process.cpp",
      "-o",
      bin,
    ],
    { cwd: join(import.meta.dirname, "../../../../.."), timeout: 60000 },
  );
});
async function fixture() {
  const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  const link = new SerialLink({
    write: (bytes) => child.stdin.write(bytes),
    now: Date.now,
    monotonic: () => performance.now(),
    sensors: 0,
    display: 0,
    sample: () => {
      throw Error("invented sample");
    },
    state: () => {},
  });
  child.stdout.on("data", (bytes) => link.receive(bytes));
  const timer = setInterval(() => link.poll(), 10);
  const until = Date.now() + 3000;
  while (!link.connected() && Date.now() < until)
    await new Promise((r) => setTimeout(r, 10));
  expect(link.connected()).toBe(true);
  return {
    link,
    child,
    close: () => {
      clearInterval(timer);
      link.reset();
      child.kill();
    },
  };
}
describe("serial bridge", () => {
  it("waits for a real C++ node receipt, deduplicates and invalidates pending work on disconnect", async () => {
    const f = await fixture();
    try {
      let reservations = 0;
      const commands = new BridgeCommands({
        manifest: {
          version: 1,
          type: "device.manifest",
          messageId: "m",
          deviceId: "node",
          firmwareVersion: "test",
          capabilities: [{ kind: "ping" }],
        },
        link: f.link,
        now: Date.now,
        floor: () => 0,
        reserve: async () => {
          reservations++;
        },
      });
      const now = Date.now(),
        wire = JSON.stringify({
          version: 1,
          type: "device.command",
          messageId: "m1",
          commandId: "cmd",
          executionId: "exec",
          deviceId: "node",
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 2000).toISOString(),
          action: { kind: "ping" },
        });
      const first = await commands.receive(wire);
      expect(first.status).toBe("succeeded");
      expect(await commands.receive(wire)).toEqual(first);
      expect(reservations).toBe(1);
      await expect(
        commands.receive(wire.replace('"exec"', '"different"')),
      ).rejects.toThrow("conflict");
      const pending = f.link.command({ kind: "ping" }, Date.now() + 1000);
      f.link.reset();
      expect((await pending).status).toBe("unknown");
    } finally {
      f.close();
    }
  });
  it("fails closed if the link changes during durable reservation", async () => {
    const f = await fixture();
    try {
      const commands = new BridgeCommands({
        manifest: {
          version: 1,
          type: "device.manifest",
          messageId: "m",
          deviceId: "node",
          firmwareVersion: "test",
          capabilities: [{ kind: "ping" }],
        },
        link: f.link,
        now: Date.now,
        floor: () => 0,
        reserve: async () => f.link.reset(),
      });
      const now = Date.now();
      const result = await commands.receive(
        JSON.stringify({
          version: 1,
          type: "device.command",
          messageId: "m",
          commandId: "c",
          executionId: "e",
          deviceId: "node",
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 2000).toISOString(),
          action: { kind: "ping" },
        }),
      );
      expect(result.status).toBe("unknown");
    } finally {
      f.close();
    }
  });
  it("locks and durably reloads a device-bound expiry fence, rejecting corruption", async () => {
    const path = join(temp, "fence");
    const f = await openFence(path, "device");
    await expect(openFence(path, "device")).rejects.toThrow();
    await f.reserve(1767225601000);
    await f.close();
    const loaded = await openFence(path, "device");
    expect(loaded.until).toBe(1767225601000);
    await loaded.close();
    await expect(openFence(path, "other-device")).rejects.toThrow();
    writeFileSync(path, "corrupt", { mode: 0o600 });
    await expect(openFence(path, "device")).rejects.toThrow();
  });
  it("binds provisioning to one MQTT identity and rejects insecure endpoints", () => {
    const identity = {
      tenantId: "tenant",
      deviceId: "node",
      credentialId: "credential",
    };
    const paired = {
      device: { id: "node", capabilities: [{ kind: "ping" }] },
      credentials: [
        {
          purpose: "mqtt",
          credentialId: "credential",
          token: "synthetic",
          mqttUsername: deviceMqttIdentity(identity),
          mqttClientId: deviceMqttClientId("credential"),
        },
      ],
    };
    expect(bridgeDevice(paired).sensors).toBe(0);
    expect(() =>
      bridgeDevice({ ...paired, device: { ...paired.device, id: "other" } }),
    ).toThrow();
    expect(() => brokerEndpoint("mqtt://localhost")).toThrow();
    expect(brokerEndpoint("mqtts://broker.example.test")).toContain("mqtts:");
  });
});

afterAll(() => rmSync(temp, { recursive: true, force: true }));
