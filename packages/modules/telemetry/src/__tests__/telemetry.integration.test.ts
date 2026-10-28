import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "@corely/data";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
  deviceMqttIdentity,
  deviceMqttTopics,
  assignOwnerDeviceGrant,
} from "@corely/modules-devices";
import { IdentityRepository, readAuthConfig } from "@corely/modules-identity";
import {
  ToolRegistry,
  ToolExecutionRepository,
  submitToolCall,
  dispatchToolExecution,
} from "@corely/modules-tool-execution";
import { createTelemetryTools } from "../telemetry.tools";
import { TelemetryRepository } from "../telemetry.repository";
import {
  cleanupTelemetry,
  getTelemetryHistory,
  getTelemetryLatest,
  ingestBrokerMessage,
  listTelemetryDevices,
  type TelemetryDependencies,
} from "../telemetry.use-cases";

const db = new PrismaService(),
  access = new DeviceAccessRepository(db),
  store = new TelemetryRepository(db);
const a = { tenantId: randomUUID(), userId: randomUUID() },
  b = { tenantId: randomUUID(), userId: randomUUID() };
const deps: TelemetryDependencies = {
  devices: access,
  store,
  epoch: "backend-a",
  policy: { intervalSeconds: 30, retentionDays: 7 },
};
const now = new Date();
beforeAll(async () => {
  await db.connect();
  for (const owner of [a, b])
    await db.tenant.create({
      data: {
        id: owner.tenantId,
        name: "Synthetic telemetry",
        slug: owner.tenantId,
      },
    });
});
afterAll(async () => {
  const scope = { tenantId: { in: [a.tenantId, b.tenantId] } };
  await db.auditLog.deleteMany({ where: scope });
  await db.toolExecution.deleteMany({ where: scope });
  await db.conversationTurn.deleteMany({ where: scope });
  await db.agentRun.deleteMany({ where: scope });
  await db.device.deleteMany({
    where: { tenantId: { in: [a.tenantId, b.tenantId] } },
  });
  await db.tenant.deleteMany({
    where: { id: { in: [a.tenantId, b.tenantId] } },
  });
  await db.disconnect();
});
async function fixture(owner = a) {
  const paired = await pairOwnerDevice(
    {
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
    },
    owner,
    access,
  );
  const credential = paired.credentials.find((item) => item.purpose === "mqtt");
  if (!credential) throw new Error("No synthetic credential");
  const deviceId = paired.device.id,
    identity = deviceMqttIdentity({
      tenantId: owner.tenantId,
      deviceId,
      credentialId: credential.credentialId,
    });
  const telemetry = {
    version: 1,
    messageId: randomUUID(),
    type: "device.telemetry",
    deviceId,
    bootId: "boot-a",
    sequence: 0,
    sampledAt: now.toISOString(),
    readings: [
      { metric: "temperature", value: 22, unit: "degC" },
      { metric: "humidity", value: 55, unit: "percent" },
    ],
  };
  return {
    deviceId,
    identity,
    credential,
    telemetry,
    topics: deviceMqttTopics(owner.tenantId, deviceId),
    owner,
  };
}
async function sample(
  f: Awaited<ReturnType<typeof fixture>>,
  changes: Record<string, unknown> = {},
  time = now,
  retained = false,
) {
  return ingestBrokerMessage(
    {
      identity: f.identity,
      topic: f.topics.telemetry,
      payload: JSON.stringify({ ...f.telemetry, ...changes }),
      retained,
    },
    deps,
    time,
  );
}
async function presence(
  f: Awaited<ReturnType<typeof fixture>>,
  status: "online" | "offline",
  sequence: number,
  retained: boolean,
  override = deps,
) {
  return ingestBrokerMessage(
    {
      identity: f.identity,
      topic: f.topics.presence,
      payload: JSON.stringify({
        version: 1,
        messageId: randomUUID(),
        type: "device.presence",
        deviceId: f.deviceId,
        bootId: "boot-a",
        sequence,
        status,
        sentAt: now.toISOString(),
      }),
      retained,
    },
    override,
    now,
  );
}
describe("grounded telemetry persistence", () => {
  it("persists validated readings, server receipt time and full uint32 sequences", async () => {
    const f = await fixture();
    await sample(f, { sequence: 4294967295 });
    const latest = await getTelemetryLatest(
      { deviceId: f.deviceId },
      a,
      deps,
      now,
    );
    expect(latest).toMatchObject({
      connectivity: "online",
      freshness: "fresh",
      source: "measured_sensor",
      sampledAt: now.toISOString(),
      receivedAt: now.toISOString(),
    });
    expect(latest.readings).toHaveLength(2);
    const history = await getTelemetryHistory(
      { deviceId: f.deviceId },
      a,
      { ...deps, epoch: "restart" },
      now,
    );
    expect(history.items[0]?.sequence).toBe(4294967295);
    expect(
      (
        await getTelemetryLatest(
          { deviceId: f.deviceId },
          a,
          { ...deps, epoch: "restart" },
          now,
        )
      ).connectivity,
    ).toBe("unknown");
  });
  it("rejects invalid values, wrong units, oversized messages, future clocks and identity mismatch", async () => {
    const f = await fixture(),
      other = await fixture(b);
    for (const changes of [
      { readings: [{ metric: "humidity", value: 101, unit: "percent" }] },
      { readings: [{ metric: "temperature", value: 22, unit: "F" }] },
      { sampledAt: new Date(now.getTime() + 60000).toISOString() },
      { deviceId: other.deviceId },
      { padding: "x".repeat(20000) },
    ])
      await expect(sample(f, changes)).rejects.toThrow();
    await expect(
      ingestBrokerMessage(
        {
          identity: f.identity,
          topic: other.topics.telemetry,
          payload: JSON.stringify(f.telemetry),
          retained: false,
        },
        deps,
        now,
      ),
    ).rejects.toThrow("permitted");
    expect(
      (await getTelemetryHistory({ deviceId: f.deviceId }, a, deps, now)).items,
    ).toEqual([]);
    await expect(
      getTelemetryLatest({ deviceId: f.deviceId }, b, deps, now),
    ).rejects.toThrow("not found");
    await expect(
      getTelemetryHistory({ deviceId: f.deviceId }, b, deps, now),
    ).rejects.toThrow("not found");
  });
  it("deduplicates concurrent samples without refreshing liveness on replay", async () => {
    const f = await fixture();
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => sample(f)),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const later = new Date(now.getTime() + 91000);
    expect(await sample(f, {}, later)).toBe(false);
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, deps, later))
        .connectivity,
    ).toBe("unknown");
  });
  it("separates freshness, explicit offline, unavailable errors and no data", async () => {
    const f = await fixture();
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, deps, now))
        .freshness,
    ).toBe("unavailable");
    await sample(f);
    expect(
      (
        await getTelemetryLatest(
          { deviceId: f.deviceId },
          a,
          deps,
          new Date(now.getTime() + 90001),
        )
      ).freshness,
    ).toBe("stale");
    await presence(f, "offline", 1, true);
    expect(
      await getTelemetryLatest({ deviceId: f.deviceId }, a, deps, now),
    ).toMatchObject({ connectivity: "offline", freshness: "fresh" });
    await sample(f, {
      messageId: randomUUID(),
      sequence: 1,
      readings: [],
      sensorErrors: [{ metric: "humidity", code: "read_failed" }],
    });
    expect(
      await getTelemetryLatest({ deviceId: f.deviceId }, a, deps, now),
    ).toMatchObject({
      connectivity: "offline",
      freshness: "unavailable",
      readings: [],
      sensorErrors: [{ metric: "humidity", code: "read_failed" }],
    });
    await presence(f, "online", 2, false);
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, deps, now))
        .connectivity,
    ).toBe("online");
  });
  it("never trusts retained online as live, including after restart and reconnect", async () => {
    const f = await fixture();
    await sample(f);
    const restart = { ...deps, epoch: "backend-b" };
    await presence(f, "online", 2, true, restart);
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, restart, now))
        .connectivity,
    ).toBe("unknown");
    await ingestBrokerMessage(
      {
        identity: f.identity,
        topic: f.topics.telemetry,
        payload: JSON.stringify({
          ...f.telemetry,
          messageId: randomUUID(),
          sequence: 1,
        }),
        retained: false,
      },
      restart,
      now,
    );
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, restart, now))
        .connectivity,
    ).toBe("online");
    await presence(f, "offline", 1, true, restart);
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, restart, now))
        .connectivity,
    ).toBe("online");
    await presence(f, "offline", 3, false, restart);
    expect(
      (await getTelemetryLatest({ deviceId: f.deviceId }, a, restart, now))
        .connectivity,
    ).toBe("offline");
  });
  it("retains history across repository restarts and cleans only the requested Tenant", async () => {
    const f = await fixture(),
      other = await fixture(b);
    const old = new Date(now.getTime() - 8 * 86400_000);
    await sample(f, { sampledAt: old.toISOString() }, old);
    await sample(other, { sampledAt: old.toISOString() }, old);
    expect(
      (await getTelemetryLatest({ deviceId: other.deviceId }, b, deps, now))
        .freshness,
    ).toBe("unavailable");
    await cleanupTelemetry(a, deps, now);
    expect(await store.latest(a.tenantId, f.deviceId)).toBeNull();
    expect(await store.latest(b.tenantId, other.deviceId)).not.toBeNull();
    await sample(f, { sequence: 1, messageId: randomUUID() });
    expect(
      (
        await getTelemetryHistory(
          { deviceId: f.deviceId },
          a,
          { ...deps, store: new TelemetryRepository(db) },
          now,
        )
      ).items,
    ).toHaveLength(1);
    await expect(
      getTelemetryHistory({ deviceId: f.deviceId, take: 101 }, a, deps, now),
    ).rejects.toThrow();
    await expect(
      getTelemetryHistory(
        { deviceId: f.deviceId, from: old.toISOString() },
        a,
        deps,
        now,
      ),
    ).rejects.toThrow("retention");
    expect(
      (await listTelemetryDevices(a, deps, now)).devices.every(
        (d) => d.deviceId !== other.deviceId,
      ),
    ).toBe(true);
  });
  it("retained telemetry stores history but does not refresh presence", async () => {
    const f = await fixture();
    await sample(f, {}, now, true);
    expect(
      await getTelemetryLatest({ deviceId: f.deviceId }, a, deps, now),
    ).toMatchObject({ freshness: "fresh", connectivity: "unknown" });
  });
});

