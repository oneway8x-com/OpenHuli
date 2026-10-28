import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PrismaService } from "@corely/data";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
  assignOwnerDeviceGrant,
  revokeOwnerDeviceGrant,
} from "@corely/modules-devices";
import { OPENHULI_PCM_FORMAT, encodeOpenHuliAudio } from "@corely/contracts";
import { createFakeConversationProvider } from "../../../../packages/modules/conversations/src/fake-conversation-provider";
import type { ProviderEvent } from "@corely/modules-conversations";
import { createLiveConversationRuntime } from "../conversation-composition";
import { createVoiceAuthorization } from "../device-authorization";
import { createRuntime } from "../runtime";
import { readRuntimeConfig } from "../config";
import { getTestDatabaseUrl } from "../../../../scripts/test-database";
process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.OWNER_EMAIL = "owner@example.test";
process.env.JWT_SECRET = "synthetic-integration-secret-at-least-32-chars";
process.env.APP_URL = "http://localhost:3000";
const db = new PrismaService(),
  devices = new DeviceAccessRepository(db);
let tenantId: string, deviceId: string, token: string;
const hosts: ReturnType<typeof createRuntime>[] = [],
  clients: WebSocket[] = [],
  compositions: ReturnType<typeof createLiveConversationRuntime>[] = [];
