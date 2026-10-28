import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { PrismaService } from "@corely/data";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
} from "@corely/modules-devices";
import { OPENHULI_PCM_FORMAT, encodeOpenHuliAudio } from "@corely/contracts";
import type { VoiceProviderFactory } from "@corely/modules-voice";
import { getTestDatabaseUrl } from "../../../../scripts/test-database";
import { createVoiceAuthorization } from "../device-authorization";
import { createRuntime } from "../runtime";
import { readRuntimeConfig } from "../config";
process.env.DATABASE_URL = getTestDatabaseUrl();
const db = new PrismaService(),
  store = new DeviceAccessRepository(db);
let tenantId: string;
let paired: Awaited<ReturnType<typeof pairOwnerDevice>>;
const hosts: ReturnType<typeof createRuntime>[] = [];
const clients: WebSocket[] = [];
const token = (purpose: "voice" | "mqtt") => {
  const credential = paired.credentials.find(
    (value) => value.purpose === purpose,
  );
  if (!credential) throw new Error("Missing credential");
  return credential;
};
async function setup() {
  const append = vi.fn(async () => {}),
    commit = vi.fn(async () => {});
  const provider: VoiceProviderFactory = {
    isReady: () => true,
    supportsOutputAudio: false,
    open: async () => ({
      startTurn: async () => ({
        appendAudio: append,
        commit,
        stop: async () => {},
      }),
      close: async () => {},
    }),
  };
  const host = createRuntime(
    readRuntimeConfig({
      ...process.env,
      NODE_ENV: "test",
      RUNTIME_PORT: "0",
      RUNTIME_VOICE_ENABLED: "true",
    }),
    { voice: { authorization: createVoiceAuthorization(), provider } },
  );
  hosts.push(host);
  return { host, port: (await host.start()).port, append, commit };
}
function connect(port: number, credential: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/voice`, {
      headers: { authorization: `Bearer ${credential}` },
    });
    clients.push(client);
    client.once("open", () => resolve(client));
    client.on("error", reject);
  });
}
function rejected(port: number, credential: string) {
  return new Promise<number>((resolve) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/voice`, {
      headers: { authorization: `Bearer ${credential}` },
    });
    clients.push(client);
    client.on("error", () => {});
    client.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode || 0);
      client.terminate();
    });
  });
}
function send(
  client: WebSocket,
  type: string,
  fields: Record<string, unknown> = {},
) {
  client.send(
    JSON.stringify({ version: 1, type, messageId: randomUUID(), ...fields }),
  );
}
beforeAll(async () => {
  tenantId = (
    await db.tenant.create({
      data: { name: "Synthetic voice tenant", slug: randomUUID() },
    })
  ).id;
  paired = await pairOwnerDevice(
    {
      name: "Synthetic microphone",
      profileId: "esp32-voice",
      profileVersion: 1,
      capabilities: [
        { kind: "microphone", format: OPENHULI_PCM_FORMAT },
        { kind: "ping" },
      ],
    },
    { tenantId, userId: "synthetic-owner" },
    store,
  );
});
afterAll(async () => {
  for (const client of clients) client.terminate();
  await Promise.all(hosts.map((host) => host.stop()));
  if (tenantId) {
    await db.device.deleteMany({ where: { tenantId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });
  }
  await db.disconnect();
});
describe("voice sockets with stored scoped credentials", () => {
  it("accepts voice scope, denies MQTT/tampered secrets, and rechecks revocation before commit", async () => {
    const f = await setup();
    expect(await rejected(f.port, token("mqtt").token)).toBe(401);
    const original = token("voice").token;
    expect(
      await rejected(
        f.port,
        original.slice(0, -1) + (original.endsWith("A") ? "B" : "A"),
      ),
    ).toBe(401);
    const client = await connect(f.port, original);
    let ready = false;
    client.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "session.ready") ready = true;
    });
    send(client, "session.start", {
      conversationId: "untrusted-cross-tenant-reference",
      inputFormat: OPENHULI_PCM_FORMAT,
    });
    await vi.waitFor(() => expect(ready).toBe(true));
    send(client, "turn.start", {
      turnId: "turn",
      turnSequence: 1,
      streamId: 1,
    });
    client.send(
      encodeOpenHuliAudio({
        kind: "input",
        turnSequence: 1,
        streamId: 1,
        sequence: 0,
        payload: new Uint8Array(640),
      }),
    );
    await vi.waitFor(() => expect(f.append).toHaveBeenCalledOnce());
    await db.deviceCredential.update({
      where: { id: token("voice").credentialId },
      data: { revokedAt: new Date() },
    });
    const closed = new Promise<number>((resolve) =>
      client.once("close", resolve),
    );
    send(client, "turn.commit", { turnId: "turn", lastSequence: 0 });
    expect(await closed).toBe(1008);
    expect(f.commit).not.toHaveBeenCalled();
    expect(await rejected(f.port, original)).toBe(401);
  });
  it("expires an open socket at the bound credential deadline without another message", async () => {
    await db.deviceCredential.update({
      where: { id: token("voice").credentialId },
      data: { revokedAt: null, expiresAt: new Date(Date.now() + 1000) },
    });
    const f = await setup();
    const client = await connect(f.port, token("voice").token);
    const closed = new Promise<number>((resolve) =>
      client.once("close", resolve),
    );
    expect(await closed).toBe(1008);
    expect(f.commit).not.toHaveBeenCalled();
  });
});
