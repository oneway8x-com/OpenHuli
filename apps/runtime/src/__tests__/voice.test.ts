import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  OPENHULI_PCM_FORMAT,
  encodeOpenHuliAudio,
  type OpenHuliVoiceServerMessage,
} from "@corely/contracts";
import type {
  BoundVoiceDevice,
  VoiceAuthorization,
  VoiceOutput,
  VoiceProviderFactory,
  VoiceProviderTurn,
  VoiceSessionContext,
  VoiceTurnContext,
} from "@corely/modules-voice";
import { createRuntime } from "../runtime";
import type { RuntimeDependency } from "../ports";
import { readRuntimeConfig } from "../config";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const bound: BoundVoiceDevice = {
  identity: {
    tenantId: "tenant",
    deviceId: "device",
    credentialId: "credential",
    expiresAt: new Date(Date.now() + 600000),
  },
  manifest: {
    version: 1,
    type: "device.manifest",
    messageId: "manifest",
    deviceId: "device",
    firmwareVersion: "synthetic",
    capabilities: [
      { kind: "microphone", format: OPENHULI_PCM_FORMAT },
      { kind: "ping" },
      { kind: "speaker", format: OPENHULI_PCM_FORMAT },
    ],
  },
};
const hosts: ReturnType<typeof createRuntime>[] = [];
const clients: WebSocket[] = [];
type TurnRecord = {
  context: VoiceTurnContext;
  output: VoiceOutput;
  handle: VoiceProviderTurn;
  frames: number[];
};
function fixture(
  env: NodeJS.ProcessEnv = {},
  dependencies: RuntimeDependency[] = [],
) {
  const turns: TurnRecord[] = [],
    contexts: VoiceSessionContext[] = [];
  let revoked = false;
  const authorization: VoiceAuthorization = {
    authenticate: vi.fn(async (token) => {
      if (token !== "synthetic-voice-token") throw new Error("secret");
      return bound;
    }),
    revalidate: vi.fn(async () => {
      if (revoked) throw new Error("revoked");
    }),
    watch: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  };
  const provider: VoiceProviderFactory = {
    isReady: () => true,
    supportsOutputAudio: true,
    open: vi.fn(async (context) => {
      contexts.push(context);
      return {
        startTurn: vi.fn(async (turn, output) => {
          const frames: number[] = [];
          const handle: VoiceProviderTurn = {
            appendAudio: vi.fn(async (frame) => {
              frames.push(frame.sequence);
            }),
            commit: vi.fn(async () => {}),
            stop: vi.fn(async () => {}),
          };
          turns.push({ context: turn, output, handle, frames });
          return handle;
        }),
        close: vi.fn(async () => {}),
      };
    }),
  };
  const config = readRuntimeConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1/unused",
    RUNTIME_VOICE_ENABLED: "true",
    RUNTIME_PORT: "0",
    RUNTIME_IDLE_TIMEOUT_MS: "5000",
    ...env,
  });
  const host = createRuntime(config, {
    dependencies,
    voice: { authorization, provider },
  });
  hosts.push(host);
  return {
    host,
    authorization,
    provider,
    turns,
    contexts,
    revoke() {
      revoked = true;
    },
  };
}
function connect(
  port: number,
  token = "synthetic-voice-token",
  extra: Record<string, string> = {},
) {
  return new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/voice`, {
      headers: { authorization: `Bearer ${token}`, ...extra },
      handshakeTimeout: 1000,
    });
    clients.push(client);
    client.once("open", () => resolve(client));
    client.on("error", reject);
  });
}
function rejected(
  port: number,
  token = "invalid",
  path = "/voice",
  extra: Record<string, string> = {},
) {
  return new Promise<number>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: { authorization: `Bearer ${token}`, ...extra },
      handshakeTimeout: 1000,
    });
    clients.push(client);
    client.on("error", () => {});
    client.once("unexpected-response", (_req, response) => {
      const status = response.statusCode || 0;
      response.resume();
      resolve(status);
      client.terminate();
    });
    client.once("open", () => reject(new Error("Unexpected open")));
  });
}
function send(
  client: WebSocket,
  type: string,
  fields: Record<string, unknown> = {},
) {
  client.send(
    JSON.stringify({ version: 1, messageId: randomUUID(), type, ...fields }),
  );
}
function listen(client: WebSocket) {
  const messages: OpenHuliVoiceServerMessage[] = [];
  client.on("message", (data, binary) => {
    if (!binary) messages.push(JSON.parse(data.toString()));
  });
  return messages;
}
async function negotiate(port: number) {
  const client = await connect(port);
  const messages = listen(client);
  send(client, "session.start", {
    conversationId: "untrusted-other-conversation",
    inputFormat: OPENHULI_PCM_FORMAT,
    outputFormat: OPENHULI_PCM_FORMAT,
  });
  await vi.waitFor(() =>
    expect(messages.some((item) => item.type === "session.ready")).toBe(true),
  );
  return { client, messages };
}
function turn(client: WebSocket, sequence = 1, turnId = "turn", streamId = 1) {
  send(client, "turn.start", { turnId, turnSequence: sequence, streamId });
}
function pcm(sequence: number, turnSequence = 1, streamId = 1) {
  return encodeOpenHuliAudio({
    kind: "input",
    streamId,
    turnSequence,
    sequence,
    payload: new Uint8Array(640),
  });
}
function closed(client: WebSocket) {
  return new Promise<number>((resolve) =>
    client.once("close", (code) => resolve(code)),
  );
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(hosts.splice(0).map((host) => host.stop().catch(() => {})));
});
describe("authenticated voice socket lifecycle", () => {
  it("streams paced PCM before commit, then dispatches once with server-derived authority", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const { client, messages } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const record = f.turns[0]!;
    expect(
      record.output.control({
        version: 1,
        type: "response.text",
        messageId: randomUUID(),
        turnId: "turn",
        text: "early",
      }),
    ).toBe(false);
    for (let i = 0; i < 3; i++) {
      client.send(pcm(i));
      await pause(20);
      await vi.waitFor(() => expect(record.frames).toHaveLength(i + 1));
      expect(record.handle.commit).not.toHaveBeenCalled();
    }
    send(client, "turn.commit", { turnId: "turn", lastSequence: 2 });
    await vi.waitFor(() => expect(record.handle.commit).toHaveBeenCalledOnce());
    expect(f.contexts[0]).toMatchObject({
      tenantId: "tenant",
      deviceId: "device",
    });
    expect(f.contexts[0]?.conversationId).not.toBe(
      "untrusted-other-conversation",
    );
    expect(
      record.output.control({
        version: 1,
        type: "response.text",
        messageId: randomUUID(),
        turnId: "turn",
        text: "accepted",
      }),
    ).toBe(true);
    expect(
      record.output.control({
        version: 1,
        type: "turn.completed",
        messageId: randomUUID(),
        turnId: "turn",
      }),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(
        messages.some((message) => message.type === "turn.completed"),
      ).toBe(true),
    );
  });
  it("reassembles WebSocket fragments while rejecting malformed complete frames", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const frame = pcm(0);
    client.send(frame.slice(0, 13), { binary: true, fin: false });
    client.send(frame.slice(13), { binary: true, fin: true });
    await vi.waitFor(() => expect(f.turns[0]?.frames).toEqual([0]));
    const done = closed(client);
    client.send(frame.slice(0, 30));
    expect(await done).toBe(1008);
    expect(f.turns[0]?.handle.commit).not.toHaveBeenCalled();
  });
  it("disconnects before commit without dispatch and reconnects with fresh IDs and no audio replay", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const first = await negotiate(port);
    turn(first.client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    first.client.send(pcm(0));
    await vi.waitFor(() => expect(f.turns[0]?.frames).toHaveLength(1));
    const firstSession = f.contexts[0]?.sessionId;
    first.client.terminate();
    await vi.waitFor(() =>
      expect(f.turns[0]?.context.signal.aborted).toBe(true),
    );
    await vi.waitFor(() => expect(f.host.health().connections).toBe(0));
    const second = await negotiate(port);
    expect(f.contexts[1]?.sessionId).not.toBe(firstSession);
    expect(f.contexts[1]?.conversationId).not.toBe(
      f.contexts[0]?.conversationId,
    );
    const done = closed(second.client);
    second.client.send(pcm(1));
    expect(await done).toBe(1008);
    expect(f.turns[0]?.handle.commit).not.toHaveBeenCalled();
  });
  it("drops a disconnected partial WebSocket message without forwarding or commit", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    client.send(pcm(0).slice(0, 20), { binary: true, fin: false });
    client.terminate();
    await vi.waitFor(() =>
      expect(f.turns[0]?.context.signal.aborted).toBe(true),
    );
    expect(f.turns[0]?.frames).toHaveLength(0);
    expect(f.turns[0]?.handle.commit).not.toHaveBeenCalled();
  });
  it("cancels promptly even when a queued commit is behind a slow consumer", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const record = f.turns[0]!;
    let release: () => void = () => {};
    vi.mocked(record.handle.appendAudio).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    client.send(pcm(0));
    await vi.waitFor(() =>
      expect(record.handle.appendAudio).toHaveBeenCalled(),
    );
    send(client, "turn.commit", { turnId: "turn", lastSequence: 0 });
    send(client, "turn.cancel", { turnId: "turn" });
    await vi.waitFor(() => expect(record.context.signal.aborted).toBe(true));
    release();
    await pause(20);
    expect(record.handle.commit).not.toHaveBeenCalled();
    expect(record.output.audio(pcm(0))).toBe(false);
  });
  it("aborts rather than accumulating a slow consumer queue", async () => {
    const f = fixture({ RUNTIME_VOICE_QUEUE_BYTES: "1328" });
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const record = f.turns[0]!;
    let release: () => void = () => {};
    vi.mocked(record.handle.appendAudio).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const done = closed(client);
    client.send(pcm(0));
    await vi.waitFor(() =>
      expect(record.handle.appendAudio).toHaveBeenCalled(),
    );
    client.send(pcm(1));
    client.send(pcm(2));
    expect(await done).toBe(1013);
    release();
    expect(record.handle.commit).not.toHaveBeenCalled();
  });
  it("bounds a stalled provider operation by a deadline", async () => {
    const f = fixture({ RUNTIME_VOICE_OPERATION_TIMEOUT_MS: "100" });
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const record = f.turns[0]!;
    vi.mocked(record.handle.appendAudio).mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          record.context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        ),
    );
    const done = closed(client);
    client.send(pcm(0));
    expect(await done).toBe(1011);
    expect(record.context.signal.aborted).toBe(true);
    expect(record.handle.commit).not.toHaveBeenCalled();
  });
  it("rejects undeclared streams and oversized payloads", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const first = await negotiate(port);
    turn(first.client);
    const invalid = closed(first.client);
    first.client.send(pcm(0, 1, 99));
    expect(await invalid).toBe(1008);
    await vi.waitFor(() => expect(f.host.health().connections).toBe(0));
    const second = await negotiate(port);
    const large = closed(second.client);
    second.client.send(new Uint8Array(20000));
    expect(await large).toBe(1009);
  });
  it("rejects stale provider responses without injecting them into another turn", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const old = f.turns[0]!;
    send(client, "turn.cancel", { turnId: "turn" });
    turn(client, 2, "next", 2);
    await vi.waitFor(() => expect(f.turns).toHaveLength(2));
    expect(
      old.output.control({
        version: 1,
        type: "response.text",
        messageId: randomUUID(),
        turnId: "next",
        text: "stale",
      }),
    ).toBe(false);
    expect(old.output.audio(pcm(0))).toBe(false);
    expect(client.readyState).toBe(WebSocket.OPEN);
  });
  it("rechecks revocation at commit and closes idle sessions through the watchdog callback", async () => {
    const f = fixture();
    let revoke: () => void = () => {};
    vi.mocked(f.authorization.watch).mockImplementation(
      (_identity, callback) => {
        revoke = callback;
        return () => {};
      },
    );
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    client.send(pcm(0));
    await vi.waitFor(() => expect(f.turns[0]?.frames).toHaveLength(1));
    f.revoke();
    const done = closed(client);
    send(client, "turn.commit", { turnId: "turn", lastSequence: 0 });
    expect(await done).toBe(1008);
    expect(f.turns[0]?.handle.commit).not.toHaveBeenCalled();
    const g = fixture();
    vi.mocked(g.authorization.watch).mockImplementation(
      (_identity, callback) => {
        revoke = callback;
        return () => {};
      },
    );
    const address = await g.host.start();
    const second = await negotiate(address.port);
    const idle = closed(second.client);
    revoke();
    expect(await idle).toBe(1008);
  });
  it("bounds credentials and session/turn wall time independently from audio sequence limits", async () => {
    const f = fixture({ RUNTIME_VOICE_TURN_TIMEOUT_MS: "100" });
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    const done = closed(client);
    turn(client);
    expect(await done).toBe(1008);
    const g = fixture({ RUNTIME_VOICE_SESSION_TIMEOUT_MS: "100" });
    const address = await g.host.start();
    const second = await connect(address.port);
    const lifetime = closed(second);
    expect(await lifetime).toBe(1008);
  });
  it("denies invalid credentials, browser origins, URL credentials and concurrent device sessions", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    expect(await rejected(port)).toBe(401);
    expect(
      await rejected(port, "synthetic-voice-token", "/voice", {
        origin: "https://example.test",
      }),
    ).toBe(401);
    expect(
      await rejected(port, "synthetic-voice-token", "/voice?token=secret"),
    ).toBe(404);
    await negotiate(port);
    expect(await rejected(port, "synthetic-voice-token")).toBe(409);
  });
  it("bounds pending authentication even after a socket times out", async () => {
    const f = fixture({
      RUNTIME_MAX_CONNECTIONS: "1",
      RUNTIME_STARTUP_TIMEOUT_MS: "100",
    });
    let release: (value: BoundVoiceDevice) => void = () => {};
    vi.mocked(f.authorization.authenticate).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { port } = await f.host.start();
    const first = connect(port).catch(() => null);
    await vi.waitFor(() =>
      expect(f.authorization.authenticate).toHaveBeenCalledOnce(),
    );
    await first;
    expect(await rejected(port, "synthetic-voice-token")).toBe(503);
    expect(f.authorization.authenticate).toHaveBeenCalledOnce();
    release(bound);
    await vi.waitFor(() => expect(f.host.health().connections).toBe(0));
  });
  it("rejects voice upgrades while a configured dependency is unavailable", async () => {
    const dependency: RuntimeDependency = {
      name: "mqtt",
      start: async () => {},
      isReady: () => false,
      stop: async () => {},
    };
    const f = fixture({}, [dependency]);
    const { port } = await f.host.start();
    expect(f.host.health().ready).toBe(false);
    expect(await rejected(port, "synthetic-voice-token")).toBe(503);
    expect(f.provider.open).not.toHaveBeenCalled();
  });
  it("keeps an unavailable provider explicit and never opens a device stream", async () => {
    const f = fixture();
    f.provider.isReady = () => false;
    const { port } = await f.host.start();
    expect(f.host.health().voice).toBe("unconfigured");
    expect(f.host.health().ready).toBe(false);
    expect(await rejected(port, "synthetic-voice-token")).toBe(503);
    expect(f.provider.open).not.toHaveBeenCalled();
  });
  it("redacts provider failures from socket errors", async () => {
    const f = fixture();
    vi.mocked(f.provider.open).mockRejectedValue(
      new Error("sensitive-provider-token"),
    );
    const { port } = await f.host.start();
    const client = await connect(port);
    const messages = listen(client);
    const done = closed(client);
    send(client, "session.start", {
      conversationId: "request",
      inputFormat: OPENHULI_PCM_FORMAT,
    });
    expect(await done).toBe(1011);
    expect(JSON.stringify(messages)).not.toContain("sensitive-provider-token");
    expect(messages.some((message) => message.type === "session.error")).toBe(
      true,
    );
  });
  it("shuts down provider sessions, sockets and authorization resources", async () => {
    const f = fixture();
    const { port } = await f.host.start();
    const { client } = await negotiate(port);
    turn(client);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const done = closed(client);
    await f.host.stop();
    expect(await done).toBe(1001);
    expect(f.turns[0]?.context.signal.aborted).toBe(true);
    expect(f.turns[0]?.handle.stop).toHaveBeenCalledOnce();
    expect(f.authorization.close).toHaveBeenCalledOnce();
  });
});
