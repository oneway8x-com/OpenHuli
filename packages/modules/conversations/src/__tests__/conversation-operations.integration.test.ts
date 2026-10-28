import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaService } from "@corely/data";
import { ConversationOperationsRepository } from "../conversation-operations.repository";
import {
  createConversationBudgets,
  clearConversationPrivateData,
  readConversationDiagnostics,
} from "../conversation-operations.use-cases";
import { ConversationRepository } from "../conversation.repository";
import { createConversationJournal } from "../conversation-journal";
import { createConversationRuntime } from "../conversation-runtime";
import { createFakeConversationProvider } from "../fake-conversation-provider";
import type { ConversationPolicy } from "../conversation-operations.types";
import { vi } from "vitest";

const db = new PrismaService();
const repository = new ConversationOperationsRepository(db);
const tenantId = randomUUID();
const deviceId = randomUUID();
const policy: ConversationPolicy = {
  sessionsPerDay: 100,
  concurrentSessions: 1,
  audioSecondsPerDay: 1,
  audioSecondsPerSession: 1,
  sessionTimeoutMs: 10000,
  dailyBudgetMicros: 100,
  sessionReservationMicros: 10,
  retentionDays: 7,
};
const leases: Awaited<
  ReturnType<ReturnType<typeof createConversationBudgets>["acquire"]>
