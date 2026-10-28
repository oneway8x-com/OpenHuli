import { expect, it, vi } from "vitest";
import { createConversationRuntime } from "../conversation-runtime";
import { createFakeConversationProvider } from "../fake-conversation-provider";
import type {
  ConversationJournal,
  ProviderEvent,
} from "../conversation-runtime.types";
import type { VoiceTurnContext, VoiceOutput } from "@corely/modules-voice";
const context = {
  streamingResponses: true,
  tenantId: "tenant",
  deviceId: "device",
  credentialId: "credential",
  sessionId: "session",
  conversationId: "session",
  signal: new AbortController().signal,
};
const done: ProviderEvent = { type: "complete" };
const call: ProviderEvent = {
  type: "tool",
  id: "call-1",
  name: "test_read",
  arguments: { deviceId: "device" },
};
function fixture(
  turns: ProviderEvent[][],
  execute = vi.fn(async () => ({
    status: "succeeded",
    output: { value: "actual" },
  })),
  budget = 6,
) {
  const fake = createFakeConversationProvider(turns);
  const journal: ConversationJournal = {
    start: vi.fn(async () => {}),
    turn: vi.fn(async () => {}),
    transition: vi.fn(async () => {}),
    message: vi.fn(async () => {}),
    usage: vi.fn(async () => {}),
  };
  const factory = createConversationRuntime({
    provider: fake.factory,
    journal,
    tools: [{ id: "test_read", description: "test", parameters: {} }],
    execute,
    maxToolCalls: budget,
    turnTimeoutMs: 100,
  });
  const output: VoiceOutput = {
    control: vi.fn(() => true),
    audio: vi.fn(() => true),
  };
  return { fake, journal, factory, output, execute };
}
function turn(sequence = 1, source: "text" | "voice" = "voice") {
  const controller = new AbortController();
  const current: VoiceTurnContext = {
    ...context,
    turnId: `turn-${sequence}`,
    turnSequence: sequence,
    source,
    signal: controller.signal,
  };
  return { current, controller };
}
function commit(current: VoiceTurnContext) {
  return { ...current, lastSequence: 0, committedAt: new Date() };
}
it("streams input before commit without dispatch, feeds actual results back, and gates completion", async () => {
  const f = fixture([
    [
      { type: "text", text: "Provisional success" },
      call,
      { type: "text", text: "Actual read result" },
      { type: "usage", inputTokens: 10, outputTokens: 5, final: true },
      done,
    ],
  ]);
  const session = await f.factory.open(context),
    t = turn();
  const handle = await session.startTurn(t.current, f.output);
  await handle.appendAudio({
    kind: "input",
    turnSequence: 1,
    streamId: 1,
    sequence: 0,
    payload: new Uint8Array(640),
  });
  expect(f.fake.trace.at(-1)?.kind).toBe("audio");
  expect(f.execute).not.toHaveBeenCalled();
  await handle.commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  expect(f.fake.trace.find((item) => item.kind === "result")?.value).toEqual({
    id: "call-1",
    name: "test_read",
    result: { status: "succeeded", output: { value: "actual" } },
  });
  expect(f.output.control).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "Actual read result\nTool results: call-1: succeeded",
    }),
  );
  expect(f.journal.usage).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "tenant" }),
    "input_tokens",
    10,
  );
  await session.close();
});
it("preserves one provider connection across typed follow-ups and completes only the final response", async () => {
  const f = fixture([
    [{ type: "text", text: "Which target?" }, done],
    [{ type: "text", text: "Target clarified" }, done],
  ]);
  const session = await f.factory.open(context);
  for (let sequence = 1; sequence <= 2; sequence++) {
    const t = turn(sequence, "text"),
      handle = await session.startTurn(t.current, f.output);
    await handle.appendText?.(
      sequence === 1 ? "Do it" : "Use my kitchen device",
    );
    await handle.commit(commit(t.current));
    await vi.waitFor(() =>
      expect(f.journal.transition).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: t.current.turnId }),
        "completed",
      ),
    );
  }
  expect(f.fake.opened).toBe(1);
  expect(
    f.fake.trace
      .filter((item) => item.kind === "commit")
      .map((item) => item.value),
  ).toEqual(["Do it", "Use my kitchen device"]);
  expect(f.journal.usage).not.toHaveBeenCalled(); // Unknown usage is not recorded as zero.
  await session.close();
});
it.each([
  "denied",
  "failed",
  "unknown",
  "awaiting_approval",
  "cancelled",
  "expired",
])("never relays a fabricated success after %s", async (status) => {
  const execute = vi.fn(async () => ({ status, output: { value: "actual" } }));
  const f = fixture(
    [[call, { type: "text", text: "Everything succeeded!" }, done]],
    execute,
  );
  const session = await f.factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  const messages = JSON.stringify(vi.mocked(f.output.control).mock.calls);
  expect(messages).not.toContain("Everything succeeded");
  expect(messages).toContain(status);
  await session.close();
});
it("denies unlisted tools without invoking the executor", async () => {
  const f = fixture([
    [
      { ...call, type: "tool", id: "call", name: "unlisted", arguments: {} },
      done,
    ],
  ]);
  const session = await f.factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  expect(f.execute).not.toHaveBeenCalled();
  await session.close();
});
it.each(["duplicate", "budget"])(
  "stops %s tool loops without repeated dispatch",
  async (kind) => {
    const second: ProviderEvent = {
      type: "tool",
      id: kind === "duplicate" ? "call-1" : "call-2",
      name: "test_read",
      arguments: {},
    };
    const f = fixture([[call, second, done]], undefined, 1);
    const session = await f.factory.open(context),
      t = turn();
    await (
      await session.startTurn(t.current, f.output)
    ).commit(commit(t.current));
    await vi.waitFor(() =>
      expect(f.output.control).toHaveBeenCalledWith(
        expect.objectContaining({ type: "turn.failed" }),
      ),
    );
    expect(f.execute).toHaveBeenCalledOnce();
    await session.close();
  },
);
it("closes provider and cancels a silent turn at its deadline", async () => {
  const f = fixture([[]]);
  const session = await f.factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.failed" }),
    ),
  );
  expect(f.fake.trace.at(-1)?.kind).toBe("close");
  await session.close();
});
it("disconnect before commit never invokes tools and discards provider history", async () => {
  const f = fixture([[call, done]]);
  const session = await f.factory.open(context),
    t = turn();
  await session.startTurn(t.current, f.output);
  t.controller.abort();
  await session.close();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.fake.trace.some((item) => item.kind === "commit")).toBe(false);
});

