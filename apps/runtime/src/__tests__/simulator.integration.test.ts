import { setTimeout as pause } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createMockSimulatorRuntime } from "../simulator/mock-runtime";
import { runPlaybackSimulator } from "../playback-simulator";

const fixtures: Awaited<ReturnType<typeof createMockSimulatorRuntime>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function setup() {
  const fixture = await createMockSimulatorRuntime();
  fixtures.push(fixture);
  return fixture;
}
function input(f: Awaited<ReturnType<typeof setup>>) {
  if (!f.device.voiceToken) throw new Error("No fixture voice credential");
  return {
    endpoint: f.endpoint,
    token: f.device.voiceToken,
    pcm: new Uint8Array(640 * 16),
    async sink(_pcm: Uint8Array, signal: AbortSignal) {
      await pause(20, undefined, { signal });
    },
  };
}
it("streams paced microphone input before commit, then correlates actual authorized HTTP notes and response playback", async () => {
  const f = await setup();
  const pending = runPlaybackSimulator(input(f));
  await vi.waitFor(() =>
    expect(f.trace.some((event) => event.kind === "audio")).toBe(true),
  );
  expect(f.trace.some((event) => event.kind === "commit")).toBe(false);
  expect(await f.executions()).toEqual([]);
  const report = await pending;
  expect(report.outcome).toBe("completed");
  expect(report.inputFrames).toBe(16);
  expect(report.inputDurationMs).toBeGreaterThanOrEqual(16 * 18);
  expect(report.frames).toBe(1);
  expect(report.responseCharacters).toBeGreaterThan(0);
  expect(f.notesPosts()).toBe(1);
  expect(f.trace.filter((event) => event.kind === "audio")).toHaveLength(16);
  const executions = await f.executions();
  expect(executions.map((e) => e.toolName).sort()).toEqual([
    "notes.create",
    "weather.forecast",
  ]);
  expect(
    executions.every(
      (e) =>
        e.status === "succeeded" &&
        e.runId === report.sessionId &&
        e.turnId === report.turnId,
    ),
  ).toBe(true);
  expect(report.toolResults.map((e) => e.executionId).sort()).toEqual(
    executions.map((e) => e.id).sort(),
  );
  const note = executions.find((e) => e.toolName === "notes.create");
  expect(JSON.parse(note?.outputJson ?? "null")).toMatchObject({
    text: "Synthetic simulator note",
  });
  const forecast = executions.find((e) => e.toolName === "weather.forecast");
  expect(JSON.parse(forecast?.outputJson ?? "null")).toMatchObject({
    kind: "forecast",
    source: "Open-Meteo",
  });
  expect(JSON.stringify(report)).not.toContain(f.device.voiceToken);
});
it.each(["cancel", "disconnect"] as const)(
  "never commits or executes tools after an input %s",
  async (kind) => {
    const f = await setup();
    const report = await runPlaybackSimulator({
      ...input(f),
      interrupt: { kind, afterFrames: 3 },
    });
    expect(report.outcome).toBe(
      kind === "cancel" ? "cancelled" : "disconnected",
    );
    await vi.waitFor(() =>
      expect(f.trace.some((event) => event.kind === "close")).toBe(true),
    );
    expect(f.trace.some((event) => event.kind === "commit")).toBe(false);
    expect(await f.executions()).toEqual([]);
    expect(f.notesPosts()).toBe(0);
  },
);