>[] = [];
beforeAll(async () => {
  await db.tenant.create({
    data: { id: tenantId, name: "Synthetic operations", slug: tenantId },
  });
  await db.device.create({
    data: {
      id: deviceId,
      tenantId,
      name: "Synthetic device",
      manifestJson: "{}",
    },
  });
});
afterAll(async () => {
  await Promise.all(leases.map((lease) => lease.close()));
  await db.agentRun.deleteMany({ where: { tenantId } });
  await db.conversationQuota.deleteMany({ where: { tenantId } });
  await db.device.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.disconnect();
});
async function context() {
  const id = randomUUID();
  await db.agentRun.create({
    data: { id, tenantId, deviceId, status: "active" },
  });
  return {
    tenantId,
    deviceId,
    credentialId: "synthetic",
    sessionId: id,
    conversationId: id,
    signal: new AbortController().signal,
  };
}
it("serializes concurrent admission and keeps quota/spend reservations across reconnects", async () => {
  const budgets = createConversationBudgets(repository, policy);
  const results = await Promise.allSettled([
    budgets.acquire(await context()),
    budgets.acquire(await context()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  for (const r of results)
    if (r.status === "fulfilled") {
      leases.push(r.value);
      await r.value.close();
    }
  const count = await db.conversationQuota.findFirstOrThrow({
    where: { tenantId, deviceId },
  });
  expect(count.sessions).toBe(1);
  expect(count.reservedMicros).toBe(10);
  await expect(
    createConversationBudgets(repository, {
      ...policy,
      sessionsPerDay: 1,
    }).acquire(await context()),
  ).rejects.toThrow("session quota");
  await expect(
    createConversationBudgets(repository, {
      ...policy,
      dailyBudgetMicros: 10,
    }).acquire(await context()),
  ).rejects.toThrow("spend allocation");
});
it("counts audio before forwarding, carries daily totals over reconnects, and cancels over-limit sessions", async () => {
  const budgets = createConversationBudgets(repository, policy);
  const first = await budgets.acquire(await context());
  leases.push(first);
  for (let i = 0; i < 50; i++) await first.audio(640);
  await expect(first.audio(640)).rejects.toThrow("Session audio quota");
  expect(first.signal.aborted).toBe(true);
  await first.close();
  const second = await budgets.acquire(await context());
  leases.push(second);
  await expect(second.audio(640)).rejects.toThrow("daily audio quota");
  await second.close();
});
it("marks absent final usage unknown, persists allowlisted correlated timings and no transcripts", async () => {
  const id = randomUUID();
  const ctx = {
    tenantId,
    deviceId,
    sessionId: id,
    conversationId: id,
    credentialId: "synthetic",
    signal: new AbortController().signal,
  };
  const fake = createFakeConversationProvider([
    [{ type: "text", text: "PRIVATE_RESPONSE" }, { type: "complete" }],
  ]);
  const runtime = createConversationRuntime({
    budgets: createConversationBudgets(repository, policy),
    provider: fake.factory,
    journal: createConversationJournal(
      new ConversationRepository(db),
      repository,
    ),
    tools: [],
    maxToolCalls: 1,
    turnTimeoutMs: 1000,
    execute: async () => ({}),
  });
  const session = await runtime.open(ctx);
  const turn = {
    ...ctx,
    source: "text" as const,
    turnId: randomUUID(),
    turnSequence: 1,
  };
  const output = { control: vi.fn(() => true), audio: () => true };
  const handle = await session.startTurn(turn, output);
  await handle.appendText?.("PRIVATE_REQUEST");
  await handle.commit({ ...turn, lastSequence: 0, committedAt: new Date() });
  await vi.waitFor(() =>
    expect(output.control).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.completed" }),
    ),
  );
  await session.close();
  const trace = await readConversationDiagnostics(id, { tenantId }, repository);
  expect(trace.costStatus).toBe("unknown");
  expect(trace.turns[0]?.usageStatus).toBe("unknown");
  expect(trace.phases.map((p) => p.phase)).toEqual(
    expect.arrayContaining([
      "input_started",
      "provider_requested",
      "provider_first_event",
      "first_useful_output",
      "completed",
    ]),
  );
  expect(JSON.stringify(trace)).not.toContain("PRIVATE_");
  expect(
    await db.message.findMany({
      where: { tenantId, runId: id },
      select: { contentText: true, partsJson: true },
    }),
  ).toEqual([
    { contentText: null, partsJson: "[]" },
    { contentText: null, partsJson: "[]" },
  ]);
  await expect(
    readConversationDiagnostics(id, { tenantId: randomUUID() }, repository),
  ).rejects.toThrow("not found");
});
it("clears private payloads and timings while preserving unknown write identities and current-day quotas", async () => {
  const ctx = await context();
  await db.agentRun.update({
    where: { id: ctx.conversationId },
    data: { leaseExpiresAt: new Date(0), retainTranscripts: true },
  });
  const executionId = randomUUID();
  await db.message.create({
    data: {
      tenantId,
      runId: ctx.conversationId,
      role: "user",
      contentText: "PRIVATE_TEXT",
    },
  });
  await db.toolExecution.create({
    data: {
      id: executionId,
      tenantId,
      runId: ctx.conversationId,
      toolCallId: "call",
      toolName: "notes.create",
      inputJson: '{"text":"PRIVATE_NOTE"}',
      status: "unknown",
      requestHash: "identity",
      effect: "write",
    },
  });
  await repository.phase(ctx, "input_started", 1);
  const stranger = await clearConversationPrivateData(
    { action: "delete", conversationId: ctx.conversationId },
    { tenantId: randomUUID() },
    repository,
    policy,
  );
  expect(stranger.cleared).toBe(0);
  const cleared = await clearConversationPrivateData(
    { action: "delete", conversationId: ctx.conversationId },
    { tenantId },
    repository,
    policy,
  );
  expect(cleared.cleared).toBe(1);
  expect(
    await db.toolExecution.findUniqueOrThrow({ where: { id: executionId } }),
  ).toMatchObject({
    status: "unknown",
    requestHash: "identity",
    inputJson: "{}",
    outputJson: null,
  });
  expect(
    await db.conversationPhase.count({
      where: { tenantId, runId: ctx.conversationId },
    }),
  ).toBe(0);
  expect(await db.conversationQuota.count({ where: { tenantId } })).toBe(1);
  expect(
    (
      await db.message.findFirstOrThrow({
        where: { tenantId, runId: ctx.conversationId },
      })
    ).contentText,
  ).toBeNull();
});
it("retention excludes recent and active records and scrubs old expired records", async () => {
  const old = await context(),
    active = await context(),
    recent = await context();
  const past = new Date(Date.now() - 8 * 86400000);
  await db.agentRun.update({
    where: { id: old.conversationId },
    data: { createdAt: past, leaseExpiresAt: past, title: "PRIVATE_OLD" },
  });
  await db.agentRun.update({
    where: { id: active.conversationId },
    data: { createdAt: past, leaseExpiresAt: new Date(Date.now() + 60000) },
  });
  await clearConversationPrivateData(
    { action: "cleanup" },
    { tenantId },
    repository,
    policy,
  );
  expect(
    (await db.agentRun.findUniqueOrThrow({ where: { id: old.conversationId } }))
      .privacyClearedAt,
  ).not.toBeNull();
  for (const ctx of [active, recent])
    expect(
      (
        await db.agentRun.findUniqueOrThrow({
          where: { id: ctx.conversationId },
        })
      ).privacyClearedAt,
    ).toBeNull();
  await db.agentRun.update({
    where: { id: active.conversationId },
    data: { leaseExpiresAt: new Date(0) },
  });
});
it("aborts an idle session at its deadline and stops further work after an estimated spend limit", async () => {
  const idle = await createConversationBudgets(repository, {
    ...policy,
    sessionTimeoutMs: 100,
  }).acquire(await context());
  leases.push(idle);
  await vi.waitFor(() => expect(idle.signal.aborted).toBe(true));
  await expect(idle.audio(640)).rejects.toThrow("time budget");
  await idle.close();
  const lease = await createConversationBudgets(repository, {
    ...policy,
    inputMicrosPerMillionTokens: 1000000,
    outputMicrosPerMillionTokens: 1000000,
  }).acquire(await context());
  leases.push(lease);
  expect(await lease.usage(2, 2, "turn")).toBe(4);
  expect(await lease.usage(2, 2, "turn")).toBe(4); // repeated aggregate is not charged twice
  await expect(lease.usage(6, 4, "turn")).rejects.toThrow("spend allocation");
  expect(lease.signal.aborted).toBe(true);
  await lease.close();
});