it("passes cancellation to an in-flight executor and never reports a late write as success", async () => {
  let dispatched = false,
    interrupted = false;
  const f = fixture([[call, { type: "text", text: "Succeeded" }, done]]);
  const factory = createConversationRuntime({
    provider: f.fake.factory,
    journal: f.journal,
    tools: [{ id: "test_read", description: "test", parameters: {} }],
    maxToolCalls: 2,
    turnTimeoutMs: 1000,
    async execute(context) {
      dispatched = true;
      await new Promise<void>((resolve) =>
        context.signal.addEventListener(
          "abort",
          () => {
            interrupted = true;
            resolve();
          },
          { once: true },
        ),
      );
      return { status: "unknown", output: null };
    },
  });
  const session = await factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() => expect(dispatched).toBe(true));
  t.controller.abort();
  await session.close();
  expect(interrupted).toBe(true);
  expect(f.output.control).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "turn.completed" }),
  );
  expect(JSON.stringify(vi.mocked(f.output.control).mock.calls)).not.toContain(
    "Succeeded",
  );
});

it("blocks further automatic tool calls after an unknown outcome, including later turns", async () => {
  const execute = vi.fn(async () => ({
    status: "unknown",
    output: { value: "actual" },
  }));
  const f = fixture(
    [
      [
        call,
        { type: "tool", id: "call-2", name: "test_read", arguments: {} },
        done,
      ],
      [{ type: "tool", id: "call-3", name: "test_read", arguments: {} }, done],
    ],
    execute,
  );
  const session = await f.factory.open(context);
  for (let sequence = 1; sequence <= 2; sequence++) {
    const t = turn(sequence);
    await (
      await session.startTurn(t.current, f.output)
    ).commit(commit(t.current));
    await vi.waitFor(() =>
      expect(f.journal.transition).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: t.current.turnId }),
        "completed",
      ),
    );
  }
  expect(execute).toHaveBeenCalledOnce();
  await session.close();
});

it("bounds a silent provider even when next ignores connection cleanup", async () => {
  const f = fixture([[]]);
  const provider = {
    async open(input: Parameters<typeof f.fake.factory.open>[0]) {
      const handle = await f.fake.factory.open(input);
      return { ...handle, next: () => new Promise<ProviderEvent>(() => {}) };
    },
  };
  const factory = createConversationRuntime({
    provider,
    journal: f.journal,
    tools: [],
    execute: f.execute,
    maxToolCalls: 1,
    turnTimeoutMs: 100,
  });
  const session = await factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.failed" }),
    ),
  );
  await session.close();
});

