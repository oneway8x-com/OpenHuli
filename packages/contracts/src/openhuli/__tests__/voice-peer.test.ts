import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  encodeOpenHuliAudio,
  OPENHULI_PCM_FORMAT,
  OpenHuliAudioMessageDecoder,
  OpenHuliVoiceClientMessageSchema,
  OpenHuliVoicePeer,
  OpenHuliVoiceServerMessageSchema,
  parseOpenHuliVoiceClientMessage,
  parseOpenHuliVoiceServerMessage,
  type DeviceCapabilityManifest,
  type OpenHuliAudioFrame,
} from "../index";

const examples = z
  .record(z.unknown())
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../../docs/protocol/v1.examples.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const manifest = DeviceCapabilityManifestSchema.parse(examples.manifest);

function peers(bound = manifest) {
  const server = new OpenHuliVoicePeer("server", bound);
  const device = new OpenHuliVoicePeer("device", bound);
  let id = 0;
  const control = (
    sender: "server" | "device",
    type: string,
    fields: Record<string, unknown> = {},
  ) => {
    const wire = JSON.stringify({
      version: 1,
      messageId: `m${++id}`,
      type,
      ...fields,
    });
    const from = sender === "server" ? server : device;
    const to = sender === "server" ? device : server;
    expect(from.sendControl(wire)).toEqual(to.receiveControl(wire));
    return wire;
  };
  const audio = (
    kind: "input" | "output",
    fields: Partial<OpenHuliAudioFrame> = {},
  ) => {
    const wire = encodeOpenHuliAudio({
      kind,
      streamId: kind === "input" ? 1 : 2,
      turnSequence: 1,
      sequence: 0,
      payload: new Uint8Array(640),
      ...fields,
    });
    const from = kind === "input" ? device : server;
    const to = kind === "input" ? server : device;
    expect(from.sendAudio(wire)).toEqual(to.receiveAudio(wire));
    return wire;
  };
  const c = (type: string, fields: Record<string, unknown> = {}) =>
    control("device", type, fields);
  const s = (type: string, fields: Record<string, unknown> = {}) =>
    control("server", type, fields);
  const ready = (output = true) => {
    const formats = {
      inputFormat: OPENHULI_PCM_FORMAT,
      ...(output ? { outputFormat: OPENHULI_PCM_FORMAT } : {}),
    };
    c("session.start", { conversationId: "conv-1", ...formats });
    s("session.ready", { sessionId: "session-1", ...formats });
  };
  const start = () =>
    c("turn.start", { turnId: "t1", turnSequence: 1, streamId: 1 });
  const commit = () => c("turn.commit", { turnId: "t1", lastSequence: 0 });
  return { server, device, control, c, s, audio, ready, start, commit };
}

