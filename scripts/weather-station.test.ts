import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  parseDeviceManifest,
  parseDeviceTelemetry,
} from "../packages/contracts/src/index.ts";

test("imported station sends only fresh indoor samples using OpenHuli contracts", () => {
  const root = fileURLToPath(
    new URL("../firmware/weather-station/", import.meta.url),
  );
  const library = fileURLToPath(
    new URL("../libraries/OpenHuli/src/", import.meta.url),
  );
  const temporary = mkdtempSync(join(tmpdir(), "openhuli-station-"));
  try {
    const binary = join(temporary, "station-test");
    execFileSync(
      process.env.CXX || "c++",
      [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-I",
        library,
        join(library, "OpenHuliProtocol.cpp"),
        join(root, "tests/station_huli_test.cpp"),
        "-o",
        binary,
      ],
      { timeout: 60000 },
    );
    const output = execFileSync(binary, { encoding: "utf8", timeout: 10000 })
      .trim()
      .split("\n");
    const payload = (prefix: string) => {
      const line = output.find((text) => text.startsWith(`${prefix} `));
      assert.ok(line);
      return line.slice(prefix.length + 1);
    };
    const manifest = parseDeviceManifest(payload("MANIFEST"));
    assert.deepEqual(
      manifest.capabilities.map((cap) => cap.kind),
      ["temperature", "humidity", "ping", "display"],
    );
    const sample = parseDeviceTelemetry(payload("TELEMETRY"), manifest);
    assert.deepEqual(
      sample.readings.map((r) => r.value),
      [23.4, 55.2],
    );
    assert.equal(sample.sampledAt, "2026-10-25T11:00:00.000Z");
    const failed = parseDeviceTelemetry(payload("SENSOR_ERROR"), manifest);
    assert.deepEqual(failed.readings, []);
    assert.equal(failed.sensorErrors?.length, 2);
    assert.match(output.at(-1) ?? "", /^PASS /);
    for (const file of ["hardware_test_display_test.cpp", "readout_test.cpp"]) {
      execFileSync(
        process.env.CXX || "c++",
        [
          "-std=c++17",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-pedantic",
          "-I",
          join(root, "clock/include"),
          join(root, "tests", file),
          "-o",
          binary,
        ],
        { timeout: 60000 },
      );
      execFileSync(binary, { timeout: 10000 });
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
