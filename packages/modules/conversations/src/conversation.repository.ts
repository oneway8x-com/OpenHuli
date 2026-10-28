import type { PrismaClient } from "@prisma/client";
import type {
  OpenHuliApprovalRequest,
  OpenHuliExecutionStatus,
} from "@corely/contracts";
import type {
  ClaimToolInput,
  MessageInput,
  StartConversationInput,
  StartTurnInput,
  UsageInput,
} from "./conversation.schemas";

export class ConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  consoleList(tenantId: string) {
    return this.db.agentRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        deviceId: true,
        createdAt: true,
        retainTranscripts: true,
      },
    });
  }
  consoleActivity(tenantId: string, id: string) {
    return this.db.agentRun.findUnique({
      where: { tenantId_id: { tenantId, id } },
      select: {
        id: true,
        deviceId: true,
        retainTranscripts: true,
        turns: {
          orderBy: { sequence: "desc" },
          take: 30,
          select: { id: true, sequence: true, status: true, createdAt: true },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, role: true, contentText: true, createdAt: true },
        },
        toolExecutions: {
          orderBy: { startedAt: "desc" },
          take: 30,
          select: {
            id: true,
            turnId: true,
            toolName: true,
            status: true,
            outcomeKind: true,
            inputJson: true,
            outputJson: true,
            targetDeviceId: true,
            requestHash: true,
            expiresAt: true,
            startedAt: true,
            approval: { select: { id: true, status: true } },
          },
        },
      },
    });
  }
  start(tenantId: string, input: StartConversationInput) {
    return this.db.agentRun.create({
      data: {
        id: input.id,
        tenantId,
        deviceId: input.deviceId ?? null,
        correlationId: input.correlationId,
        retainTranscripts: input.retainTranscripts,
        expiresAt: input.expiresAt ?? null,
        status: "active",
      },
    });
  }
  find(tenantId: string, id: string) {
    return this.db.agentRun.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
  }
  startTurn(tenantId: string, input: StartTurnInput) {
    return this.db.conversationTurn.create({
      data: {
        id: input.turnId,
        tenantId,
        runId: input.conversationId,
        sequence: BigInt(input.turnSequence),
        source: input.source,
        status: input.status,
        correlationId: input.correlationId,
      },
    });
  }
  findTurn(tenantId: string, runId: string, id: string) {
    return this.db.conversationTurn.findUnique({
      where: { tenantId_runId_id: { tenantId, runId, id } },
    });
  }
  transitionTurn(
    tenantId: string,
    runId: string,
    id: string,
    from: string,
    status: string,
    now: Date,
  ) {
    return this.db.conversationTurn.updateMany({
      where: {
        tenantId,
        runId,
        id,
        status: from,
        ...(status === "completed"
          ? {
              OR: [
                { generationCompletedAt: null },
                { playbackCompletedAt: { not: null } },
              ],
            }
          : {}),
      },
      data: {
        status,
        ...(["completed", "cancelled", "failed"].includes(status)
          ? { completedAt: now }
          : {}),
      },
    });
  }
  recordAudioCompletion(
    tenantId: string,
    runId: string,
    id: string,
    kind: "generation" | "playback",
    now: Date,
  ) {
    return this.db.conversationTurn.updateMany({
      where: {
        tenantId,
        runId,
        id,
        status: "responding",
        ...(kind === "generation"
          ? { generationCompletedAt: null }
          : {
              generationCompletedAt: { not: null },
              playbackCompletedAt: null,
            }),
      },
      data:
        kind === "generation"
          ? { generationCompletedAt: now }
          : { playbackCompletedAt: now },
    });
  }
  async appendMessage(tenantId: string, input: MessageInput) {
    return this.db.$transaction(async (tx) => {
      const run = await tx.agentRun.findUnique({
        where: { tenantId_id: { tenantId, id: input.conversationId } },
      });
      if (!run) throw new Error("Conversation not found");
      const turn = await tx.conversationTurn.findUnique({
        where: {
          tenantId_runId_id: {
            tenantId,
            runId: input.conversationId,
            id: input.turnId,
          },
        },
      });
      if (!turn) throw new Error("Turn not found");
      const text = run.retainTranscripts ? input.text : undefined;
      const message = await tx.message.create({
        data: {
          id: input.id,
          tenantId,
          runId: input.conversationId,
          turnId: input.turnId,
          role: input.role,
          correlationId: turn.correlationId,
          contentText: text ?? null,
          partsJson: text ? JSON.stringify([{ type: "text", text }]) : "[]",
        },
      });
      await tx.agentRun.update({
        where: { tenantId_id: { tenantId, id: input.conversationId } },
        data: { lastMessageAt: message.createdAt },
      });
      return message;
    });
  }
  messages(tenantId: string, runId: string, take: number) {
    return this.db.message.findMany({
      where: { tenantId, runId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
    });
  }
  async claimTool(tenantId: string, input: ClaimToolInput) {
    const call = input.toolCall;
    const inputJson = JSON.stringify(call.arguments);
    const inserted = await this.db.toolExecution.createMany({
      data: [
        {
          id: input.executionId,
          tenantId,
          runId: call.conversationId,
          turnId: call.turnId,
          toolCallId: call.toolCallId,
          toolName: call.toolId,
          inputJson,
          status: "queued",
          correlationId: input.correlationId,
          expiresAt: input.expiresAt,
        },
      ],
      skipDuplicates: true,
    });
    const execution = await this.db.toolExecution.findUnique({
      where: {
        tenantId_runId_toolCallId: {
          tenantId,
          runId: call.conversationId,
          toolCallId: call.toolCallId,
        },
      },
    });
    if (
      !execution ||
      execution.turnId !== call.turnId ||
      execution.toolName !== call.toolId ||
      execution.inputJson !== inputJson
    ) {
      throw new Error("Tool-call identity conflict");
    }
    // False means the caller must inspect the ledger, including unknown outcomes; never dispatch again.
    return { claimed: inserted.count === 1, execution };
  }
  findExecution(tenantId: string, id: string) {
    return this.db.toolExecution.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
  }
  transitionExecution(
    tenantId: string,
    id: string,
    from: OpenHuliExecutionStatus,
    status: OpenHuliExecutionStatus,
    now: Date,
    outputJson?: string,
    errorJson?: string,
  ) {
    return this.db.toolExecution.updateMany({
      where: {
        tenantId,
        id,
        status: from,
        requestHash: null,
        ...(status === "running"
          ? {
              expiresAt: { gt: now },
              turn: { status: { in: ["committed", "responding"] } },
              run: {
                status: "active",
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
            }
          : {}),
      },
      data: {
        status,
        ...(outputJson !== undefined ? { outputJson } : {}),
        ...(errorJson !== undefined ? { errorJson } : {}),
        ...(!["queued", "awaiting_approval", "running"].includes(status)
          ? { finishedAt: now }
          : {}),
      },
    });
  }
  async requestApproval(tenantId: string, input: OpenHuliApprovalRequest) {
    return this.db.$transaction(async (tx) => {
      const call = input.toolCall;
      const execution = await tx.toolExecution.findFirst({
        where: {
          tenantId,
          id: input.executionId,
          runId: call.conversationId,
          turnId: call.turnId,
          toolCallId: call.toolCallId,
          toolName: call.toolId,
          requestHash: null,
          inputJson: JSON.stringify(call.arguments),
          expiresAt: { gte: new Date(input.expiresAt) },
        },
      });
      if (!execution)
        throw new Error("Execution or exact approval arguments not found");
      const changed = await tx.toolExecution.updateMany({
        where: { tenantId, id: execution.id, status: "queued" },
        data: { status: "awaiting_approval" },
      });
      if (!changed.count)
        throw new Error("Execution is not awaiting approval setup");
      return tx.executionApproval.create({
        data: {
          id: input.approvalId,
          tenantId,
          executionId: execution.id,
          argumentsJson: execution.inputJson,
          expiresAt: new Date(input.expiresAt),
        },
      });
    });
  }
  findApproval(tenantId: string, id: string) {
    return this.db.executionApproval.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
  }
  async decideApproval(
    tenantId: string,
    id: string,
    executionId: string,
    decision: "approve" | "reject",
    userId: string,
    now: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      const approval = await tx.executionApproval.findFirst({
        where: { tenantId, id, executionId, requestHash: null },
      });
      if (!approval) throw new Error("Approval not found");
      const expired = approval.expiresAt <= now;
      const status = expired
        ? "expired"
        : decision === "approve"
          ? "approved"
          : "rejected";
      const changed = await tx.executionApproval.updateMany({
        where: { tenantId, id, executionId, status: "pending" },
        data: { status, decidedAt: now, decidedByUserId: userId },
      });
      if (!changed.count) throw new Error("Approval already decided");
      const execution = await tx.toolExecution.updateMany({
        where: {
          tenantId,
          id: executionId,
          status: "awaiting_approval",
          requestHash: null,
          inputJson: approval.argumentsJson,
        },
        data: {
          status: expired
            ? "expired"
            : decision === "approve"
              ? "queued"
              : "cancelled",
          ...(expired || decision === "reject" ? { finishedAt: now } : {}),
        },
      });
      if (!execution.count)
        throw new Error("Execution no longer awaiting approval");
      return { status };
    });
  }
  async recordUsage(tenantId: string, input: UsageInput) {
    const { conversationId, ...data } = input;
    const result = await this.db.conversationUsage.createMany({
      data: [
        {
          tenantId,
          runId: conversationId,
          ...data,
          turnId: data.turnId ?? null,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
  usage(tenantId: string, runId: string, take: number) {
    return this.db.conversationUsage.findMany({
      where: { tenantId, runId },
      take,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }
}
