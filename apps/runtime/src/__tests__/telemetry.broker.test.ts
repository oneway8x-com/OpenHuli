import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAsync, type MqttClient, type IClientOptions } from "mqtt";
import { PrismaService } from "@corely/data";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
  deviceMqttIdentity,
  deviceMqttClientId,
  revokeOwnerDeviceSecret,
} from "@corely/modules-devices";
import {
  TelemetryRepository,
  getTelemetryLatest,
  getTelemetryHistory,
  type TelemetryDependencies,
} from "@corely/modules-telemetry";
import { createTelemetryMqttDependency } from "../mqtt-telemetry";
import { readRuntimeConfig } from "../config";

const run = promisify(execFile),
  db = new PrismaService(),
  access = new DeviceAccessRepository(db),
  store = new TelemetryRepository(db);
const owner = { tenantId: randomUUID(), userId: randomUUID() };
const name = `openhuli-mqtt-test-${randomUUID().slice(0, 8)}`;
const clients: MqttClient[] = [];
let dependency: ReturnType<typeof createTelemetryMqttDependency> | undefined;
let deps: TelemetryDependencies, port: number, authPort: number;
let device: Awaited<ReturnType<typeof pairOwnerDevice>>,
  other: Awaited<ReturnType<typeof pairOwnerDevice>>;