const owner = () => ({ tenantId, userId: "synthetic-owner" });
beforeAll(async () => {
  tenantId = (
    await db.tenant.create({
      data: { name: "Synthetic conversation tenant", slug: randomUUID() },
    })
  ).id;
  const paired = await pairOwnerDevice(
    {
      name: "Kitchen microphone",
      room: "Kitchen",
      profileId: "esp32-voice",
      profileVersion: 1,
      capabilities: [
        { kind: "microphone", format: OPENHULI_PCM_FORMAT },
        { kind: "speaker", format: OPENHULI_PCM_FORMAT },
        { kind: "ping" },
      ],
    },
    owner(),
    devices,
  );
  deviceId = paired.device.id;
  const voice = paired.credentials.find((value) => value.purpose === "voice");
  if (!voice) throw new Error("credential");
  token = voice.token;
  await assignOwnerDeviceGrant(
    deviceId,
    {
      toolId: "device_context",
      targetDeviceIds: [deviceId],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    owner(),
    devices,
  );
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(compositions.splice(0).map((factory) => factory.close()));
});
afterAll(async () => {
  for (const client of clients) client.terminate();
  await Promise.all(hosts.map((host) => host.stop()));
  await Promise.all(compositions.map((factory) => factory.close()));
  if (tenantId) {
    await db.agentRun.deleteMany({ where: { tenantId } });
    await db.device.deleteMany({ where: { tenantId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });
  }
  await db.disconnect();
});
async function setup(turns: ProviderEvent[][], outputAudio = false) {
  const fake = createFakeConversationProvider(turns);
  const config = readRuntimeConfig({
    ...process.env,
    NODE_ENV: "test",
    RUNTIME_VOICE_ENABLED: "true",
    RUNTIME_PORT: "0",
  });
  const factory = createLiveConversationRuntime(config, fake.factory);
  compositions.push(factory);
  const host = createRuntime(config, {
    voice: { authorization: createVoiceAuthorization(), provider: factory },
  });
  hosts.push(host);
  const address = await host.start();
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/voice`, {
    headers: { authorization: `Bearer ${token}` },
  });
  clients.push(client);
  const messages: Record<string, unknown>[] = [];
  const audio: Uint8Array[] = [];
  client.on("message", (data, binary) => {
    if (binary)
      audio.push(
        new Uint8Array(
          Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.from(data),
        ),
      );
    else messages.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  const send = (type: string, fields: Record<string, unknown> = {}) =>
    client.send(
      JSON.stringify({ version: 1, type, messageId: randomUUID(), ...fields }),
    );
  send("session.start", {
    conversationId: "untrusted-run",
    inputFormat: OPENHULI_PCM_FORMAT,
    ...(outputAudio
      ? { outputFormat: OPENHULI_PCM_FORMAT, streamingResponses: true }
      : {}),
  });
  await vi.waitFor(() => expect(messages[0]?.type).toBe("session.ready"));
  return {
    fake,
    audio,
    client,
    send,
    messages,
    conversationId: String(messages[0].sessionId),
  };
}
const read = (id: string): ProviderEvent => ({
  type: "tool",
  id,
  name: "device_context",
  arguments: { deviceId },
});
it("runs voice and typed follow-ups through durable authorized execution with metadata-only retention", async () => {
  const f = await setup([
    [
      read("voice-call"),
      { type: "text", text: "Configured room is Kitchen" },
      { type: "usage", inputTokens: 12, outputTokens: 6, final: true },
      { type: "complete" },
    ],
    [
      read("text-call"),
      { type: "text", text: "Still Kitchen" },
      { type: "complete" },
    ],
  ]);
  f.send("turn.start", { turnId: "voice-turn", turnSequence: 1, streamId: 1 });
  f.client.send(
    encodeOpenHuliAudio({
      kind: "input",
      turnSequence: 1,
      streamId: 1,
      sequence: 0,
      payload: new Uint8Array(640),
    }),
  );
  await vi.waitFor(() =>
    expect(f.fake.trace.some((event) => event.kind === "audio")).toBe(true),
  );
  expect(
    await db.toolExecution.count({
      where: { tenantId, runId: f.conversationId },
    }),
  ).toBe(0);
  f.send("turn.commit", { turnId: "voice-turn", lastSequence: 0 });
  await vi.waitFor(() =>
    expect(
      f.messages.some(
        (message) =>
          message.type === "turn.completed" && message.turnId === "voice-turn",
      ),
    ).toBe(true),
  );
  f.send("turn.text", {
    turnId: "text-turn",
    turnSequence: 2,
    text: "And which room was that?",
  });
  await vi.waitFor(() =>
    expect(
      f.messages.some(
        (message) =>
          message.type === "turn.completed" && message.turnId === "text-turn",
      ),
    ).toBe(true),
  );
  expect(f.fake.opened).toBe(1);
  const executions = await db.toolExecution.findMany({
    where: { tenantId, runId: f.conversationId },
  });
  expect(executions).toHaveLength(2);
  expect(
    executions.every((execution) => execution.status === "succeeded"),
  ).toBe(true);
  expect(
    executions.every(
      (execution) =>
        JSON.parse(execution.outputJson ?? "{}").room === "Kitchen",
    ),
  ).toBe(true);
  const messages = await db.message.findMany({
    where: { tenantId, runId: f.conversationId },
  });
  expect(messages).toHaveLength(4);
  expect(
    messages.every(
      (message) => message.contentText === null && message.partsJson === "[]",
    ),
  ).toBe(true);
  expect(
    await db.conversationUsage.count({
      where: { tenantId, runId: f.conversationId },
    }),
  ).toBe(4);
  const trace = JSON.stringify(f.fake.trace);
  expect(trace).not.toContain(token);
  expect(trace).not.toContain("JWT_SECRET");
  expect(trace).toContain('"liveReading":false');
});
it("rejects cross-tenant targets and revoked grants without a success claim", async () => {
  const f = await setup([
    [
      {
        type: "tool",
        id: "cross-call",
        name: "device_context",
        arguments: { deviceId: "other-tenant-device" },
      },
      { type: "text", text: "Success!" },
      { type: "complete" },
    ],
    [
      read("revoked-call"),
      { type: "text", text: "Success!" },
      { type: "complete" },
    ],
  ]);
  f.send("turn.text", {
    turnId: "cross-turn",
    turnSequence: 1,
    text: "Read another device",
  });
  await vi.waitFor(() =>
    expect(
      f.messages.some((message) => message.type === "turn.completed"),
    ).toBe(true),
  );
  await revokeOwnerDeviceGrant(deviceId, "device_context", owner(), devices);
  f.send("turn.text", {
    turnId: "revoked-turn",
    turnSequence: 2,
    text: "Read my device",
  });
  await vi.waitFor(() =>
    expect(
      f.messages.filter((message) => message.type === "turn.completed"),
    ).toHaveLength(2),
  );
  expect(JSON.stringify(f.messages)).not.toContain("Success!");
  expect(
    await db.toolExecution.count({
      where: { tenantId, runId: f.conversationId },
    }),
  ).toBe(0);
});

it("persists generation and actual playback receipt separately through the authenticated use cases", async () => {
  const f = await setup(
    [
      [
        { type: "text", text: "Hello" },
        { type: "audio", pcm24: new Uint8Array(960) },
        { type: "complete" },
      ],
    ],
    true,
  );
  f.send("turn.text", {
    turnId: "playback-turn",
    turnSequence: 1,
    text: "Hello",
  });
  await vi.waitFor(() =>
    expect(
      f.messages.some((m) => m.type === "audio.generation.completed"),
    ).toBe(true),
  );
  expect(f.audio).toHaveLength(1);
  const pending = await db.conversationTurn.findFirstOrThrow({
    where: { tenantId, runId: f.conversationId, id: "playback-turn" },
  });
  expect(pending.status).toBe("responding");
  expect(pending.generationCompletedAt).not.toBeNull();
  expect(pending.playbackCompletedAt).toBeNull();
  expect(f.messages.some((m) => m.type === "turn.completed")).toBe(false);
  const receipt = f.messages.find(
    (m) => m.type === "audio.generation.completed",
  )!;
  f.send("playback.completed", {
    turnId: "playback-turn",
    streamId: receipt.streamId,
    lastSequence: receipt.lastSequence,
  });
  await vi.waitFor(() =>
    expect(f.messages.some((m) => m.type === "turn.completed")).toBe(true),
  );
  const done = await db.conversationTurn.findFirstOrThrow({
    where: { tenantId, runId: f.conversationId, id: "playback-turn" },
  });
  expect(done.status).toBe("completed");
  expect(done.playbackCompletedAt).not.toBeNull();
});
it("cancels generated but unacknowledged output without inventing a playback timestamp", async () => {
  const f = await setup(
    [
      [
        { type: "text", text: "Hello" },
        { type: "audio", pcm24: new Uint8Array(960) },
        { type: "complete" },
      ],
    ],
    true,
  );
  f.send("turn.text", {
    turnId: "cancel-playback",
    turnSequence: 1,
    text: "Hello",
  });
  await vi.waitFor(() =>
    expect(
      f.messages.some((m) => m.type === "audio.generation.completed"),
    ).toBe(true),
  );
  f.send("turn.cancel", { turnId: "cancel-playback" });
  await vi.waitFor(async () => {
    const turn = await db.conversationTurn.findFirstOrThrow({
      where: { tenantId, runId: f.conversationId, id: "cancel-playback" },
    });
    expect(turn.status).toBe("cancelled");
    expect(turn.playbackCompletedAt).toBeNull();
  });
  expect(f.messages.some((m) => m.type === "turn.completed")).toBe(false);
});
