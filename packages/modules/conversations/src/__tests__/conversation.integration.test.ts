import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "@corely/data";
import { ConversationRepository } from "../conversation.repository";
import type { StartTurnInput } from "../conversation.schemas";
import * as conversation from "../conversation.use-cases";

const db = new PrismaService();
const repository = new ConversationRepository(db);
const a = { tenantId: randomUUID(), userId: randomUUID() };
const b = { tenantId: randomUUID(), userId: randomUUID() };
const now = new Date("2026-10-27T12:00:00Z");
const later = new Date(now.getTime() + 60_000);

beforeAll(async () => {
  await db.connect();
  for (const context of [a, b])
    await db.tenant.create({
      data: { id: context.tenantId, name: "Test", slug: context.tenantId },
    });
});
afterAll(async () => {
  const tenantId = { in: [a.tenantId, b.tenantId] };
  await db.conversationUsage.deleteMany({ where: { tenantId } });
  await db.message.deleteMany({ where: { tenantId } });
  await db.toolExecution.deleteMany({ where: { tenantId } });
  await db.conversationTurn.deleteMany({ where: { tenantId } });
  await db.agentRun.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.disconnect();
});
async function fixture(retainTranscripts = false) {
  const conversationId = randomUUID();
  const turnId = randomUUID();
  await conversation.startConversation(
    { id: conversationId, correlationId: "test", retainTranscripts },
    a,
    repository,
    now,
  );
  const turn: StartTurnInput = {
    version: 1,
    conversationId,
    turnId,
    turnSequence: 1,
    source: "voice",
    status: "collecting",
    correlationId: "test",
  };
  await conversation.startConversationTurn(turn, a, repository, now);
  await conversation.transitionConversationTurn(
    { conversationId, turnId, status: "committed" },
    a,
    repository,
    now,
  );
  const toolCall = {
    version: 1,
    conversationId,
    turnId,
    toolCallId: randomUUID(),
    toolId: "notes.create",
    arguments: { text: "approved arguments" },
  };
  return {
    conversationId,
    turnId,
    turn,
    claim: {
      executionId: randomUUID(),
      toolCall,
      correlationId: "test",
      expiresAt: later,
    },
  };
}

