import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run, summarizeTimings } from "./evaluation-timings.ts";

function snapshot(id: string, duration: number, status = "completed") {
  return {
    trace: {
      id,
      turns: [{ id: "turn", status }],
      phases: [
        { turnId: "turn", phase: "input_started", elapsedMs: 0 },
        { turnId: "turn", phase: "input_committed", elapsedMs: 1000 },
        {
          turnId: "turn",
          phase: "first_useful_output",
          elapsedMs: 1000 + duration,
        },
      ],
    },
  };
}

test("uses nearest-rank percentiles, subtracts capture time and does not deduce release readiness", () => {
  const values = Array.from({ length: 20 }, (_, i) =>
    snapshot(String(i), (i + 1) * 100),
  );
  const result = summarizeTimings(values.reverse(), "hardware", "no-tool");
  assert.equal(result.turns, 20);
  assert.equal(result.statuses.completed, 20);
  assert.equal(result.releaseReadiness, "not_assessed");
  assert.deepEqual(result.timings.commitToUsefulOutput, {
    n: 20,
    missing: 0,
    p50Ms: 1000,
    p95Ms: 1900,
  });
  assert.deepEqual(result.timings.commitToPlayback, {
    n: 0,
    missing: 20,
    p50Ms: null,
    p95Ms: null,
  });
});

test("counts failed, active, missing and empty records without inventing zero timings", () => {
  const failed = snapshot("failed", 0, "failed");
  failed.trace.phases.pop();
  const result = summarizeTimings(
    [
      failed,
      snapshot("active", 0, "responding"),
      { trace: null },
      { trace: { id: "empty", turns: [], phases: [] } },
    ],
    "mock",
    "mixed",
  );
  assert.equal(result.turns, 2);
  assert.equal(result.statuses.failed, 1);
  assert.equal(result.statuses.responding, 1);
  assert.equal(result.missingTraces, 1);
  assert.equal(result.emptyTraces, 1);
  assert.deepEqual(result.timings.commitToUsefulOutput, {
    n: 1,
    missing: 1,
    p50Ms: 0,
    p95Ms: 0,
  });
});

test("tool window encloses multiple sequential tools and incomplete windows remain missing", () => {
  const value = snapshot("tools", 2000);
  value.trace.phases.push(
    { turnId: "turn", phase: "tool_started", elapsedMs: 1100 },
    { turnId: "turn", phase: "tool_finished", elapsedMs: 1300 },
    { turnId: "turn", phase: "tool_started", elapsedMs: 1500 },
    { turnId: "turn", phase: "tool_finished", elapsedMs: 2800 },
  );
  assert.equal(
    summarizeTimings([value], "live", "fast-read").timings.toolWindow?.p50Ms,
    1700,
  );
  value.trace.phases.pop();
  assert.equal(
    summarizeTimings([value], "live", "fast-read").timings.toolWindow?.missing,
    1,
  );
});

test("rejects malformed and duplicate evidence instead of biasing sample counts", () => {
  const value = snapshot("duplicate", 500);
  assert.throws(() => summarizeTimings([value, value], "mock", "no-tool"));
  for (const invalid of [
    null,
    {},
    { trace: {} },
    { trace: { id: "x", turns: [], phases: null } },
  ])
    assert.throws(() => summarizeTimings([invalid], "mock", "no-tool"));
  for (const elapsedMs of [-1, NaN, Infinity, 0.5, 2147483648]) {
    const invalid = snapshot("time", 500);
    invalid.trace.phases[0] = {
      turnId: "turn",
      phase: "input_started",
      elapsedMs,
    };
    assert.throws(() => summarizeTimings([invalid], "mock", "no-tool"));
  }
  const firstPhase = value.trace.phases[0];
  assert.ok(firstPhase);
  value.trace.phases.push({ ...firstPhase });
  assert.throws(() => summarizeTimings([value], "mock", "no-tool"));
  const reversed = snapshot("reversed", -100);
  assert.throws(() => summarizeTimings([reversed], "mock", "no-tool"));
  assert.throws(() => summarizeTimings([], "mock", "mixed"));
});

test("flags the diagnostic endpoint caps and emits no private fields or IDs", () => {
  const value = {
    ...snapshot("PRIVATE-CONVERSATION", 10, "PRIVATE-STATUS"),
    token: "PRIVATE-TOKEN",
    content: "PRIVATE-CONTENT",
  };
  const firstTurn = value.trace.turns[0];
  assert.ok(firstTurn);
  value.trace.turns = Array.from({ length: 30 }, (_, i) => ({
    ...firstTurn,
    id: String(i),
  }));
  value.trace.phases = [];
  const result = summarizeTimings([value], "live", "write");
  assert.equal(result.cappedTraces, 1);
  assert.equal(result.statuses.other, 30);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test("CLI reads actual envelopes and fails closed without printing input or private paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "openhuli-evaluation-"));
  try {
    const file = join(directory, "PRIVATE-snapshot.json");
    writeFileSync(file, JSON.stringify(snapshot("session", 450)));
    const args = ["--mode", "mock", "--group", "no-tool", file];
    assert.equal(run(args).timings.commitToUsefulOutput?.p50Ms, 450);
    assert.throws(() => run(["--mode", "live", file]));
    assert.throws(() => run(["--mode", "invalid", "--group", "mixed", file]));
    const script = fileURLToPath(
      new URL("./evaluation-timings.ts", import.meta.url),
    );
    const execute = () =>
      spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
        encoding: "utf8",
      });
    const success = execute();
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).turns, 1);
    writeFileSync(file, "PRIVATE-TOKEN malformed JSON");
    const invalid = execute();
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.doesNotMatch(invalid.stderr, /PRIVATE/);
    writeFileSync(file, " ".repeat(1024 * 1024 + 1));
    assert.throws(() => run(args), /exceeds/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
