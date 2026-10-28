import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  encodeOpenHuliAudio,
  parseOpenHuliAudio,
  OpenHuliVoicePeer,
  parseOpenHuliVoiceClientMessage,
  OPENHULI_PCM_FORMAT,
} from "../packages/contracts/src/index.ts";

test("compiled firmware core conforms to the shared v1 peer and preserves bounded turn state", () => {
  const root = fileURLToPath(
    new URL("../firmware/esp32-voice/", import.meta.url),
  );
  const temporary = mkdtempSync(join(tmpdir(), "openhuli-firmware-"));
  try {
    const binary = join(temporary, "native-tests");
    execFileSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-I",
        join(root, "include"),
        join(root, "src/voice_core.cpp"),
        join(root, "test/native.cpp"),
        "-o",
        binary,
      ],
      { timeout: 60000 },
    );
    const lines = execFileSync(binary, { encoding: "utf8", timeout: 10000 })
      .trim()
      .split("\n");
    assert.match(lines.at(-1) ?? "", /^PASS /);
    const controls = lines
      .filter((line) => line.startsWith("CONTROL "))
      .map((line) => line.slice(8));
    controls.forEach(parseOpenHuliVoiceClientMessage);
    const peer = new OpenHuliVoicePeer("server", {
      version: 1,
      messageId: "manifest",
      type: "device.manifest",
      deviceId: "synthetic-device",
      firmwareVersion: "host-test",
      capabilities: [{ kind: "microphone", format: OPENHULI_PCM_FORMAT }],
    });
    peer.receiveControl(controls[0]!);
    peer.sendControl(
      JSON.stringify({
        version: 1,
        messageId: "server-ready",
        type: "session.ready",
        sessionId: "server-session",
        inputFormat: OPENHULI_PCM_FORMAT,
      }),
    );
    peer.receiveControl(controls[1]!);
    const bytes = Buffer.from(
      lines.find((line) => line.startsWith("FRAME "))!.slice(6),
      "hex",
    );
    const frame = peer.receiveAudio(bytes);
    assert.equal(frame.streamId, 0x01020304);
    assert.equal(frame.turnSequence, 1);
    assert.equal(frame.sequence, 0);
    const samples = new Uint8Array(640);
    samples.set([1, 0, 255, 255]);
    assert.deepEqual(
      new Uint8Array(bytes),
      encodeOpenHuliAudio({
        kind: "input",
        streamId: 0x01020304,
        turnSequence: 1,
        sequence: 0,
        payload: samples,
      }),
    );
    assert.equal(parseOpenHuliAudio(bytes).payload.byteLength, 640);
    peer.receiveControl(controls[2]!);
    peer.receiveControl(controls[3]!);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
