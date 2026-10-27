import { describe, expect, it } from "vitest";
import {
  encodeOpenHuliAudio,
  OpenHuliAudioMessageDecoder,
  parseOpenHuliAudio,
} from "../index";

function sample() {
  const payload = new Uint8Array(640);
  payload.set([0x00, 0x80, 0xff, 0x7f]); // -32768, +32767 in PCM16LE.
  return {
    kind: "input" as const,
    streamId: 0x01020304,
    turnSequence: 1,
    sequence: 0,
    payload,
  };
}

describe("frozen v1 audio frame", () => {
  it("matches an independent network-endian header and preserves little-endian PCM", () => {
    const frame = encodeOpenHuliAudio(sample());
    expect([...frame.slice(0, 24)]).toEqual([
      0x4f, 0x48, 1, 1, 1, 2, 3, 4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 0x80, 0, 0,
      0, 0,
    ]);
    expect([...frame.slice(24, 28)]).toEqual([0, 0x80, 0xff, 0x7f]);
    const padded = new Uint8Array(670);
    padded.set(frame, 3);
    expect(parseOpenHuliAudio(padded.subarray(3, 667))).toEqual(sample());
    const output = { ...sample(), kind: "output" as const };
    expect(parseOpenHuliAudio(encodeOpenHuliAudio(output))).toEqual(output);
  });
  it.each([0, 1, 2, 3, 4, 8, 16, 20])(
    "rejects malformed header at byte %i",
    (offset) => {
      const frame = encodeOpenHuliAudio(sample());
      // IDs must be nonzero; other fields must equal the frozen header values.
      if (offset === 4 || offset === 8) frame.fill(0, offset, offset + 4);
      else frame[offset] = 255;
      expect(() => parseOpenHuliAudio(frame)).toThrow();
    },
  );
  it("rejects truncated, oversized, and concatenated messages and incorrect chunk lengths", () => {
    const frame = encodeOpenHuliAudio(sample());
    for (const length of [0, 23, 24, 663, 665, 1328]) {
      expect(() => parseOpenHuliAudio(new Uint8Array(length))).toThrow(
        /length/,
      );
    }
    for (const length of [0, 639, 641, 1280]) {
      expect(() =>
        encodeOpenHuliAudio({ ...sample(), payload: new Uint8Array(length) }),
      ).toThrow(/640/);
    }
    expect(frame.length).toBe(664);
    expect(() => encodeOpenHuliAudio({ ...sample(), sequence: -1 })).toThrow();
    expect(() =>
      encodeOpenHuliAudio({ ...sample(), streamId: 0x1_0000_0000 }),
    ).toThrow();
  });
  it("assembles fragmentation across every header and payload split without early emission", () => {
    const frame = encodeOpenHuliAudio(sample());
    for (let split = 1; split < frame.length; split++) {
      const decoder = new OpenHuliAudioMessageDecoder();
      expect(decoder.push(frame.subarray(0, split), false)).toBeUndefined();
      expect(decoder.push(frame.subarray(split), true)).toEqual(sample());
      decoder.finish();
    }
    const decoder = new OpenHuliAudioMessageDecoder();
    for (const byte of frame)
      expect(decoder.push(Uint8Array.of(byte), false)).toBeUndefined();
    expect(decoder.push(new Uint8Array(), true)).toEqual(sample());
  });
  it("rejects premature FIN, unfinished disconnect, and excessive fragments; resets safely", () => {
    const decoder = new OpenHuliAudioMessageDecoder();
    const frame = encodeOpenHuliAudio(sample());
    expect(() => decoder.push(frame.slice(0, 20), true)).toThrow();
    decoder.push(frame.slice(0, 10), false);
    expect(() => decoder.finish()).toThrow(/fragmented/);
    decoder.push(frame, false);
    expect(() => decoder.push(Uint8Array.of(0), true)).toThrow(/limit/);
    expect(decoder.push(frame, true)).toEqual(sample());
    expect(decoder.push(frame, true)).toEqual(sample());
  });
});
