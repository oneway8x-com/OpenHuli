import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("MicroHuli local controls and OpenHuliSerial integration", () => {
  const output = execFileSync(
    "sh",
    ["firmware/MicroHuli/tests/run_host_tests.sh"],
    {
      encoding: "utf8",
      timeout: 60000,
    },
  );
  assert.equal(output.match(/PASS/g)?.length, 7);
});

test("MicroHuli32 ESP32-C3 local controls and hardware configuration", () => {
  const output = execFileSync(
    "sh",
    ["firmware/MicroHuli32/tests/run_host_tests.sh"],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(output.match(/PASS/g)?.length, 4);
});
