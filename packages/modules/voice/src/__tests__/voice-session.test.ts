import { expect, it, vi, afterEach } from "vitest";
import { OPENHULI_PCM_FORMAT, encodeOpenHuliAudio } from "@corely/contracts";
import { VoiceSession } from "../voice-session";
import {
  DEFAULT_VOICE_LIMITS,
  type VoiceOutput,
  type VoiceProviderFactory,
  type VoiceProviderSession,
  type VoiceProviderTurn,
  type VoiceTurnContext,
  type BoundVoiceDevice,
} from "../voice.types";
const device: BoundVoiceDevice = {
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
    firmwareVersion: "test",
    capabilities: [
      { kind: "microphone", format: OPENHULI_PCM_FORMAT },
      { kind: "speaker", format: OPENHULI_PCM_FORMAT },
    ],
  },
};
const sessions: VoiceSession[] = [];
const message = (type: string, fields: Record<string, unknown> = {}) =>
  new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      messageId: crypto.randomUUID(),
      type,
      ...fields,
    }),
  );
function create(factory: VoiceProviderFactory, limits = {}) {
  const transport = { control: vi.fn(), audio: vi.fn(), close: vi.fn() };
  const session = new VoiceSession(device, factory, transport, async () => {}, {
    ...DEFAULT_VOICE_LIMITS,
    ...limits,
  });
  sessions.push(session);
  return { session, transport };
}
function negotiate(session: VoiceSession) {
  session.receive(
    message("session.start", {
      conversationId: "untrusted",
      inputFormat: OPENHULI_PCM_FORMAT,
      outputFormat: OPENHULI_PCM_FORMAT,
    }),
    false,
  );
}
afterEach(async () => {
  await Promise.all(
    sessions.splice(0).map((session) => session.stop().catch(() => {})),
  );
  vi.useRealTimers();
});
it("cleans a provider handle that arrives after disconnect", async () => {
  let resolve: (value: VoiceProviderSession) => void = () => {};
  const opening = new Promise<VoiceProviderSession>((done) => {
    resolve = done;
  });
  const factory: VoiceProviderFactory = {
    isReady: () => true,
    supportsOutputAudio: false,
    open: vi.fn(() => opening),
  };
  const { session } = create(factory);
  negotiate(session);
  await vi.waitFor(() => expect(factory.open).toHaveBeenCalledOnce());
  const stopped = session.stop();
  const handle = { startTurn: vi.fn(), close: vi.fn(async () => {}) };
  resolve(handle);
  await stopped;
  expect(handle.close).toHaveBeenCalledOnce();
});
it("fails cleanup by a deadline when a provider ignores abort", async () => {
  vi.useFakeTimers();
  const factory: VoiceProviderFactory = {
    isReady: () => true,
    supportsOutputAudio: false,
    open: vi.fn(() => new Promise<VoiceProviderSession>(() => {})),
  };
  const { session } = create(factory, {
    operationTimeoutMs: 100,
    cleanupTimeoutMs: 50,
  });
  negotiate(session);
  await vi.advanceTimersByTimeAsync(1);
  const stopped = session.stop();
  const checked = expect(stopped).rejects.toThrow("cleanup");
  await vi.advanceTimersByTimeAsync(101);
  await checked;
});
it("aborts a congested output path and rejects stale server audio", async () => {
  let output: VoiceOutput | undefined;
  const turn: VoiceProviderTurn = {
    appendAudio: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  const factory: VoiceProviderFactory = {
    isReady: () => true,
    supportsOutputAudio: true,
    open: vi.fn(async () => ({
      startTurn: async (_context: VoiceTurnContext, stream: VoiceOutput) => {
        output = stream;
        return turn;
      },
      close: async () => {},
    })),
  };
  const { session, transport } = create(factory);
  negotiate(session);
  await vi.waitFor(() => expect(transport.control).toHaveBeenCalledOnce());
  session.receive(
    message("turn.start", { turnId: "turn", turnSequence: 1, streamId: 1 }),
    false,
  );
  await vi.waitFor(() => expect(output).toBeDefined());
  session.receive(
    encodeOpenHuliAudio({
      kind: "input",
      turnSequence: 1,
      streamId: 1,
      sequence: 0,
      payload: new Uint8Array(640),
    }),
    true,
  );
  session.receive(
    message("turn.commit", { turnId: "turn", lastSequence: 0 }),
    false,
  );
  await vi.waitFor(() => expect(turn.commit).toHaveBeenCalledOnce());
  output?.control({
    version: 1,
    type: "audio.start",
    messageId: crypto.randomUUID(),
    turnId: "turn",
    streamId: 2,
    format: OPENHULI_PCM_FORMAT,
  });
  transport.audio.mockImplementation(() => {
    throw new Error("backpressure");
  });
  const frame = encodeOpenHuliAudio({
    kind: "output",
    turnSequence: 1,
    streamId: 2,
    sequence: 0,
    payload: new Uint8Array(640),
  });
  expect(output?.audio(frame)).toBe(false);
  expect(transport.close).toHaveBeenCalledOnce();
  expect(output?.audio(frame)).toBe(false);
});