let publisher: MqttClient;
const fixture = {
  name: "Synthetic station",
  room: null,
  location: null,
  profileId: "weather-station",
  profileVersion: 1,
  capabilities: [
    { kind: "temperature" },
    { kind: "humidity" },
    { kind: "ping" },
  ],
};
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function credential(paired = device) {
  const cred = paired.credentials.find((entry) => entry.purpose === "mqtt");
  if (!cred) throw new Error("Missing synthetic MQTT credential");
  return cred;
}
function options(paired = device): IClientOptions {
  const cred = credential(paired);
  return {
    clientId: deviceMqttClientId(cred.credentialId),
    username: deviceMqttIdentity({
      tenantId: owner.tenantId,
      deviceId: paired.device.id,
      credentialId: cred.credentialId,
    }),
    password: cred.token,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 2000,
  };
}
function message(sequence: number, changes: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    messageId: randomUUID(),
    type: "device.telemetry",
    deviceId: device.device.id,
    bootId: "broker-boot",
    sequence,
    sampledAt: new Date().toISOString(),
    readings: [
      { metric: "temperature", value: 23, unit: "degC" },
      { metric: "humidity", value: 60, unit: "percent" },
    ],
    ...changes,
  });
}
function config(epoch: string) {
  deps = {
    store,
    devices: access,
    epoch,
    policy: { intervalSeconds: 30, retentionDays: 7 },
  };
  const configuration = readRuntimeConfig({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    RUNTIME_MQTT_TELEMETRY_ENABLED: "true",
    RUNTIME_MQTT_URL: `mqtt://127.0.0.1:${port}`,
    RUNTIME_MQTT_AUTH_HOST: "0.0.0.0",
    RUNTIME_MQTT_AUTH_PORT: String(authPort),
    RUNTIME_MQTT_AUTH_TOKEN:
      "synthetic-broker-bridge-token-at-least-32-characters",
    RUNTIME_MQTT_USERNAME: "openhuli-service-test",
    RUNTIME_MQTT_PASSWORD: "synthetic-server-only-broker-password",
  });
  return createTelemetryMqttDependency(configuration, {
    telemetry: deps,
    close: async () => {},
  });
}
beforeAll(async () => {
  await db.connect();
  await db.tenant.create({
    data: {
      id: owner.tenantId,
      name: "Synthetic MQTT tenant",
      slug: owner.tenantId,
    },
  });
  device = await pairOwnerDevice(fixture, owner, access);
  other = await pairOwnerDevice(fixture, owner, access);
  port = await freePort();
  authPort = await freePort();
  dependency = config("first-backend");
  const starting = dependency.start(new AbortController().signal);
  await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "-p",
    `127.0.0.1:${port}:1883`,
    ...(process.platform === "linux"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : []),
    "-e",
    `OPENHULI_MQTT_AUTH_URL=http://host.docker.internal:${authPort}`,
    "-e",
    "OPENHULI_MQTT_AUTH_TOKEN=synthetic-broker-bridge-token-at-least-32-characters",
    process.env.TEST_MQTT_BROKER_IMAGE ?? "",
  ]);
  await starting;
  publisher = await connectAsync(`mqtt://127.0.0.1:${port}`, options());
  clients.push(publisher);
});
afterAll(async () => {
  for (const client of clients) await client.endAsync(true).catch(() => {});
  await dependency?.stop().catch(() => {});
  await run("docker", ["stop", name]).catch(() => {});
  await db.device.deleteMany({ where: { tenantId: owner.tenantId } });
  await db.tenant.deleteMany({ where: { id: owner.tenantId } });
  await db.disconnect();
});
describe("real Mosquitto integration", () => {
  it("authenticates scoped credentials and persists attested telemetry", async () => {
    await publisher.publishAsync(device.mqtt.telemetry, message(0), { qos: 1 });
    await expect
      .poll(
        async () =>
          (
            await getTelemetryLatest(
              { deviceId: device.device.id },
              owner,
              deps,
            )
          ).readings,
        { timeout: 5000 },
      )
      .toHaveLength(2);
    expect(
      await getTelemetryLatest({ deviceId: device.device.id }, owner, deps),
    ).toMatchObject({ connectivity: "online", freshness: "fresh" });
    await expect(
      connectAsync(`mqtt://127.0.0.1:${port}`, {
        ...options(other),
        password: credential(device).token,
      }),
    ).rejects.toThrow();
    await expect(
      connectAsync(`mqtt://127.0.0.1:${port}`, {
        ...options(other),
        clientId: deviceMqttClientId(credential(device).credentialId),
      }),
    ).rejects.toThrow();
  });
  it("denies other-device publishing, wildcard reads and spoofed publisher metadata", async () => {
    await publisher
      .publishAsync(
        other.mqtt.telemetry,
        message(1, { deviceId: other.device.id }),
        { qos: 1 },
      )
      .catch(() => {});
    const grants = await publisher
      .subscribeAsync("openhuli/v1/devices/#")
      .catch(() => []);
    expect(grants.every((grant) => grant.qos > 2)).toBe(true);
    await expect(publisher.subscribeAsync(other.mqtt.commands)).rejects.toThrow(
      "Not authorized",
    );
    const forgedBridge = await fetch(`http://127.0.0.1:${authPort}/acl`, {
      method: "POST",
      body: "username=forged",
    });
    expect(forgedBridge.status).toBe(403);
    expect(
      (await getTelemetryHistory({ deviceId: other.device.id }, owner, deps))
        .items,
    ).toEqual([]);
    await publisher.publishAsync(device.mqtt.telemetry, message(1), {
      qos: 1,
      properties: {
        userProperties: {
          "openhuli-identity": String(options(other).username),
        },
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(
      (await getTelemetryHistory({ deviceId: device.device.id }, owner, deps))
        .items,
    ).toHaveLength(1);
  });
  it("rejects invalid humidity and oversized packets while preserving history", async () => {
    await publisher.publishAsync(
      device.mqtt.telemetry,
      message(2, {
        readings: [{ metric: "humidity", value: 200, unit: "percent" }],
      }),
      { qos: 1 },
    );
    const closed = new Promise<void>((resolve) =>
      publisher.once("close", resolve),
    );
    void publisher
      .publishAsync(
        device.mqtt.telemetry,
        message(3, { padding: "x".repeat(20000) }),
        { qos: 1 },
      )
      .catch(() => {});
    await closed;
    await publisher.endAsync(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(
      (await getTelemetryHistory({ deviceId: device.device.id }, owner, deps))
        .items,
    ).toHaveLength(1);
  });
  it("keeps retained online unconfirmed after backend restart, then accepts a live sample", async () => {
    if (!publisher.connected) {
      publisher = await connectAsync(`mqtt://127.0.0.1:${port}`, options());
      clients.push(publisher);
    }
    await publisher.publishAsync(
      device.mqtt.presence,
      JSON.stringify({
        version: 1,
        messageId: randomUUID(),
        type: "device.presence",
        deviceId: device.device.id,
        bootId: "broker-boot",
        sequence: 0,
        status: "online",
        sentAt: new Date().toISOString(),
      }),
      { qos: 1, retain: true },
    );
    await dependency?.stop();
    dependency = config("second-backend");
    await dependency.start(new AbortController().signal);
    expect(
      (await getTelemetryLatest({ deviceId: device.device.id }, owner, deps))
        .connectivity,
    ).toBe("unknown");
    await publisher.publishAsync(device.mqtt.telemetry, message(4), { qos: 1 });
    await expect
      .poll(
        async () =>
          (
            await getTelemetryLatest(
              { deviceId: device.device.id },
              owner,
              deps,
            )
          ).connectivity,
        { timeout: 5000 },
      )
      .toBe("online");
    expect(
      (await getTelemetryHistory({ deviceId: device.device.id }, owner, deps))
        .items.length,
    ).toBeGreaterThan(1);
  });
  it("processes Last Will and denies traffic immediately after credential revocation", async () => {
    await publisher.endAsync(false);
    publisher = await connectAsync(`mqtt://127.0.0.1:${port}`, {
      ...options(),
      will: {
        topic: device.mqtt.presence,
        payload: Buffer.from(
          JSON.stringify({
            version: 1,
            messageId: randomUUID(),
            type: "device.presence",
            deviceId: device.device.id,
            bootId: "broker-boot",
            sequence: 1,
            status: "offline",
            sentAt: new Date().toISOString(),
          }),
        ),
        qos: 1,
        retain: true,
      },
    });
    clients.push(publisher);
    await publisher.endAsync(true);
    await expect
      .poll(
        async () =>
          (
            await getTelemetryLatest(
              { deviceId: device.device.id },
              owner,
              deps,
            )
          ).connectivity,
        { timeout: 5000 },
      )
      .toBe("offline");
    const active = await connectAsync(`mqtt://127.0.0.1:${port}`, options());
    clients.push(active);
    // A delayed reading cannot undo the Will; reconnect must publish newer online presence.
    await active.publishAsync(device.mqtt.telemetry, message(5), { qos: 1 });
    await expect
      .poll(
        async () =>
          (
            await getTelemetryHistory(
              { deviceId: device.device.id },
              owner,
              deps,
            )
          ).items.length,
      )
      .toBeGreaterThan(2);
    expect(
      (await getTelemetryLatest({ deviceId: device.device.id }, owner, deps))
        .connectivity,
    ).toBe("offline");
    await revokeOwnerDeviceSecret(
      device.device.id,
      credential().credentialId,
      owner,
      access,
    );
    await active
      .publishAsync(device.mqtt.telemetry, message(6), { qos: 1 })
      .catch(() => {});
    await expect(
      connectAsync(`mqtt://127.0.0.1:${port}`, {
        ...options(),
        clientId: `${deviceMqttClientId(credential().credentialId)}`,
      }),
    ).rejects.toThrow();
    expect(
      (await getTelemetryLatest({ deviceId: device.device.id }, owner, deps))
        .connectivity,
    ).toBe("offline");
  });
});
