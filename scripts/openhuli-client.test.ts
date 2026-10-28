import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  parseDeviceManifest,
  parseDeviceTelemetry,
} from "../packages/contracts/src/index.ts";

const root = fileURLToPath(new URL("../libraries/OpenHuli/", import.meta.url));
test("C++11 Arduino client encodes optional metrics and errors matching server contracts", () => {
  const temporary = mkdtempSync(join(tmpdir(), "openhuli-client-"));
  try {
    const binary = join(temporary, "protocol");
    execFileSync(
      process.env.CXX || "c++",
      [
        "-std=c++11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-I",
        join(root, "src"),
        join(root, "src/OpenHuliProtocol.cpp"),
        join(root, "src/OpenHuliConfig.cpp"),
        join(root, "test/protocol.cpp"),
        "-o",
        binary,
      ],
      { timeout: 60000 },
    );
    const lines = execFileSync(binary, { encoding: "utf8", timeout: 10000 })
      .trim()
      .split("\n");
    const line = (key: string) =>
      lines.find((text) => text.startsWith(key + " "))!.slice(key.length + 1);
    assert.match(lines.at(-1) ?? "", /^PASS /);
    const manifest = parseDeviceManifest(line("MANIFEST"));
    assert.deepEqual(
      manifest.capabilities.map((c) => c.kind),
      ["temperature", "ping"],
    );
    assert.equal(
      parseDeviceTelemetry(line("TEMPERATURE"), manifest).readings[0]?.value,
      -12.345,
    );
    assert.equal(
      parseDeviceTelemetry(line("FAILED"), manifest).sensorErrors?.[0]?.code,
      "read_failed",
    );
    assert.equal(
      parseDeviceTelemetry(line("UNAVAILABLE"), manifest).sensorErrors?.[0]
        ?.code,
      "unavailable",
    );
    assert.deepEqual(parseDeviceManifest(line("PING_MANIFEST")).capabilities, [
      { kind: "ping" },
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Arduino ZIP includes both manifests and excludes local secrets and build artifacts", () => {
  const temporary = mkdtempSync(join(tmpdir(), "openhuli-package-"));
  try {
    const zip = join(temporary, "OpenHuli.zip");
    execFileSync(
      "python3",
      ["scripts/package-arduino-client.py", "--output", zip],
      { timeout: 10000 },
    );
    const names = execFileSync(
      "python3",
      [
        "-c",
        "import sys,zipfile; print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))",
        zip,
      ],
      { encoding: "utf8", timeout: 10000 },
    )
      .trim()
      .split("\n");
    for (const required of [
      "src/OpenHuli.h",
      "src/OpenHuli.cpp",
      "src/OpenHuliCommand.cpp",
      "examples/Telemetry/Telemetry.ino",
      "library.json",
      "library.properties",
      "LICENSE",
    ])
      assert.ok(names.includes("OpenHuli/" + required));
    assert.ok(
      names.every(
        (name) =>
          name.startsWith("OpenHuli/") &&
          !/config\.local|\.pio|\/test\//.test(name),
      ),
    );
    const metadata: {
      name: string;
      version: string;
      dependencies: Record<string, string>;
    } = JSON.parse(readFileSync(join(root, "library.json"), "utf8"));
    const properties = readFileSync(join(root, "library.properties"), "utf8");
    assert.ok(properties.includes(`version=${metadata.version}\n`));
    assert.ok(properties.includes("architectures=esp32\n"));
    assert.ok(
      properties.includes(
        `depends=ArduinoJson (=${metadata.dependencies["bblanchon/ArduinoJson"]})\n`,
      ),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
