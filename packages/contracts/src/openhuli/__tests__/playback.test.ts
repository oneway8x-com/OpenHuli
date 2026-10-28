import { expect, it } from "vitest";
import {
  OpenHuliPlayback,
  OpenHuliPcmOutput,
  encodeOpenHuliAudio,
} from "../index";
const frame = (sequence = 0, turnSequence = 1) =>
  encodeOpenHuliAudio({
    kind: "output",
    streamId: 2,
    turnSequence,
    sequence,
    payload: new Uint8Array(640),
  });
it("plays before generation completes but acknowledges only after the sink finishes", () => {
  const player = new OpenHuliPlayback();
  player.start("turn", 1, 2);
  player.receive(frame());
  const playing = player.take()!;
  expect(playing.payload).toHaveLength(640);
  expect(player.completed()).toBeUndefined();
  player.generationCompleted(0);
  expect(player.completed()).toBeUndefined();
  playing.complete();
  expect(player.completed()).toEqual({
    turnId: "turn",
    streamId: 2,
    lastSequence: 0,
  });
});
it("clears cancelled buffers, drops stale frames and bounds slow consumers", () => {
  const player = new OpenHuliPlayback(1);
  player.start("turn", 1, 2);
  player.receive(frame());
  player.cancel();
  expect(player.queuedFrames).toBe(0);
  expect(player.receive(frame(1))).toBe(false);
  player.start("next", 2, 2);
  expect(player.receive(frame())).toBe(false);
  player.receive(frame(0, 2));
  expect(() => player.receive(frame(1, 2))).toThrow(/full/);
  expect(player.queuedFrames).toBe(0);
  expect(player.completed()).toBeUndefined();
});
it("rejects missing, duplicate, and premature receipt sequences", () => {
  const player = new OpenHuliPlayback();
  player.start("turn", 1, 2);
  expect(() => player.generationCompleted(0)).toThrow();
  expect(() => player.receive(frame(1))).toThrow();
  player.receive(frame());
  expect(() => player.receive(frame())).toThrow();
  const pending = player.take()!;
  player.cancel();
  player.start("next", 2, 2);
  player.receive(frame(0, 2));
  const next = player.take()!;
  expect(pending.complete()).toBe(false);
  expect(next.complete()).toBe(true);
  expect(next.complete()).toBe(false);
});
function pcm(frequency: number) {
  const bytes = new Uint8Array(4800);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 2400; i++)
    view.setInt16(
      i * 2,
      Math.round(10000 * Math.sin((2 * Math.PI * frequency * i) / 24000)),
      true,
    );
  return bytes;
}
function samples(frames: Uint8Array[]) {
  return frames.flatMap((frame) => {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
    return Array.from({ length: frame.length / 2 }, (_, i) =>
      view.getInt16(i * 2, true),
    );
  });
}
it("resamples continuously across provider boundaries into five 16kHz 20ms frames", () => {
  const input = pcm(1000),
    whole = new OpenHuliPcmOutput(),
    chunked = new OpenHuliPcmOutput();
  const expected = [...whole.push(input), ...whole.finish()];
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < input.length; offset += 74)
    frames.push(...chunked.push(input.slice(offset, offset + 74)));
  frames.push(...chunked.finish());
  expect(frames).toEqual(expected);
  expect(frames).toHaveLength(5); // 100 ms at 16 kHz, not 24 kHz relabelled as 16 kHz.
  const signal = samples(frames).slice(100);
  const crossings = signal.filter(
    (value, i) => i > 0 && value > 0 && signal[i - 1]! <= 0,
  ).length;
  expect(crossings).toBeGreaterThan(88);
  expect(crossings).toBeLessThan(96);
});
it("attenuates above-Nyquist energy and rejects malformed/oversized PCM", () => {
  const rms = (frequency: number) => {
    const c = new OpenHuliPcmOutput();
    const s = samples([...c.push(pcm(frequency)), ...c.finish()]).slice(100);
    return Math.sqrt(s.reduce((a, x) => a + x * x, 0) / s.length);
  };
  expect(rms(10000)).toBeLessThan(rms(1000) * 0.05);
  const c = new OpenHuliPcmOutput();
  expect(() => c.push(new Uint8Array(1))).toThrow();
  expect(() => c.push(new Uint8Array(50000))).toThrow();
  expect(c.push(new Uint8Array(4))).toEqual([]);
  expect(c.finish()[0]).toHaveLength(640);
  expect(() => c.push(new Uint8Array(2))).toThrow();
});
