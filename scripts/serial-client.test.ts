import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  Decoder,
  encode,
  Kind,
} from "../apps/runtime/src/serial-bridge/wire.ts";
test("AVR wire fixtures agree with TypeScript; native node/gateway guards and boot journal pass", () => {
  const temp = mkdtempSync(join(tmpdir(), "openhuli-serial-"));
  try {
    const bin = join(temp, "native");
    execFileSync(
      process.env.CXX || "c++",
      [
        "-std=c++11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pedantic",
        "-Ilibraries/OpenHuliSerial/src",
        ...["OpenHuliWire", "OpenHuliNode", "OpenHuliGateway"].map(
          (n) => `libraries/OpenHuliSerial/src/${n}.cpp`,
        ),
        "libraries/OpenHuliSerial/test/native.cpp",
        "-o",
        bin,
      ],
      { timeout: 60000 },
    );
    const output = execFileSync(bin, { encoding: "utf8", timeout: 10000 });
    assert.match(output, /PASS framing/);
    assert.ok(
      output.includes(
        `FRAME ${encode({ kind: Kind.probe, data: Buffer.alloc(0) }).toString("hex")}`,
      ),
    );
    const decoder = new Decoder();
    let count = 0;
    const bytes = encode({ kind: Kind.start, data: Buffer.alloc(28, 7) });
    for (const byte of bytes)
      decoder.feed(Uint8Array.of(byte), (f) => {
        count++;
        assert.equal(f.data.length, 28);
      });
    assert.equal(count, 1);
    bytes[bytes.length - 1]! ^= 1;
    decoder.feed(bytes, () => count++);
    assert.equal(count, 1);
    decoder.feed(Buffer.from([79, 72, 1, 7, 255]), () => count++);
    decoder.feed(encode({ kind: 1, data: Buffer.alloc(0) }), () => count++);
    assert.equal(count, 2);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