describe("conversation persistence and isolation", () => {
  it("isolates all conversation/turn reads and rejects foreign parent mutations", async () => {
    const { conversationId, turnId, turn, claim } = await fixture();
    expect(
      await conversation.getConversation(conversationId, b, repository),
    ).toBeNull();
    expect(
      await conversation.getConversationTurn(
        { conversationId, turnId },
        b,
        repository,
      ),
    ).toBeNull();
    await expect(
      conversation.startConversationTurn(
        { ...turn, turnId: randomUUID(), turnSequence: 2 },
        b,
        repository,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      conversation.transitionConversationTurn(
        { conversationId, turnId, status: "responding" },
        b,
        repository,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      conversation.recordTurnAudioCompletion(
        { conversationId, turnId, kind: "generation" },
        b,
        repository,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      conversation.claimToolExecution(claim, b, repository, now),
    ).rejects.toThrow();
    await expect(
      repository.startTurn(b.tenantId, {
        ...turn,
        turnId: randomUUID(),
        turnSequence: 2,
        source: "voice",
        status: "collecting",
      }),
    ).rejects.toThrow();
    await expect(
      conversation.startConversation(
        { id: randomUUID(), correlationId: "test", rawAudio: "forbidden" },
        a,
        repository,
      ),
    ).rejects.toThrow();
  });
  it("retains metadata only by default, including partsJson, and permits explicit transcript retention", async () => {
    for (const retain of [false, true]) {
      const { conversationId, turnId } = await fixture(retain);
      const input = {
        id: randomUUID(),
        conversationId,
        turnId,
        role: "user",
        text: "private transcript",
      };
      const stored = await conversation.appendConversationMessage(
        input,
        a,
        repository,
      );
      expect(stored.correlationId).toBe("test");
      expect(stored.contentText).toBe(retain ? input.text : null);
      expect(stored.partsJson).toBe(
        retain ? JSON.stringify([{ type: "text", text: input.text }]) : "[]",
      );
      expect(
        await conversation.getConversationMessages(
          { conversationId },
          a,
          repository,
        ),
      ).toHaveLength(1);
      expect(
        await conversation.getConversationMessages(
          { conversationId },
          b,
          repository,
        ),
      ).toEqual([]);
      await expect(
        conversation.appendConversationMessage(
          { ...input, id: randomUUID() },
          b,
          repository,
        ),
      ).rejects.toThrow();
      const other = await fixture();
      await expect(
        conversation.appendConversationMessage(
          { ...input, id: randomUUID(), turnId: other.turnId },
          a,
          repository,
        ),
      ).rejects.toThrow();
    }
    const run = await conversation.startConversation(
      { id: randomUUID(), correlationId: "test" },
      a,
      repository,
      now,
    );
    expect(run.retainTranscripts).toBe(false);
  });
  it("durably reserves a tool-call once under concurrent deliveries and a new repository instance", async () => {
    const { claim } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        conversation.claimToolExecution(
          { ...claim, executionId: randomUUID() },
          a,
          repository,
          now,
        ),
      ),
    );
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.execution.id)).size).toBe(1);
    const duplicate = await conversation.claimToolExecution(
      claim,
      a,
      new ConversationRepository(db),
      now,
    );
    expect(duplicate.claimed).toBe(false);
    expect(
      await conversation.getToolExecution(
        duplicate.execution.id,
        b,
        repository,
      ),
    ).toBeNull();
    await expect(
      conversation.claimToolExecution(
        {
          ...claim,
          toolCall: { ...claim.toolCall, arguments: { text: "different" } },
        },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow("identity conflict");
  });
  it("preserves unknown outcomes and rejects cross-tenant execution transitions", async () => {
    const { claim } = await fixture();
    await conversation.claimToolExecution(claim, a, repository, now);
    const execution = {
      version: 1,
      executionId: claim.executionId,
      toolCallId: claim.toolCall.toolCallId,
      updatedAt: now.toISOString(),
      status: "running",
    };
    await expect(
      conversation.transitionToolExecution(
        { from: "queued", execution },
        b,
        repository,
        now,
      ),
    ).rejects.toThrow();
    await conversation.transitionToolExecution(
      { from: "queued", execution },
      a,
      repository,
      now,
    );
    const error = {
      code: "outcome_unknown",
      message: "Connection lost",
      correlationId: "test",
      retryable: false,
    };
    await conversation.transitionToolExecution(
      {
        from: "running",
        execution: { ...execution, status: "unknown", error },
      },
      a,
      repository,
      now,
    );
    expect(
      (
        await conversation.claimToolExecution(
          claim,
          a,
          new ConversationRepository(db),
          now,
        )
      ).claimed,
    ).toBe(false);
    expect(
      (await conversation.getToolExecution(claim.executionId, a, repository))
        ?.status,
    ).toBe("unknown");
    await expect(
      conversation.transitionToolExecution(
        { from: "unknown", execution },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow("Invalid execution transition");
  });
  it("does not dispatch uncommitted or cancelled turns", async () => {
    const { conversationId, turnId, turn, claim } = await fixture();
    const collecting = { ...turn, turnId: randomUUID(), turnSequence: 2 };
    await conversation.startConversationTurn(collecting, a, repository, now);
    await expect(
      conversation.claimToolExecution(
        {
          ...claim,
          toolCall: { ...claim.toolCall, turnId: collecting.turnId },
        },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow("Committed turn");
    await conversation.claimToolExecution(claim, a, repository, now);
    await conversation.transitionConversationTurn(
      { conversationId, turnId, status: "cancelled" },
      a,
      repository,
      now,
    );
    await expect(
      conversation.transitionToolExecution(
        {
          from: "queued",
          execution: {
            version: 1,
            executionId: claim.executionId,
            toolCallId: claim.toolCall.toolCallId,
            updatedAt: now.toISOString(),
            status: "running",
          },
        },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow();
    expect(
      (await conversation.getToolExecution(claim.executionId, a, repository))
        ?.status,
    ).toBe("queued");
  });
  it("stores exact approval arguments and atomically decides once", async () => {
    const { claim } = await fixture();
    await conversation.claimToolExecution(claim, a, repository, now);
    const request = {
      version: 1,
      approvalId: randomUUID(),
      executionId: claim.executionId,
      toolCall: claim.toolCall,
      expiresAt: later.toISOString(),
    };
    await expect(
      conversation.requestExecutionApproval(request, b, repository, now),
    ).rejects.toThrow();
    await expect(
      conversation.requestExecutionApproval(
        {
          ...request,
          toolCall: { ...claim.toolCall, arguments: { text: "substitution" } },
        },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow("exact approval arguments");
    await conversation.requestExecutionApproval(request, a, repository, now);
    const approval = await conversation.getExecutionApproval(
      request.approvalId,
      a,
      repository,
    );
    expect(approval?.argumentsJson).toBe(
      JSON.stringify(claim.toolCall.arguments),
    );
    expect(
      await conversation.getExecutionApproval(
        request.approvalId,
        b,
        repository,
      ),
    ).toBeNull();
    const decision = {
      version: 1,
      approvalId: request.approvalId,
      executionId: request.executionId,
      decision: "approve",
    };
    await expect(
      conversation.decideExecutionApproval(decision, b, repository, now),
    ).rejects.toThrow();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        conversation.decideExecutionApproval(decision, a, repository, now),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (await conversation.getToolExecution(claim.executionId, a, repository))
        ?.status,
    ).toBe("queued");
    expect(
      (
        await conversation.getExecutionApproval(
          request.approvalId,
          a,
          repository,
        )
      )?.decidedByUserId,
    ).toBe(a.userId);
  });
  it("expires approvals durably and cannot start an expired execution", async () => {
    const { claim } = await fixture();
    await conversation.claimToolExecution(claim, a, repository, now);
    const request = {
      version: 1,
      approvalId: randomUUID(),
      executionId: claim.executionId,
      toolCall: claim.toolCall,
      expiresAt: later.toISOString(),
    };
    await conversation.requestExecutionApproval(request, a, repository, now);
    expect(
      await conversation.decideExecutionApproval(
        {
          version: 1,
          approvalId: request.approvalId,
          executionId: claim.executionId,
          decision: "approve",
        },
        a,
        repository,
        later,
      ),
    ).toEqual({ status: "expired" });
    expect(
      (await conversation.getToolExecution(claim.executionId, a, repository))
        ?.status,
    ).toBe("expired");
    const other = await fixture();
    await conversation.claimToolExecution(other.claim, a, repository, now);
    await expect(
      conversation.transitionToolExecution(
        {
          from: "queued",
          execution: {
            version: 1,
            executionId: other.claim.executionId,
            toolCallId: other.claim.toolCall.toolCallId,
            updatedAt: later.toISOString(),
            status: "running",
          },
        },
        a,
        repository,
        later,
      ),
    ).rejects.toThrow("expired");
  });
  it("keeps generation and playback completion distinct and enforces turn ordering", async () => {
    const { conversationId, turnId, turn } = await fixture();
    const ref = { conversationId, turnId };
    await expect(
      conversation.startConversationTurn(
        { ...turn, turnId: randomUUID() },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow();
    await conversation.transitionConversationTurn(
      { ...ref, status: "responding" },
      a,
      repository,
      now,
    );
    await expect(
      conversation.recordTurnAudioCompletion(
        { ...ref, kind: "playback" },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow("out of order");
    await conversation.recordTurnAudioCompletion(
      { ...ref, kind: "generation" },
      a,
      repository,
      now,
    );
    await expect(
      conversation.transitionConversationTurn(
        { ...ref, status: "completed" },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow("Playback");
    await conversation.recordTurnAudioCompletion(
      { ...ref, kind: "playback" },
      a,
      repository,
      later,
    );
    await conversation.transitionConversationTurn(
      { ...ref, status: "completed" },
      a,
      repository,
      later,
    );
    const stored = await conversation.getConversationTurn(ref, a, repository);
    expect(stored?.generationCompletedAt).toEqual(now);
    expect(stored?.playbackCompletedAt).toEqual(later);
    expect(stored?.status).toBe("completed");
  });
  it("deduplicates usage and isolates reads and cross-tenant/cross-conversation writes", async () => {
    const { conversationId, turnId } = await fixture();
    const input = {
      conversationId,
      turnId,
      eventId: randomUUID(),
      metric: "input_tokens",
      quantity: 12,
    };
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        conversation.recordConversationUsage(input, a, repository),
      ),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(
      await conversation.getConversationUsage(
        { conversationId },
        a,
        repository,
      ),
    ).toHaveLength(1);
    expect(
      await conversation.getConversationUsage(
        { conversationId },
        b,
        repository,
      ),
    ).toEqual([]);
    await expect(
      conversation.recordConversationUsage(input, b, repository),
    ).rejects.toThrow();
    const other = await fixture();
    await expect(
      conversation.recordConversationUsage(
        { ...input, eventId: randomUUID(), turnId: other.turnId },
        a,
        repository,
      ),
    ).rejects.toThrow();
    await expect(
      conversation.recordConversationUsage(
        { ...input, quantity: -1 },
        a,
        repository,
      ),
    ).rejects.toThrow();
  });
});