describe("shared server and simulator voice peers", () => {
  it("exchanges the documented transcript using the public parsers and fragmented binary messages", () => {
    const steps = z
      .array(
        z.union([
          z.object({
            sender: z.enum(["device", "server"]),
            message: z.union([
              OpenHuliVoiceClientMessageSchema,
              OpenHuliVoiceServerMessageSchema,
            ]),
          }),
          z.object({
            sender: z.enum(["device", "server"]),
            audio: z.object({
              kind: z.enum(["input", "output"]),
              streamId: z.number(),
              turnSequence: z.number(),
              sequence: z.number(),
              silenceBytes: z.literal(640),
            }),
          }),
        ]),
      )
      .parse(examples.voice);
    const { server, device } = peers();
    for (const step of steps) {
      const from = step.sender === "device" ? device : server;
      const to = step.sender === "device" ? server : device;
      if ("message" in step) {
        const wire = JSON.stringify(step.message);
        expect(from.sendControl(wire)).toEqual(step.message);
        expect(to.receiveControl(wire)).toEqual(step.message);
      } else {
        const frame = {
          kind: step.audio.kind,
          streamId: step.audio.streamId,
          turnSequence: step.audio.turnSequence,
          sequence: step.audio.sequence,
          payload: new Uint8Array(step.audio.silenceBytes),
        };
        const wire = encodeOpenHuliAudio(frame);
        from.sendAudio(wire);
        const decoder = new OpenHuliAudioMessageDecoder();
        expect(decoder.push(wire.slice(0, 7), false)).toBeUndefined();
        const received = decoder.push(wire.slice(7), true);
        expect(received).toEqual(frame);
        if (!received) throw new Error("No assembled frame");
        expect(to.receiveAudio(encodeOpenHuliAudio(received))).toEqual(frame);
      }
    }
    server.close();
    device.close();
  });
  it("requires negotiation and a microphone; rejects unoffered output and unsupported formats", () => {
    const h = peers();
    expect(() => h.start()).toThrow(/ready/);
    expect(() =>
      h.s("session.ready", {
        sessionId: "s",
        inputFormat: OPENHULI_PCM_FORMAT,
      }),
    ).toThrow(/offered/);
    const noMic: DeviceCapabilityManifest = {
      ...manifest,
      capabilities: [{ kind: "ping" }],
    };
    expect(() => peers(noMic).ready(false)).toThrow(/Microphone/);
    const noSpeaker = {
      ...manifest,
      capabilities: manifest.capabilities.filter(
        (item) => item.kind !== "speaker",
      ),
    };
    expect(() => peers(noSpeaker).ready()).toThrow(/Speaker/);
    h.c("session.start", {
      conversationId: "c",
      inputFormat: OPENHULI_PCM_FORMAT,
    });
    expect(() =>
      h.s("session.ready", {
        sessionId: "s",
        inputFormat: OPENHULI_PCM_FORMAT,
        outputFormat: OPENHULI_PCM_FORMAT,
      }),
    ).toThrow(/offered/);
    expect(() =>
      parseOpenHuliVoiceClientMessage(
        JSON.stringify({
          version: 1,
          messageId: "x",
          type: "session.start",
          conversationId: "c",
          inputFormat: { ...OPENHULI_PCM_FORMAT, sampleRateHz: 48000 },
        }),
      ),
    ).toThrow();
  });
  it("rejects wrong direction, unknown versions/types, extra authority, oversized text", () => {
    const message = {
      version: 1,
      messageId: "x",
      type: "turn.cancel",
      turnId: "t1",
    };
    expect(() =>
      parseOpenHuliVoiceServerMessage(JSON.stringify(message)),
    ).toThrow();
    for (const extra of [
      { version: 2 },
      { type: "turn.execute" },
      { tenantId: "forged" },
    ]) {
      expect(() =>
        parseOpenHuliVoiceClientMessage(
          JSON.stringify({ ...message, ...extra }),
        ),
      ).toThrow();
    }
    expect(() =>
      parseOpenHuliVoiceServerMessage(
        JSON.stringify({
          ...message,
          type: "response.text",
          text: "x".repeat(4097),
        }),
      ),
    ).toThrow();
  });
  it("rejects duplicate IDs, overlapping turns, sequence gaps and reused streams across turns", () => {
    const h = peers();
    h.ready();
    const start = h.start();
    expect(() => h.server.receiveControl(start)).toThrow(/Duplicate messageId/);
    expect(() =>
      h.c("turn.start", { turnId: "t2", turnSequence: 2, streamId: 3 }),
    ).toThrow(/active/);
    h.c("turn.cancel", { turnId: "t1" });
    expect(() => h.start()).toThrow(/Duplicate turnId/);
    expect(() =>
      h.c("turn.start", { turnId: "t2", turnSequence: 3, streamId: 3 }),
    ).toThrow(/sequence/);
    expect(() =>
      h.c("turn.start", { turnId: "t2", turnSequence: 2, streamId: 1 }),
    ).toThrow(/streamId/);
    h.c("turn.start", { turnId: "t2", turnSequence: 2, streamId: 3 });
  });
  it("requires ordered input and an exact nonempty commit before responding", () => {
    const h = peers();
    h.ready();
    h.start();
    expect(() => h.commit()).toThrow(/commit/);
    expect(() => h.s("response.text", { turnId: "t1", text: "early" })).toThrow(
      /order/,
    );
    expect(() => h.audio("input", { sequence: 1 })).toThrow(/sequence/);
    expect(() => h.audio("input", { turnSequence: 2 })).toThrow(/another turn/);
    expect(() => h.audio("input", { streamId: 99 })).toThrow(/not allowed/);
    h.audio("input");
    expect(() => h.audio("input")).toThrow(/sequence/);
    expect(() => h.c("turn.commit", { turnId: "t1", lastSequence: 1 })).toThrow(
      /commit/,
    );
    h.commit();
    expect(() => h.commit()).toThrow(/commit/);
    expect(() => h.audio("input", { sequence: 1 })).toThrow(/not allowed/);
    expect(() => h.audio("output")).toThrow(/not allowed/);
    h.s("response.text", { turnId: "t1", text: "Done" });
    h.s("turn.completed", { turnId: "t1" });
  });
  it("distinguishes generation completion from actual playback and validates final sequence", () => {
    const h = peers();
    h.ready();
    h.start();
    h.audio("input");
    h.commit();
    const out = { turnId: "t1", streamId: 2, lastSequence: 0 };
    expect(() => h.s("turn.completed", { turnId: "t1" })).toThrow(
      /no response/,
    );
    h.s("audio.start", {
      turnId: "t1",
      streamId: 2,
      format: OPENHULI_PCM_FORMAT,
    });
    expect(() => h.s("audio.generation.completed", out)).toThrow(/generation/);
    h.audio("output");
    expect(() => h.c("playback.completed", out)).toThrow(/playback/);
    expect(() =>
      h.s("audio.generation.completed", { ...out, lastSequence: 1 }),
    ).toThrow(/generation/);
    h.s("audio.generation.completed", out);
    expect(() => h.audio("output", { sequence: 1 })).toThrow(/not allowed/);
    expect(() => h.s("turn.completed", { turnId: "t1" })).toThrow(/Playback/);
    expect(() => h.c("playback.completed", { ...out, streamId: 3 })).toThrow(
      /playback/,
    );
    h.c("playback.completed", out);
    expect(() => h.c("playback.completed", out)).toThrow(/playback/);
    h.s("turn.completed", { turnId: "t1" });
    expect(() => h.s("turn.completed", { turnId: "t1" })).toThrow(/matching/);
  });
  it("supports microphone-only devices with text responses", () => {
    const bound = {
      ...manifest,
      capabilities: manifest.capabilities.filter(
        (item) => item.kind !== "speaker",
      ),
    };
    const h = peers(bound);
    h.ready(false);
    h.start();
    h.audio("input");
    h.commit();
    expect(() =>
      h.s("audio.start", {
        turnId: "t1",
        streamId: 2,
        format: OPENHULI_PCM_FORMAT,
      }),
    ).toThrow(/not allowed/);
    h.s("response.text", { turnId: "t1", text: "Done" });
    h.s("turn.completed", { turnId: "t1" });
  });
  it.each(["collecting", "committed", "playing"])(
    "cancels %s turns and rejects late audio/events",
    (phase) => {
      const h = peers();
      h.ready();
      h.start();
      if (phase !== "collecting") {
        h.audio("input");
        h.commit();
      }
      if (phase === "playing") {
        h.s("audio.start", {
          turnId: "t1",
          streamId: 2,
          format: OPENHULI_PCM_FORMAT,
        });
        h.audio("output");
      }
      h.c("turn.cancel", { turnId: "t1" });
      expect(() => h.audio("input")).toThrow(/active/);
      expect(() => h.audio("output")).toThrow(/active/);
      expect(() =>
        h.s("response.text", { turnId: "t1", text: "late" }),
      ).toThrow(/matching/);
      h.c("turn.start", { turnId: "t2", turnSequence: 2, streamId: 3 });
      expect(() => h.audio("input")).toThrow(/another turn/);
    },
  );
  it("bounds turn audio and session history", () => {
    const h = peers();
    h.ready();
    h.start();
    for (let sequence = 0; sequence < 1500; sequence++)
      h.audio("input", { sequence });
    expect(() => h.audio("input", { sequence: 1500 })).toThrow(/limit/);
    h.c("turn.cancel", { turnId: "t1" });
    for (let sequence = 2; sequence <= 256; sequence++) {
      h.c("turn.start", {
        turnId: `t${sequence}`,
        turnSequence: sequence,
        streamId: sequence,
      });
      h.c("turn.cancel", { turnId: `t${sequence}` });
    }
    expect(() =>
      h.c("turn.start", { turnId: "t257", turnSequence: 257, streamId: 257 }),
    ).toThrow(/limit/);
  });
  it("handles turn failure, fatal session errors and disconnect without accepting later messages", () => {
    const error = {
      code: "provider_unavailable",
      message: "Provider unavailable",
      correlationId: "t1",
      retryable: true,
    };
    const h = peers();
    h.ready();
    h.start();
    h.s("turn.failed", { turnId: "t1", error });
    h.c("turn.start", { turnId: "t2", turnSequence: 2, streamId: 3 });
    h.s("session.error", { error });
    expect(() => h.c("turn.cancel", { turnId: "t2" })).toThrow(/closed/);
    const other = peers();
    other.ready();
    other.start();
    other.server.close();
    other.device.close();
    expect(() => other.audio("input")).toThrow(/active/);
    expect(() => other.commit()).toThrow(/closed/);
  });
});

