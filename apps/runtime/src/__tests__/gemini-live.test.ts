import { afterEach, expect, it, vi } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { createGeminiLiveProvider, GEMINI_LIVE_MODEL } from "../gemini-live";
import type { ConversationProvider } from "@corely/modules-conversations";
const servers: WebSocketServer[] = [],
  providers: ConversationProvider[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
  await Promise.all(
    servers.splice(0).map((server) => {
      for (const client of server.clients) client.terminate();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});
async function fixture() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const incoming: Record<string, unknown>[] = [];
  let peer: WebSocket | undefined;
  server.on("connection", (socket) => {
    peer = socket;
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      incoming.push(message);
      if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  const connect = vi.fn(
    (_url: string) => new WebSocket(`ws://127.0.0.1:${address.port}`),
  );
  const provider = await createGeminiLiveProvider(
    "synthetic-key-never-real",
    connect,
  ).open({
    context: {
      tenantId: "tenant",
      deviceId: "device",
      credentialId: "credential",
      sessionId: "session",
      conversationId: "session",
      signal: new AbortController().signal,
    },
    instructions: "Safe instructions",
    tools: [
      { id: "read", description: "Read", parameters: { type: "OBJECT" } },
    ],
  });
  providers.push(provider);
  return {
    provider,
    incoming,
    connect,
    send(value: unknown) {
      peer?.send(JSON.stringify(value));
    },
  };
}
it("uses fixed secure endpoint/model, manual commit, PCM16 input, and typed content", async () => {
  const f = await fixture();
  expect(f.connect.mock.calls[0][0]).toMatch(
    /^wss:\/\/generativelanguage.googleapis.com\//,
  );
  expect(f.incoming[0]).toMatchObject({
    setup: {
      model: `models/${GEMINI_LIVE_MODEL}`,
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    },
  });
  expect(f.incoming[0]).toMatchObject({
    setup: {
      tools: [
        { functionDeclarations: [{ name: "read", behavior: "BLOCKING" }] },
      ],
    },
  });
  await f.provider.begin("voice");
  await f.provider.audio(new Uint8Array(640));
  await vi.waitFor(() => expect(f.incoming).toHaveLength(3));
  expect(f.incoming[2]).toMatchObject({
    realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000" } },
  });
  expect(JSON.stringify(f.incoming)).not.toContain("activityEnd");
  await f.provider.commit();
  f.send({ serverContent: { outputTranscription: { text: "Heard" } } });
  f.send({ serverContent: { turnComplete: true } });
  expect(await f.provider.next()).toEqual({ type: "text", text: "Heard" });
  expect(await f.provider.next()).toEqual({ type: "complete" });
  await f.provider.begin("text");
  await f.provider.commit("Follow-up");
  await vi.waitFor(() =>
    expect(f.incoming.at(-1)).toEqual({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: "Follow-up" }] }],
        turnComplete: true,
      },
    }),
  );
  expect(JSON.stringify(f.incoming)).not.toContain("synthetic-key");
});
it("maps provider call IDs and returns the exact executor result before completion", async () => {
  const f = await fixture();
  await f.provider.begin("text");
  await f.provider.commit("Read");
  f.send({
    toolCall: {
      functionCalls: [{ id: "provider:id/opaque", name: "read", args: {} }],
    },
  });
  const call = await f.provider.next();
  if (call.type !== "tool") throw new Error("tool");
  expect(call.id).toMatch(/^call-/);
  await f.provider.result(call.id, "read", { status: "failed", output: null });
  await vi.waitFor(() =>
    expect(f.incoming.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [
          {
            id: "provider:id/opaque",
            name: "read",
            response: { status: "failed", output: null },
          },
        ],
      },
    }),
  );
  f.send({ serverContent: { turnComplete: true } });
  expect(await f.provider.next()).toEqual({ type: "complete" });
});
it.each(["precommit", "premature-completion", "error", "overload", "thoughts"])(
  "handles %s without exposing provider internals",
  async (kind) => {
    const f = await fixture();
    if (kind !== "precommit") {
      await f.provider.begin("text");
      await f.provider.commit("Hello");
    }
    if (kind === "precommit")
      f.send({
        toolCall: { functionCalls: [{ id: "id", name: "read", args: {} }] },
      });
    if (kind === "premature-completion") {
      f.send({
        toolCall: { functionCalls: [{ id: "id", name: "read", args: {} }] },
      });
      await f.provider.next();
      f.send({ serverContent: { turnComplete: true } });
    }
    if (kind === "error")
      f.send({ error: { message: "private provider secret details" } });
    if (kind === "overload")
      for (let i = 0; i < 70; i++)
        f.send({ serverContent: { outputTranscription: { text: "chunk" } } });
    if (kind === "thoughts") {
      f.send({
        serverContent: {
          modelTurn: { parts: [{ thought: true, text: "Private reasoning" }] },
          outputTranscription: { text: "Public answer" },
          turnComplete: true,
        },
      });
      expect(await f.provider.next()).toEqual({
        type: "text",
        text: "Public answer",
      });
      expect(await f.provider.next()).toEqual({ type: "complete" });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(f.provider.next()).rejects.toThrow("AI provider unavailable");
  },
);
it("closes an opening connection when cancelled, without waiting for setup", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const controller = new AbortController();
  const opening = createGeminiLiveProvider(
    "synthetic-key",
    () => new WebSocket(`ws://127.0.0.1:${address.port}`),
  ).open({
    context: {
      tenantId: "tenant",
      deviceId: "device",
      credentialId: "credential",
      sessionId: "session",
      conversationId: "session",
      signal: controller.signal,
    },
    instructions: "test",
    tools: [],
  });
  controller.abort();
  await expect(opening).rejects.toThrow("AI provider unavailable");
});
it("forwards only validated public native PCM and never thought audio", async () => {
  const f = await fixture();
  await f.provider.begin("text");
  await f.provider.commit("Hi");
  const data = Buffer.alloc(960).toString("base64");
  f.send({
    serverContent: {
      modelTurn: {
        parts: [
          {
            thought: true,
            inlineData: { mimeType: "audio/pcm;rate=24000", data },
          },
          { inlineData: { mimeType: "audio/pcm;rate=24000", data } },
        ],
      },
      turnComplete: true,
    },
  });
  expect(await f.provider.next()).toEqual({
    type: "audio",
    pcm24: Buffer.alloc(960),
  });
  expect(await f.provider.next()).toEqual({ type: "complete" });
});
it.each(["audio/pcm;rate=16000", "audio/wav", "audio/pcm;rate=48000"])(
  "rejects unsupported public output format %s",
  async (mimeType) => {
    const f = await fixture();
    await f.provider.begin("text");
    await f.provider.commit("Hi");
    f.send({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType, data: "AAAA" } }] },
      },
    });
    await expect(f.provider.next()).rejects.toThrow("AI provider unavailable");
  },
);
it("leaves incomplete usage unknown and delivers same-packet usage before tool dispatch", async () => {
  const f = await fixture();
  await f.provider.begin("text");
  await f.provider.commit("Hi");
  f.send({
    usageMetadata: { promptTokenCount: 10 },
    serverContent: { turnComplete: true },
  });
  expect(await f.provider.next()).toEqual({ type: "complete" });
  await f.provider.begin("text");
  await f.provider.commit("Next");
  f.send({
    usageMetadata: { promptTokenCount: 20, responseTokenCount: 5 },
    toolCall: {
      functionCalls: [{ id: "provider-id", name: "read", args: {} }],
    },
  });
  expect(await f.provider.next()).toEqual({
    type: "usage",
    final: false,
    inputTokens: 20,
    outputTokens: 5,
  });
  expect(await f.provider.next()).toMatchObject({ type: "tool", name: "read" });
});
