import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { VoiceSessionContext } from "@corely/modules-voice";
import type {
  ConversationPolicy,
  ConversationPhase,
} from "./conversation-operations.types";
import { VoiceLimitError } from "@corely/modules-voice";

/** Persistence and atomic quota admission. Every session for a Tenant shares one transaction lock. */
export class ConversationOperationsRepository {
  constructor(private readonly db: PrismaClient) {}
  async reserve(
    context: VoiceSessionContext,
    policy: ConversationPolicy,
    now: Date,
  ) {
    const { tenantId, deviceId, conversationId: id } = context;
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 20))`;
      const run = await tx.agentRun.findFirst({
        where: {
          tenantId,
          id,
          deviceId,
          status: "active",
          leaseExpiresAt: null,
        },
      });
      if (!run) throw new VoiceLimitError("Session admission unavailable");
      const quota = await tx.conversationQuota.findUnique({
        where: { tenantId_deviceId_day: { tenantId, deviceId, day } },
      });
      const concurrent = await tx.agentRun.count({
        where: { tenantId, deviceId, leaseExpiresAt: { gt: now } },
      });
      const total = await tx.conversationQuota.aggregate({
        where: { tenantId, day },
        _sum: { reservedMicros: true },
      });
      if (
        (quota?.sessions ?? 0) >= policy.sessionsPerDay ||
        concurrent >= policy.concurrentSessions
      )
        throw new VoiceLimitError("Device session quota reached");
      if (
        (total._sum.reservedMicros ?? 0) + policy.sessionReservationMicros >
        policy.dailyBudgetMicros
      )
        throw new VoiceLimitError("Provider spend allocation reached");
      await tx.conversationQuota.upsert({
        where: { tenantId_deviceId_day: { tenantId, deviceId, day } },
        create: {
          tenantId,
          deviceId,
          day,
          sessions: 1,
          reservedMicros: policy.sessionReservationMicros,
        },
        update: {
          sessions: { increment: 1 },
          reservedMicros: { increment: policy.sessionReservationMicros },
        },
      });
      await tx.agentRun.update({
        where: { tenantId_id: { tenantId, id } },
        data: {
          budgetReservedMicros: policy.sessionReservationMicros,
          leaseExpiresAt: new Date(now.getTime() + policy.sessionTimeoutMs),
        },
      });
      return day;
    });
  }
  async audio(
    context: VoiceSessionContext,
    day: Date,
    bytes: number,
    maxBytes: number,
  ) {
    const result = await this.db.conversationQuota.updateMany({
      where: {
        tenantId: context.tenantId,
        deviceId: context.deviceId,
        day,
        audioBytes: { lte: maxBytes - bytes },
      },
      data: { audioBytes: { increment: bytes } },
    });
    if (result.count !== 1)
      throw new VoiceLimitError("Device daily audio quota reached");
  }
  async close(context: VoiceSessionContext) {
    await this.db.agentRun.updateMany({
      where: { tenantId: context.tenantId, id: context.conversationId },
      data: {
        leaseExpiresAt: new Date(),
        status: "closed",
        finishedAt: new Date(),
      },
    });
  }
  async phase(
    context: VoiceSessionContext & { turnId?: string },
    phase: ConversationPhase,
    elapsedMs: number,
    executionId?: string,
  ) {
    await this.db.conversationPhase.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        runId: context.conversationId,
        turnId: context.turnId ?? null,
        phase,
        elapsedMs,
        executionId: executionId ?? null,
      },
    });
  }
  async usage(
    tenantId: string,
    runId: string,
    turnId: string,
    status: "reported" | "unknown",
    estimatedCostMicros: number | null,
  ) {
    await this.db.conversationTurn.updateMany({
      where: { tenantId, runId, id: turnId },
      data: { usageStatus: status, estimatedCostMicros },
    });
  }
  async diagnostics(tenantId: string, runId: string) {
    return this.db.agentRun.findUnique({
      where: { tenantId_id: { tenantId, id: runId } },
      select: {
        id: true,
        deviceId: true,
        correlationId: true,
        status: true,
        budgetReservedMicros: true,
        privacyClearedAt: true,
        turns: {
          orderBy: { sequence: "desc" },
          take: 30,
          select: {
            id: true,
            source: true,
            status: true,
            usageStatus: true,
            estimatedCostMicros: true,
          },
        },
        phases: {
          orderBy: { createdAt: "desc" },
          take: 300,
          select: {
            turnId: true,
            executionId: true,
            phase: true,
            elapsedMs: true,
            createdAt: true,
          },
        },
        toolExecutions: {
          take: 100,
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            turnId: true,
            toolName: true,
            status: true,
            outcomeKind: true,
            startedAt: true,
            finishedAt: true,
            commands: {
              select: {
                id: true,
                deviceId: true,
                status: true,
                issuedAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
    });
  }
  async privacy(tenantId: string, cutoff: Date, now: Date, runId?: string) {
    return this.db.$transaction(async (tx) => {
      // Never erase an active session, dispatch or reconciliation. Uncertain identities remain as tombstones.
      const runs = await tx.agentRun.findMany({
        where: {
          tenantId,
          ...(runId ? { id: runId } : { createdAt: { lt: cutoff } }),
          privacyClearedAt: null,
          OR: [
            { leaseExpiresAt: { lte: now } },
            { leaseExpiresAt: null, expiresAt: { lte: now } },
          ],
          toolExecutions: {
            none: {
              OR: [
                {
                  status: { in: ["queued", "running", "awaiting_approval"] },
                },
                { reconcileUntil: { gt: now } },
              ],
            },
          },
        },
        select: { id: true },
        take: 100,
      });
      const ids = runs.map((r) => r.id);
      const executions = await tx.toolExecution.findMany({
        where: { tenantId, runId: { in: ids } },
        select: { id: true },
      });
      const executionIds = executions.map((e) => e.id);
      await tx.message.updateMany({
        where: { tenantId, runId: { in: ids } },
        data: { contentText: null, partsJson: "[]" },
      });
      await tx.executionApproval.updateMany({
        where: { tenantId, executionId: { in: executionIds } },
        data: { argumentsJson: "{}" },
      });
      await tx.deviceCommand.updateMany({
        where: { tenantId, executionId: { in: executionIds } },
        data: { payloadJson: "{}", resultJson: null },
      });
      await tx.toolExecution.updateMany({
        where: { tenantId, runId: { in: ids } },
        data: {
          privateDataCleared: true,
          inputJson: "{}",
          outputJson: null,
          errorJson: null,
          actorJson: null,
        },
      });
      await tx.conversationPhase.deleteMany({
        where: { tenantId, runId: { in: ids } },
      });
      await tx.conversationUsage.deleteMany({
        where: { tenantId, runId: { in: ids } },
      });
      await tx.agentRun.updateMany({
        where: { tenantId, id: { in: ids } },
        data: {
          title: null,
          metadataJson: null,
          retainTranscripts: false,
          privacyClearedAt: now,
        },
      });
      await tx.conversationQuota.deleteMany({
        where: { tenantId, day: { lt: cutoff } },
      });
      return { cleared: ids.length };
    });
  }
  tenantsForCleanup() {
    return this.db.agentRun.findMany({
      distinct: ["tenantId"],
      select: { tenantId: true },
    });
  }
}
