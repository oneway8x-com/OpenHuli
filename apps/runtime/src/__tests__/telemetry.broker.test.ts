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
import {
  DeviceCommandRepository,
  createDeviceCommandTools,
  getCommandOutcome,
  type DeviceCommandDependencies,
} from "@corely/modules-device-commands";
import {
  IdentityRepository,
  readAuthConfig,
  issueAccessToken,
} from "@corely/modules-identity";
import {
  ToolExecutionRepository,
  ToolRegistry,
  submitToolCall,
  dispatchToolExecution,
  preauthorizeTool,
} from "@corely/modules-tool-execution";
import {
  OpenHuliCommandReceiver,
  DeviceCapabilityManifestSchema,
  type DeviceCommand,
  type DeviceCommandResult,
} from "@corely/contracts";
import { createTelemetryMqttDependency } from "../mqtt-telemetry";
import { readRuntimeConfig } from "../config";

const run = promisify(execFile),
  db = new PrismaService(),
  access = new DeviceAccessRepository(db),
  store = new TelemetryRepository(db);
const owner = { tenantId: randomUUID(), userId: randomUUID() };
const name = `openhuli-mqtt-test-${randomUUID().slice(0, 8)}`;
const clients: MqttClient[] = [];
let commands: DeviceCommandDependencies;
let ownerToken: string;
const authConfig = readAuthConfig({
  NODE_ENV: "development",
  OWNER_EMAIL: `broker-${randomUUID()}@example.test`,
});
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
  commands = {
    store: new DeviceCommandRepository(db),
    devices: access,
    telemetry: deps,
    acknowledgementTimeoutMs: 1000,
    publisher: { isReady: () => false, publishCommand: async () => "not_sent" },
  };
  const adapter = createTelemetryMqttDependency(configuration, {
    telemetry: deps,
    commands,
    close: async () => {},
  });
  commands.publisher = adapter;
  return adapter;
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
  await db.user.create({
    data: {
      id: owner.userId,
      email: authConfig.ownerEmail,
      passwordHash: "",
      name: "Broker test",
    },
  });
  const role = await db.role.create({
    data: {
      tenantId: owner.tenantId,
      systemKey: "OWNER",
      scope: "TENANT",
      name: "Owner",
    },
  });
  await db.membership.create({
    data: { tenantId: owner.tenantId, userId: owner.userId, roleId: role.id },
  });
  const user = {
    ...owner,
    email: authConfig.ownerEmail,
    name: "Broker test",
    tenantName: "Broker test",
  };
  const session = await new IdentityRepository(db).createSession(
    user,
    randomUUID(),
    new Date(Date.now() + 3600000),
  );
  ownerToken = issueAccessToken(user, session.id, authConfig.secret);
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
  const scope = { tenantId: owner.tenantId };
  await db.deviceCommand.deleteMany({ where: scope });
  await db.toolPreauthorization.deleteMany({ where: scope });
  await db.auditLog.deleteMany({ where: scope });
  await db.toolExecution.deleteMany({ where: scope });
  await db.conversationTurn.deleteMany({ where: scope });
  await db.agentRun.deleteMany({ where: scope });
  await db.refreshToken.deleteMany({ where: scope });
  await db.membership.deleteMany({ where: scope });
  await db.role.deleteMany({ where: scope });
  await db.device.deleteMany({ where: { tenantId: owner.tenantId } });
  await db.tenant.deleteMany({ where: { id: owner.tenantId } });
  await db.user.delete({ where: { id: owner.userId } });
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

