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
  parseDeviceManifest,
  parseDeviceTelemetry,
  DevicePresenceSchema,
  DeviceCommandResultSchema,
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
        "-I",
        fileURLToPath(new URL("../libraries/OpenHuli/src/", import.meta.url)),
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

test("compiled weather firmware reports real samples/errors and conforms to MQTT wire contracts", () => {
  const root = fileURLToPath(
    new URL("../firmware/esp32-voice/", import.meta.url),
  );
  const temporary = mkdtempSync(join(tmpdir(), "openhuli-weather-"));
  try {
    const binary = join(temporary, "weather-tests");
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
        "-I",
        fileURLToPath(new URL("../libraries/OpenHuli/src/", import.meta.url)),
        join(root, "src/voice_core.cpp"),
        join(root, "src/weather_core.cpp"),
        fileURLToPath(
          new URL(
            "../libraries/OpenHuli/src/OpenHuliProtocol.cpp",
            import.meta.url,
          ),
        ),
        join(root, "test/weather.cpp"),
        "-o",
        binary,
      ],
      { timeout: 60000 },
    );
    const lines = execFileSync(binary, { encoding: "utf8", timeout: 10000 })
      .trim()
      .split("\n");
    assert.match(lines.at(-1) ?? "", /^PASS /);
    const line = (prefix: string) =>
      lines
        .find((text) => text.startsWith(prefix + " "))!
        .slice(prefix.length + 1);
    const manifest = parseDeviceManifest(line("MANIFEST"));
    assert.deepEqual(
      manifest.capabilities.map((c) => c.kind),
      ["temperature", "humidity", "ping", "microphone", "display"],
    );
    assert.deepEqual(
      parseDeviceManifest(line("SENSOR_MANIFEST")).capabilities.map(
        (c) => c.kind,
      ),
      ["temperature", "humidity", "ping"],
    );
    assert.equal(
      parseDeviceManifest(line("NO_DISPLAY_MANIFEST")).capabilities.some(
        (c) => c.kind === "display",
      ),
      false,
    );
    const sample = parseDeviceTelemetry(line("TELEMETRY"), manifest);
    assert.equal(sample.readings[0]!.value, 23.4);
    assert.equal(sample.readings[1]!.value, 55.2);
    const failed = parseDeviceTelemetry(line("SENSOR_ERROR"), manifest);
    assert.deepEqual(failed.readings, []);
    assert.equal(failed.sensorErrors!.length, 2);
    const presence = ["ONLINE", "WILL", "RECONNECTED"].map((key) =>
      DevicePresenceSchema.parse(JSON.parse(line(key))),
    );
    assert.deepEqual(
      presence.map((p) => p.sequence),
      [2, 3, 4],
    );
    assert.deepEqual(
      presence.map((p) => p.status),
      ["online", "offline", "online"],
    );
    const results = lines
      .filter((text) => text.startsWith("RESULT "))
      .map((text) =>
        DeviceCommandResultSchema.parse(JSON.parse(text.slice(7))),
      );
    assert.deepEqual(
      results.map((r) => r.status),
      ["succeeded", "failed", "expired", "unknown", "failed", "failed"],
    );
    assert.equal(
      results[1]!.status === "failed" && results[1]!.error.code,
      "unsupported_capability",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
