import { afterEach, expect, it, vi } from "vitest";
import { setTimeout as pause } from "node:timers/promises";
import { OPENHULI_PCM_FORMAT } from "@corely/contracts";
import {
  createConversationRuntime,
  type ConversationJournal,
} from "@corely/modules-conversations";
import { createFakeConversationProvider } from "@corely/modules-conversations/testing";
import { createRuntime } from "../runtime";
import { readRuntimeConfig } from "../config";
import { runPlaybackSimulator } from "../playback-simulator";
const hosts: ReturnType<typeof createRuntime>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});
async function fixture(speaker = true, progress = false) {
  const fake = createFakeConversationProvider([
    [
      ...(progress
        ? [
            {
              type: "tool" as const,
              id: "call",
              name: "synthetic.read",
              arguments: {},
            },
          ]
        : []),
      { type: "text", text: "Public greeting" },
      { type: "audio", pcm24: new Uint8Array(9600) },
      { type: "complete" },
    ],
  ]);
  const journal: ConversationJournal = {
    start: vi.fn(async () => {}),
    turn: vi.fn(async () => {}),
    transition: vi.fn(async () => {}),
    message: vi.fn(async () => {}),
    usage: vi.fn(async () => {}),
    audioCompletion: vi.fn(async () => {}),
  };
  const provider = createConversationRuntime({
    provider: fake.factory,
    journal,
    tools: progress
      ? [
          {
            id: "synthetic.read",
            description: "Synthetic client progress fixture",
            parameters: { type: "OBJECT", properties: {} },
          },
        ]
      : [],
    execute: async (_context, _call, pending) => {
      pending?.("execution");
      await pause(5);
      return { executionId: "execution", status: "succeeded" };
    },
    maxToolCalls: 1,
    turnTimeoutMs: 2000,
  });
  const host = createRuntime(
    readRuntimeConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://synthetic@127.0.0.1/unused",
      RUNTIME_VOICE_ENABLED: "true",
      RUNTIME_PORT: "0",
    }),
    {
      voice: {
        provider,
        authorization: {
          async authenticate(token) {
            if (token !== "synthetic") throw new Error("Bad credential");
            return {
              identity: {
                tenantId: "tenant",
                deviceId: "device",
                credentialId: "credential",
                expiresAt: new Date(Date.now() + 60000),
              },
              manifest: {
                version: 1,
                type: "device.manifest",
                messageId: "manifest",
                deviceId: "device",
                firmwareVersion: "test",
                capabilities: [
                  { kind: "microphone", format: OPENHULI_PCM_FORMAT },
                  ...(speaker
                    ? [
                        {
                          kind: "speaker" as const,
                          format: OPENHULI_PCM_FORMAT,
                        },
                      ]
                    : []),
                ],
              },
            };
          },
          async revalidate() {},
          watch() {
            return () => {};
          },
          async close() {},
        },
      },
    },
  );
  hosts.push(host);
  const address = await host.start();
  return { journal, fake, endpoint: `ws://127.0.0.1:${address.port}/voice` };
}
it("demonstrates first playback before generation completes over the authenticated socket", async () => {
  const f = await fixture();
  const result = await runPlaybackSimulator({
    endpoint: f.endpoint,
    token: "synthetic",
    text: "Hello",
    async sink(pcm, signal) {
      expect(pcm).toHaveLength(640);
      await pause(20, undefined, { signal });
    },
  });
  expect(result.frames).toBe(10);
  expect(result.firstFrameBeforeGeneration).toBe(true);
  expect(f.journal.audioCompletion).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ tenantId: "tenant", deviceId: "device" }),
    "generation",
  );
  expect(f.journal.audioCompletion).toHaveBeenNthCalledWith(
    2,
    expect.anything(),
    "playback",
  );
  expect(f.journal.transition).toHaveBeenLastCalledWith(
    expect.anything(),
    "completed",
  );
});
it("cancels the current sink, clears queued frames and never acknowledges playback", async () => {
  const f = await fixture(),
    controller = new AbortController();
  let sinks = 0;
  const run = runPlaybackSimulator({
    endpoint: f.endpoint,
    token: "synthetic",
    text: "Hello",
    signal: controller.signal,
    async sink(_pcm, signal) {
      sinks++;
      setTimeout(() => controller.abort(), 5);
      await pause(100, undefined, { signal });
    },
  });
  await expect(run).rejects.toThrow(/cancelled/);
  await vi.waitFor(() =>
    expect(f.journal.transition).toHaveBeenCalledWith(
      expect.anything(),
      "cancelled",
    ),
  );
  await pause(50);
  expect(sinks).toBe(1);
  expect(f.journal.audioCompletion).not.toHaveBeenCalledWith(
    expect.anything(),
    "playback",
  );
  expect(f.journal.transition).not.toHaveBeenCalledWith(
    expect.anything(),
    "completed",
  );
});
it("keeps speakerless output usable without waiting for a playback receipt", async () => {
  const f = await fixture(false),
    sink = vi.fn(async () => {});
  const result = await runPlaybackSimulator({
    endpoint: f.endpoint,
    token: "synthetic",
    text: "Hello",
    speaker: false,
    sink,
  });
  expect(result.frames).toBe(0);
  expect(sink).not.toHaveBeenCalled();
  expect(f.journal.message).toHaveBeenCalledWith(
    expect.anything(),
    "assistant",
    "Public greeting",
  );
  expect(f.journal.audioCompletion).not.toHaveBeenCalled();
});
it("requires credentials and rejects unverified remote WS before any provider turn", async () => {
  const f = await fixture();
  await expect(
    runPlaybackSimulator({
      endpoint: f.endpoint,
      token: "invalid",
      text: "Hello",
      async sink() {},
    }),
  ).rejects.toThrow();
  expect(f.fake.opened).toBe(0);
  await expect(
    runPlaybackSimulator({
      endpoint: "ws://example.com/voice",
      token: "synthetic",
      text: "Hello",
      async sink() {},
    }),
  ).rejects.toThrow(/WSS/);
});
it("settles a pre-cancelled connection without opening a provider or leaking a socket error", async () => {
  const f = await fixture(),
    controller = new AbortController();
  controller.abort();
  await expect(
    runPlaybackSimulator({
      endpoint: f.endpoint,
      token: "synthetic",
      text: "Hello",
      signal: controller.signal,
      async sink() {},
    }),
  ).rejects.toThrow(/cancelled/);
  expect(f.fake.opened).toBe(0);
});

it("keeps the terminal tool status after intermediate approval progress", async () => {
  const f = await fixture(false, true),
    statuses: string[] = [];
  const result = await runPlaybackSimulator({
    endpoint: f.endpoint,
    token: "synthetic",
    text: "Synthetic read",
    speaker: false,
    async sink() {},
    onEvent(message) {
      if (message.type === "tool.result") statuses.push(message.status);
    },
  });
  expect(statuses).toEqual(["awaiting_approval", "succeeded"]);
  expect(result.toolResults).toEqual([
    { executionId: "execution", status: "succeeded" },
  ]);
});