it("executes acknowledged commands through real MQTT and deduplicates physical effects", async () => {
  const paired = await pairOwnerDevice(
    {
      ...fixture,
      capabilities: [
        ...fixture.capabilities,
        { kind: "display", maxTextLength: 32 },
      ],
    },
    owner,
    access,
  );
  const actor = { kind: "owner" as const, token: ownerToken };
  const toolDeps = {
    store: new ToolExecutionRepository(db),
    devices: access,
    identity: new IdentityRepository(db),
    auth: authConfig,
    registry: new ToolRegistry(createDeviceCommandTools(commands)),
  };
  const client = await connectAsync(
    `mqtt://127.0.0.1:${port}`,
    options(paired),
  );
  clients.push(client);
  await client.subscribeAsync(paired.mqtt.commands, { qos: 1 });
  const stored = await access.findDevice(owner.tenantId, paired.device.id);
  if (!stored) throw new Error("device");
  const receiver = new OpenHuliCommandReceiver(
    DeviceCapabilityManifestSchema.parse(JSON.parse(stored.manifestJson)),
    Date.now,
    () => true,
  );
  let effects = 0;
  const receipts: DeviceCommandResult[] = [],
    received: DeviceCommand[] = [];
  client.on("message", (_topic, payload, packet) => {
    expect(packet.retain).toBe(false);
    expect(packet.qos).toBe(0);
    const wire = payload.toString();
    received.push(JSON.parse(wire));
    void receiver
      .receive(wire, async () => {
        effects++;
        return "succeeded";
      })
      .then((result) => {
        receipts.push(result);
      });
  });
  const presence = (sequence: number, status: "online" | "offline") =>
    client.publishAsync(
      paired.mqtt.presence,
      JSON.stringify({
        version: 1,
        type: "device.presence",
        messageId: randomUUID(),
        deviceId: paired.device.id,
        bootId: "command-boot",
        sequence,
        status,
        sentAt: new Date().toISOString(),
      }),
      { qos: 1, retain: true },
    );
  await presence(0, "online");
  await expect
    .poll(
      async () =>
        (await getTelemetryLatest({ deviceId: paired.device.id }, owner, deps))
          .connectivity,
    )
    .toBe("online");
  async function request(toolId: string, args: Record<string, unknown>) {
    await preauthorizeTool(
      {
        toolId,
        sourceDeviceId: null,
        targetDeviceId: paired.device.id,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      actor,
      toolDeps,
    );
    const runId = randomUUID(),
      turnId = randomUUID();
    await db.agentRun.create({
      data: { id: runId, tenantId: owner.tenantId, status: "active" },
    });
    await db.conversationTurn.create({
      data: {
        id: turnId,
        tenantId: owner.tenantId,
        runId,
        sequence: 1,
        source: "text",
        status: "committed",
        correlationId: turnId,
      },
    });
    return submitToolCall(
      {
        toolCall: {
          version: 1,
          conversationId: runId,
          turnId,
          toolCallId: randomUUID(),
          toolId,
          arguments: args,
        },
        correlationId: turnId,
      },
      actor,
      toolDeps,
    );
  }
  const ping = await request("device.ping", { deviceId: paired.device.id });
  const pending = dispatchToolExecution(ping.executionId, actor, toolDeps);
  await expect.poll(() => receipts.length).toBe(1);
  expect(
    (await getCommandOutcome(ping.executionId, owner, commands)).status,
  ).toBe("pending");
  const attacker = await connectAsync(
    `mqtt://127.0.0.1:${port}`,
    options(other),
  );
  clients.push(attacker);
  await attacker.publishAsync(
    other.mqtt.commandResults,
    JSON.stringify(receipts[0]),
    { qos: 1 },
  );
  expect(
    (await getCommandOutcome(ping.executionId, owner, commands)).status,
  ).toBe("pending");
  await client.publishAsync(
    paired.mqtt.commandResults,
    JSON.stringify(receipts[0]),
    { qos: 1 },
  );
  expect((await pending).status).toBe("succeeded");
  await dependency?.publishCommand(received[0], new AbortController().signal); // Explicit duplicate injection, not production replay.
  await expect.poll(() => receipts.length).toBe(2);
  expect(effects).toBe(1);
  await client.publishAsync(
    paired.mqtt.commandResults,
    JSON.stringify(receipts[1]),
    { qos: 1 },
  );
  expect(
    (await getCommandOutcome(ping.executionId, owner, commands)).status,
  ).toBe("succeeded");
  const display = await request("display.message", {
    deviceId: paired.device.id,
    text: "Hello",
  });
  const missing = dispatchToolExecution(display.executionId, actor, toolDeps);
  await expect.poll(() => receipts.length).toBe(3);
  expect((await missing).status).toBe("unknown");
  await client.publishAsync(
    paired.mqtt.commandResults,
    JSON.stringify(receipts[2]),
    { qos: 1 },
  );
  await expect
    .poll(
      async () =>
        (await getCommandOutcome(display.executionId, owner, commands)).result
          ?.lateAcknowledgement,
    )
    .toBeTruthy();
  expect(
    (await getCommandOutcome(display.executionId, owner, commands)).status,
  ).toBe("unknown");
  await presence(1, "offline");
  await client.endAsync(false);
  const offline = await request("device.ping", { deviceId: paired.device.id });
  expect(
    (await dispatchToolExecution(offline.executionId, actor, toolDeps)).output
      ?.status,
  ).toBe("failed");
  const reconnected = await connectAsync(
    `mqtt://127.0.0.1:${port}`,
    options(paired),
  );
  clients.push(reconnected);
  let replayed = 0;
  reconnected.on("message", () => {
    replayed++;
  });
  await reconnected.subscribeAsync(paired.mqtt.commands, { qos: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(replayed).toBe(0);
  expect(effects).toBe(2);
});