it("streams tool-free text and converted audio before final generation, then records playback separately", async () => {
  const f = fixture([
    [
      { type: "text", text: "Hello" },
      { type: "audio", pcm24: new Uint8Array(960) },
    ],
  ]);
  const factory = createConversationRuntime({
    provider: f.fake.factory,
    journal: f.journal,
    tools: [],
    execute: f.execute,
    maxToolCalls: 1,
    turnTimeoutMs: 1000,
  });
  const audioCompletion = vi.fn(async () => {});
  f.journal.audioCompletion = audioCompletion;
  const session = await factory.open({ ...context, outputAudio: true }),
    t = turn();
  const handle = await session.startTurn(t.current, f.output);
  await handle.commit(commit(t.current));
  await vi.waitFor(() => expect(f.output.audio).toHaveBeenCalledOnce());
  expect(f.output.control).toHaveBeenCalledWith(
    expect.objectContaining({ type: "response.delta", text: "Hello" }),
  );
  expect(f.output.control).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "turn.completed" }),
  );
  t.controller.abort();
  await handle.stop();
  await session.close();
  expect(audioCompletion).not.toHaveBeenCalled();
});
it("records generation before playback and completes only after the validated receipt", async () => {
  const f = fixture([
    [
      { type: "text", text: "Hello" },
      { type: "audio", pcm24: new Uint8Array(960) },
      done,
    ],
  ]);
  f.journal.audioCompletion = vi.fn(async () => {});
  const session = await f.factory.open({ ...context, outputAudio: true }),
    t = turn();
  const handle = await session.startTurn(t.current, f.output);
  await handle.commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio.generation.completed",
        lastSequence: 0,
      }),
    ),
  );
  expect(f.journal.audioCompletion).toHaveBeenCalledWith(
    expect.anything(),
    "generation",
  );
  expect(f.journal.transition).not.toHaveBeenCalledWith(
    expect.anything(),
    "completed",
  );
  await handle.playbackCompleted?.();
  expect(f.journal.audioCompletion).toHaveBeenLastCalledWith(
    expect.anything(),
    "playback",
  );
  expect(f.journal.transition).toHaveBeenLastCalledWith(
    expect.anything(),
    "completed",
  );
  await expect(handle.playbackCompleted?.()).rejects.toThrow();
  await session.close();
});
it("does not speak model success after an uncertain tool result and still supplies text to speakerless devices", async () => {
  const f = fixture(
    [
      [
        call,
        { type: "audio", pcm24: new Uint8Array(960) },
        { type: "text", text: "Success!" },
        done,
      ],
    ],
    vi.fn(async () => ({ status: "unknown", output: { value: "actual" } })),
  );
  const session = await f.factory.open({ ...context, outputAudio: true }),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  expect(f.output.audio).not.toHaveBeenCalled();
  expect(f.output.control).toHaveBeenCalledWith(
    expect.objectContaining({ type: "tool.result", status: "unknown" }),
  );
  expect(JSON.stringify(vi.mocked(f.output.control).mock.calls)).not.toContain(
    "Success!",
  );
  await session.close();
});
it("does not claim complete success or speak after a partial executor outcome", async () => {
  const f = fixture(
    [
      [
        call,
        { type: "text", text: "Everything succeeded!" },
        { type: "audio", pcm24: new Uint8Array(960) },
        done,
      ],
    ],
    vi.fn(async () => ({
      status: "succeeded",
      outcome: "partial",
      output: { value: "actual" },
    })),
  );
  const session = await f.factory.open({ ...context, outputAudio: true }),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  expect(f.output.audio).not.toHaveBeenCalled();
  const wire = JSON.stringify(vi.mocked(f.output.control).mock.calls);
  expect(wire).toContain("partial");
  expect(wire).not.toContain("Everything succeeded!");
  await session.close();
});
it("closes provider and prevents dispatch when observed usage exceeds the owner allocation", async () => {
  const f = fixture([
    [{ type: "usage", inputTokens: 100, outputTokens: 50 }, call, done],
  ]);
  const { VoiceLimitError } = await import("@corely/modules-voice");
  const close = vi.fn(async () => {});
  const factory = createConversationRuntime({
    provider: f.fake.factory,
    journal: f.journal,
    tools: [{ id: "test_read", description: "test", parameters: {} }],
    execute: f.execute,
    maxToolCalls: 1,
    turnTimeoutMs: 1000,
    budgets: {
      async acquire() {
        return {
          signal: new AbortController().signal,
          check() {},
          async audio() {},
          async usage() {
            throw new VoiceLimitError(
              "Provider session spend allocation reached",
            );
          },
          close,
        };
      },
    },
  });
  const session = await factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn.failed",
        error: expect.objectContaining({ code: "limit_exceeded" }),
      }),
    ),
  );
  expect(f.execute).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(f.fake.trace.at(-1)?.kind).toBe("close");
  await session.close();
});
it("does not finalize an intermediate usage estimate when final usage is missing", async () => {
  const f = fixture([
    [
      { type: "usage", inputTokens: 5, outputTokens: 2 },
      { type: "text", text: "Answer" },
      done,
    ],
  ]);
  f.journal.finalUsage = vi.fn(async () => {});
  const session = await f.factory.open(context),
    t = turn();
  await (
    await session.startTurn(t.current, f.output)
  ).commit(commit(t.current));
  await vi.waitFor(() =>
    expect(f.output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  expect(f.journal.finalUsage).toHaveBeenCalledWith(
    expect.anything(),
    "unknown",
    null,
  );
  expect(f.journal.usage).not.toHaveBeenCalled();
  await session.close();
});