it("accepts an atomic typed turn and blocks mixed audio or a second commit", () => {
  const p = peers();
  p.ready(false);
  p.c("turn.text", { turnId: "typed", turnSequence: 1, text: "Which device?" });
  expect(() => p.audio("input")).toThrow();
  expect(() =>
    p.c("turn.commit", { turnId: "typed", lastSequence: 0 }),
  ).toThrow();
  p.s("response.text", { turnId: "typed", text: "Please clarify the target" });
  p.s("turn.completed", { turnId: "typed" });
  p.c("turn.text", { turnId: "followup", turnSequence: 2, text: "Kitchen" });
  expect(() =>
    p.c("turn.text", { turnId: "concurrent", turnSequence: 3, text: "Hello" }),
  ).toThrow();
});
it("rejects empty/oversized typed input and duplicate turn sequence", () => {
  const p = peers();
  p.ready(false);
  expect(() =>
    p.c("turn.text", { turnId: "typed", turnSequence: 1, text: " " }),
  ).toThrow();
  expect(() =>
    p.c("turn.text", {
      turnId: "typed",
      turnSequence: 1,
      text: "a".repeat(4097),
    }),
  ).toThrow();
  expect(() =>
    p.c("turn.text", { turnId: "typed", turnSequence: 2, text: "Hello" }),
  ).toThrow();
});
