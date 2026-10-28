import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Actor, ExecutionRecord, ToolOutcome } from "./tool.types";

export interface ReservedCall {
  tenantId: string;
  runId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  inputJson: string;
  requestHash: string;
  policyHash: string;
  actor: Actor;
  targetDeviceId: string | null;
  expiresAt: Date;
  correlationId: string;
  needsApproval: boolean;
  effect: "read" | "write";
}
export class ToolExecutionRepository {
  constructor(private readonly db: PrismaClient) {}
  async context(tenantId: string, runId: string, turnId: string, now: Date) {
    if (
      !(await this.db.tenant.findFirst({
        where: { id: tenantId, status: "ACTIVE" },
        select: { id: true },
      }))
    )
      return null;
    return this.db.agentRun.findFirst({
      where: {
        tenantId,
        id: runId,
        status: "active",
        privacyClearedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        turns: {
          some: {
            tenantId,
            id: turnId,
            status: { in: ["committed", "responding"] },
          },
        },
      },
      select: { deviceId: true, expiresAt: true },
    });
  }
  async reserve(call: ReservedCall): Promise<ExecutionRecord> {
    return this.db.$transaction(async (tx) => {
      const id = randomUUID();
      const inserted = await tx.toolExecution.createMany({
        data: [
          {
            id,
            tenantId: call.tenantId,
            runId: call.runId,
            turnId: call.turnId,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            inputJson: call.inputJson,
            requestHash: call.requestHash,
            policyHash: call.policyHash,
            actorJson: JSON.stringify(call.actor),
            targetDeviceId: call.targetDeviceId,
            expiresAt: call.expiresAt,
            correlationId: call.correlationId,
            effect: call.effect,
            status: call.needsApproval ? "awaiting_approval" : "queued",
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count && call.needsApproval)
        await tx.executionApproval.create({
          data: {
            id: randomUUID(),
            tenantId: call.tenantId,
            executionId: id,
            argumentsJson: call.inputJson,
            requestHash: call.requestHash,
            expiresAt: call.expiresAt,
          },
        });
      const record = await tx.toolExecution.findUnique({
        where: {
          tenantId_runId_toolCallId: {
            tenantId: call.tenantId,
            runId: call.runId,
            toolCallId: call.toolCallId,
          },
        },
        include: { approval: true },
      });
      if (
        !record ||
        record.requestHash !== call.requestHash ||
        record.actorJson !== JSON.stringify(call.actor)
      )
        throw new Error("Tool-call identity conflict");
      if (inserted.count)
        await tx.auditLog.create({
          data: {
            tenantId: call.tenantId,
            action: "tools.requested",
            entity: "ToolExecution",
            entityId: id,
            details: call.requestHash,
          },
        });
      return record;
    });
  }
  get(tenantId: string, id: string): Promise<ExecutionRecord | null> {
    return this.db.toolExecution.findFirst({
      where: { tenantId, id, requestHash: { not: null } },
      include: { approval: true },
    });
  }
  findByCall(
    tenantId: string,
    runId: string,
    toolCallId: string,
  ): Promise<ExecutionRecord | null> {
    return this.db.toolExecution.findUnique({
      where: { tenantId_runId_toolCallId: { tenantId, runId, toolCallId } },
      include: { approval: true },
    });
  }
  async begin(record: ExecutionRecord, deadline: Date): Promise<boolean> {
    const now = new Date();
    const changed = await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        requestHash: record.requestHash,
        status: "queued",
        privateDataCleared: false,
        expiresAt: { gt: now },
        turn: { status: { in: ["committed", "responding"] } },
        run: {
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
      data: {
        status: "running",
        startedAt: now,
        dispatchDeadline: deadline,
        attempts: 1,
      },
    });
    return changed.count === 1;
  }
  async finish(
    record: ExecutionRecord,
    status: string,
    error: string | null,
    attempts: number,
    outcome?: ToolOutcome,
    from = "running",
  ) {
    const result = await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        requestHash: record.requestHash,
        status: from,
      },
      data: {
        status,
        errorJson: error,
        attempts,
        finishedAt: new Date(),
        outcomeKind: outcome?.kind ?? null,
        outputJson:
          outcome && "output" in outcome
            ? JSON.stringify(outcome.output)
            : null,
      },
    });
    return result.count === 1;
  }
  async decide(
    record: ExecutionRecord,
    approvalId: string,
    userId: string,
    decision: "approve" | "reject",
    now: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.executionApproval.updateMany({
        where: {
          tenantId: record.tenantId,
          id: approvalId,
          executionId: record.id,
          requestHash: record.requestHash,
          argumentsJson: record.inputJson,
          status: "pending",
          expiresAt: { gt: now },
        },
        data: {
          status: decision === "approve" ? "approved" : "rejected",
          decidedAt: now,
          decidedByUserId: userId,
        },
      });
      if (!changed.count)
        throw new Error("Approval expired, changed, or already decided");
      const result = await tx.toolExecution.updateMany({
        where: {
          tenantId: record.tenantId,
          id: record.id,
          requestHash: record.requestHash,
          status: "awaiting_approval",
          expiresAt: { gt: now },
          turn: { status: { in: ["committed", "responding"] } },
          run: {
            status: "active",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
        data: {
          status: decision === "approve" ? "queued" : "cancelled",
          ...(decision === "reject"
            ? { finishedAt: now, errorJson: "Approval rejected" }
            : {}),
        },
      });
      if (!result.count)
        throw new Error("Execution is no longer awaiting approval");
      await tx.auditLog.create({
        data: {
          tenantId: record.tenantId,
          actorUserId: userId,
          action: decision === "approve" ? "tools.approved" : "tools.rejected",
          entity: "ToolExecution",
          entityId: record.id,
          details: record.requestHash,
        },
      });
    });
  }
  async cancel(
    record: ExecutionRecord,
    runningStatus: "cancelled" | "unknown",
  ) {
    await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        requestHash: record.requestHash,
        status: { in: ["queued", "awaiting_approval"] },
      },
      data: {
        status: "cancelled",
        errorJson: "Execution cancelled",
        finishedAt: new Date(),
      },
    });
    await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        requestHash: record.requestHash,
        status: "running",
      },
      data: {
        status: runningStatus,
        errorJson: "Execution cancelled after dispatch",
        finishedAt: new Date(),
      },
    });
  }
  preauthorize(input: {
    tenantId: string;
    ownerUserId: string;
    toolId: string;
    policyHash: string;
    scopeKey: string;
    sourceDeviceId: string | null;
    targetDeviceId: string | null;
    expiresAt: Date;
  }) {
    const { tenantId, ownerUserId, toolId, policyHash, scopeKey } = input;
    return this.db.toolPreauthorization.upsert({
      where: {
        tenantId_ownerUserId_toolId_policyHash_scopeKey: {
          tenantId,
          ownerUserId,
          toolId,
          policyHash,
          scopeKey,
        },
      },
      create: input,
      update: { expiresAt: input.expiresAt, revokedAt: null },
    });
  }
  async revokePreauthorization(
    tenantId: string,
    ownerUserId: string,
    id: string,
  ) {
    await this.db.toolPreauthorization.updateMany({
      where: { tenantId, ownerUserId, id },
      data: { revokedAt: new Date() },
    });
  }
  async preauthorization(
    tenantId: string,
    ownerUserId: string,
    toolId: string,
    policyHash: string,
    scopeKey: string,
    now: Date,
  ) {
    return Boolean(
      await this.db.toolPreauthorization.findFirst({
        where: {
          tenantId,
          ownerUserId,
          toolId,
          policyHash,
          scopeKey,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      }),
    );
  }
  async markAbandoned(record: ExecutionRecord, now: Date) {
    await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        status: "running",
        dispatchDeadline: { lte: now },
      },
      data: {
        status: "unknown",
        errorJson: "Process lost before outcome was confirmed",
        finishedAt: now,
      },
    });
  }
  async claimReconciliation(
    record: ExecutionRecord,
    token: string,
    until: Date,
  ) {
    const result = await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        status: "unknown",
        privateDataCleared: false,
        requestHash: record.requestHash,
        OR: [{ reconcileUntil: null }, { reconcileUntil: { lte: new Date() } }],
      },
      data: { reconcileToken: token, reconcileUntil: until },
    });
    return result.count === 1;
  }
  async finishReconciliation(
    record: ExecutionRecord,
    token: string,
    outcome: ToolOutcome | null,
  ) {
    await this.db.toolExecution.updateMany({
      where: {
        tenantId: record.tenantId,
        id: record.id,
        status: "unknown",
        privateDataCleared: false,
        reconcileToken: token,
      },
      data: {
        reconcileToken: null,
        reconcileUntil: null,
        ...(outcome
          ? {
              status: outcome.kind === "succeeded" ? "succeeded" : "failed",
              outcomeKind: outcome.kind,
              outputJson:
                "output" in outcome ? JSON.stringify(outcome.output) : null,
              errorJson:
                outcome.kind === "succeeded"
                  ? null
                  : outcome.kind === "partial"
                    ? "Partially completed"
                    : "Provider confirmed failure",
              finishedAt: new Date(),
            }
          : {}),
      },
    });
  }
}