it("executes grounded registered tools only through an authorized committed device turn", async () => {
  const target = await fixture();
  await sample(target);
  const voice = await pairOwnerDevice(
    {
      name: "Synthetic voice",
      room: null,
      location: null,
      profileId: "esp32-voice",
      profileVersion: 1,
      capabilities: [
        {
          kind: "microphone",
          format: {
            encoding: "pcm_s16le",
            sampleRateHz: 16000,
            channels: 1,
            chunkDurationMs: 20,
          },
        },
        { kind: "ping" },
      ],
    },
    a,
    access,
  );
  const token = voice.credentials.find(
    (entry) => entry.purpose === "voice",
  )?.token;
  if (!token) throw new Error("Missing synthetic voice credential");
  const auth = { kind: "device" as const, token };
  const execution = {
    store: new ToolExecutionRepository(db),
    devices: access,
    identity: new IdentityRepository(db),
    auth: readAuthConfig({
      NODE_ENV: "development",
      OWNER_EMAIL: "synthetic@example.test",
    }),
    registry: new ToolRegistry(createTelemetryTools(deps)),
  };
  const run = await db.agentRun.create({
    data: { tenantId: a.tenantId, deviceId: voice.device.id, status: "active" },
  });
  const turn = await db.conversationTurn.create({
    data: {
      id: randomUUID(),
      tenantId: a.tenantId,
      runId: run.id,
      sequence: 1,
      source: "voice",
      status: "committed",
      correlationId: "synthetic",
    },
  });
  for (const toolId of [
    "device.list",
    "telemetry.latest",
    "telemetry.history",
  ]) {
    const request = {
      toolCall: {
        version: 1,
        conversationId: run.id,
        turnId: turn.id,
        toolCallId: randomUUID(),
        toolId,
        arguments:
          toolId === "device.list" ? {} : { deviceId: target.deviceId },
      },
      correlationId: "synthetic",
    };
    await expect(submitToolCall(request, auth, execution)).rejects.toThrow();
    await assignOwnerDeviceGrant(
      voice.device.id,
      {
        toolId,
        targetDeviceIds: toolId === "device.list" ? [] : [target.deviceId],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      a,
      access,
    );
    const pending = await submitToolCall(request, auth, execution);
    const result = await dispatchToolExecution(
      pending.executionId,
      auth,
      execution,
    );
    expect(result.status).toBe("succeeded");
    if (toolId === "telemetry.latest")
      expect(result.output).toMatchObject({
        source: "measured_sensor",
        readings: target.telemetry.readings,
      });
    if (toolId === "telemetry.history")
      expect(result.output?.items).toHaveLength(1);
    if (toolId === "device.list")
      expect(result.output?.devices).toBeInstanceOf(Array);
  }
});
