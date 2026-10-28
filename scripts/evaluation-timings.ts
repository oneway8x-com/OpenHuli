import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Phase = { turnId: string | null; phase: string; elapsedMs: number };
type Trace = {
  id: string;
  turns: { id: string; status: string }[];
  phases: Phase[];
};

const modes = ["mock", "live", "hardware"] as const;
const groups = ["no-tool", "fast-read", "write", "mixed"] as const;
type Mode = (typeof modes)[number];
type Group = (typeof groups)[number];
const metrics = {
  input: ["input_started", "input_committed"],
  providerFirstEvent: ["provider_requested", "provider_first_event"],
  toolWindow: ["tool_started", "tool_finished"],
  commitToUsefulOutput: ["input_committed", "first_useful_output"],
  commitToGeneration: ["input_committed", "generation_completed"],
  commitToPlayback: ["input_committed", "playback_completed"],
  commitToCompletion: ["input_committed", "completed"],
} as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return Object.fromEntries(Object.entries(value));
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 256)
    throw new Error("Invalid identifier or status");
  return value;
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error("Invalid diagnostic collection");
  return value;
}
function parseTrace(value: unknown): Trace | null {
  const envelope = object(value);
  if (envelope.trace === null) return null;
  const trace = object(envelope.trace);
  const turns = list(trace.turns, 30).map((value) => {
    const turn = object(value);
    return { id: identifier(turn.id), status: identifier(turn.status) };
  });
  if (new Set(turns.map((turn) => turn.id)).size !== turns.length)
    throw new Error("Duplicate turn identity");
  const phases = list(trace.phases, 300).map((value) => {
    const phase = object(value);
    if (
      typeof phase.elapsedMs !== "number" ||
      !Number.isSafeInteger(phase.elapsedMs) ||
      phase.elapsedMs < 0 ||
      phase.elapsedMs > 2147483647
    )
      throw new Error("Invalid phase elapsed time");
    return {
      turnId: phase.turnId === null ? null : identifier(phase.turnId),
      phase: identifier(phase.phase),
      elapsedMs: phase.elapsedMs,
    };
  });
  return { id: identifier(trace.id), turns, phases };
}

function percentile(sorted: number[], p: number): number | null {
  return sorted[Math.ceil(p * sorted.length) - 1] ?? null;
}

/** Summarizes recorded timings only; it does not verify task success or release readiness. */
export function summarizeTimings(values: unknown[], mode: Mode, group: Group) {
  if (!modes.includes(mode) || !groups.includes(group))
    throw new Error("Invalid evaluation mode or group");
  if (!values.length || values.length > 100)
    throw new Error("Supply between one and 100 diagnostic snapshots");
  const samples: Record<string, number[]> = {};
  for (const key of Object.keys(metrics)) samples[key] = [];
  const statuses: Record<string, number> = Object.create(null);
  const conversations = new Set<string>();
  let turns = 0,
    missingTraces = 0,
    emptyTraces = 0,
    cappedTraces = 0;
  for (const value of values) {
    const trace = parseTrace(value);
    if (!trace) {
      missingTraces++;
      continue;
    }
    if (conversations.has(trace.id))
      throw new Error(
        "Duplicate conversation snapshot; use one export per conversation",
      );
    conversations.add(trace.id);
    if (!trace.turns.length) emptyTraces++;
    if (trace.turns.length === 30 || trace.phases.length === 300)
      cappedTraces++;
    for (const turn of trace.turns) {
      turns++;
      const status = [
        "collecting",
        "committed",
        "responding",
        "completed",
        "cancelled",
        "failed",
      ].includes(turn.status)
        ? turn.status
        : "other";
      statuses[status] = (statuses[status] ?? 0) + 1;
      const phases = trace.phases.filter((phase) => phase.turnId === turn.id);
      for (const [name, [start, end]] of Object.entries(metrics)) {
        const starts = phases.filter((phase) => phase.phase === start);
        const ends = phases.filter((phase) => phase.phase === end);
        // Tool phases can repeat. Their enclosing window includes approval wait and gaps.
        if (name !== "toolWindow" && (starts.length > 1 || ends.length > 1))
          throw new Error("Duplicate singleton phase");
        if (!starts.length || !ends.length) continue;
        if (name === "toolWindow" && starts.length !== ends.length) continue;
        if (name === "toolWindow") {
          starts.sort((a, b) => a.elapsedMs - b.elapsedMs);
          ends.sort((a, b) => a.elapsedMs - b.elapsedMs);
          if (
            starts.some(
              (phase, index) =>
                phase.elapsedMs > (ends[index]?.elapsedMs ?? -1),
            )
          )
            throw new Error("Tool phase endpoints are reversed");
        }
        const duration =
          Math.max(...ends.map((phase) => phase.elapsedMs)) -
          Math.min(...starts.map((phase) => phase.elapsedMs));
        if (duration < 0) throw new Error("Phase endpoints are reversed");
        (samples[name] ??= []).push(duration);
      }
    }
  }
  return {
    declaredMode: mode,
    declaredGroup: group,
    releaseReadiness: "not_assessed",
    conversations: conversations.size,
    turns,
    statuses,
    missingTraces,
    emptyTraces,
    cappedTraces,
    timings: Object.fromEntries(
      Object.entries(samples).map(([name, values]) => {
        values.sort((a, b) => a - b);
        return [
          name,
          {
            n: values.length,
            missing: turns - values.length,
            p50Ms: percentile(values, 0.5),
            p95Ms: percentile(values, 0.95),
          },
        ];
      }),
    ),
  };
}

export function run(args: string[]) {
  const [modeFlag, mode, groupFlag, group, ...files] = args;
  if (
    modeFlag !== "--mode" ||
    !modes.some((value) => value === mode) ||
    groupFlag !== "--group" ||
    !groups.some((value) => value === group) ||
    !files.length ||
    files.length > 100
  )
    throw new Error(
      "Usage: pnpm eval:timings --mode mock|live|hardware --group no-tool|fast-read|write|mixed snapshot.json [...]",
    );
  const values: unknown[] = files.map((file) => {
    if (statSync(file).size > 1024 * 1024)
      throw new Error("Diagnostic snapshot exceeds 1 MiB");
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return value;
  });
  // Values have been checked above; narrow through matching rather than a cast.
  const selectedMode = modes.find((value) => value === mode);
  const selectedGroup = groups.find((value) => value === group);
  if (!selectedMode || !selectedGroup)
    throw new Error("Invalid evaluation labels");
  return summarizeTimings(values, selectedMode, selectedGroup);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(run(process.argv.slice(2)), null, 2));
  } catch {
    // Do not echo input, private paths or JSON parse errors to shared evidence.
    console.error(
      "Timing summary failed. Check mode/group, file limits and diagnostic trace shape; see RELEASE_EVALUATION.md.",
    );
    process.exitCode = 1;
  }
}
