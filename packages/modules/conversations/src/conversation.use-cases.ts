import { z } from "zod";
import {
  OpenHuliApprovalDecisionSchema,
  OpenHuliApprovalRequestSchema,
  OpenHuliExecutionSchema,
  OpenHuliExecutionStatusSchema,
  OpenHuliIdSchema,
  OpenHuliTurnSchema,
} from "@corely/contracts";
import type { ConversationRepository } from "./conversation.repository";
import {
  ClaimToolSchema,
  MessageInputSchema,
  StartConversationSchema,
  StartTurnSchema,
  UsageInputSchema,
} from "./conversation.schemas";

// Trusted authenticated server context. Wire payloads cannot set tenant or owner authority.
export type ConversationContext = { tenantId: string };
const id = (value: unknown) => OpenHuliIdSchema.parse(value);
const turnReference = z
  .object({ conversationId: OpenHuliIdSchema, turnId: OpenHuliIdSchema })
  .strict();
const listInput = z
  .object({
    conversationId: OpenHuliIdSchema,
    take: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export async function startConversation(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = StartConversationSchema.parse(input);
  if (parsed.expiresAt && parsed.expiresAt <= now)
    throw new Error("Conversation must expire in the future");
  return repository.start(context.tenantId, parsed);
}
export async function getConversation(
  conversationId: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  return repository.find(context.tenantId, id(conversationId));
}
export async function startConversationTurn(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = StartTurnSchema.parse(input);
  if (parsed.status !== "collecting")
    throw new Error("New turns must start collecting");
  const run = await repository.find(context.tenantId, parsed.conversationId);
  if (
    !run ||
    run.status !== "active" ||
    (run.expiresAt && run.expiresAt <= now)
  )
    throw new Error("Active conversation not found");
  return repository.startTurn(context.tenantId, parsed);
}
export async function getConversationTurn(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  const parsed = turnReference.parse(input);
  return repository.findTurn(
    context.tenantId,
    parsed.conversationId,
    parsed.turnId,
  );
}
export async function transitionConversationTurn(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = turnReference
    .extend({ status: OpenHuliTurnSchema.shape.status })
    .parse(input);
  const turn = await repository.findTurn(
    context.tenantId,
    parsed.conversationId,
    parsed.turnId,
  );
  if (!turn) throw new Error("Turn not found");
  const transitions: Record<string, readonly string[]> = {
    collecting: ["committed", "cancelled", "failed"],
    committed: ["responding", "cancelled", "failed"],
    responding: ["completed", "cancelled", "failed"],
  };
  if (!transitions[turn.status]?.includes(parsed.status))
    throw new Error("Invalid turn transition");
  if (
    parsed.status === "completed" &&
    turn.generationCompletedAt &&
    !turn.playbackCompletedAt
  )
    throw new Error("Playback is not complete");
  const result = await repository.transitionTurn(
    context.tenantId,
    parsed.conversationId,
    parsed.turnId,
    turn.status,
    parsed.status,
    now,
  );
  if (!result.count) throw new Error("Turn changed concurrently");
  return result;
}
export async function recordTurnAudioCompletion(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = turnReference
    .extend({ kind: z.enum(["generation", "playback"]) })
    .parse(input);
  const result = await repository.recordAudioCompletion(
    context.tenantId,
    parsed.conversationId,
    parsed.turnId,
    parsed.kind,
    now,
  );
  if (!result.count)
    throw new Error("Audio completion is out of order or turn not found");
  return result;
}
export async function appendConversationMessage(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  return repository.appendMessage(
    context.tenantId,
    MessageInputSchema.parse(input),
  );
}
export async function getConversationMessages(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  const parsed = listInput.parse(input);
  return repository.messages(
    context.tenantId,
    parsed.conversationId,
    parsed.take,
  );
}
export async function claimToolExecution(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = ClaimToolSchema.parse(input);
  if (parsed.expiresAt <= now)
    throw new Error("Execution must expire in the future");
  const turn = await repository.findTurn(
    context.tenantId,
    parsed.toolCall.conversationId,
    parsed.toolCall.turnId,
  );
  if (!turn || !["committed", "responding"].includes(turn.status))
    throw new Error("Committed turn not found");
  return repository.claimTool(context.tenantId, parsed);
}
export async function getToolExecution(
  executionId: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  return repository.findExecution(context.tenantId, id(executionId));
}
export async function transitionToolExecution(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = z
    .object({
      from: OpenHuliExecutionStatusSchema,
      execution: OpenHuliExecutionSchema,
    })
    .strict()
    .parse(input);
  const execution = parsed.execution;
  const transitions: Record<string, readonly string[]> = {
    queued: ["running", "cancelled", "expired"],
    running: ["succeeded", "failed", "cancelled", "expired", "unknown"],
  };
  if (!transitions[parsed.from]?.includes(execution.status))
    throw new Error("Invalid execution transition");
  const stored = await repository.findExecution(
    context.tenantId,
    execution.executionId,
  );
  if (!stored || stored.toolCallId !== execution.toolCallId)
    throw new Error("Execution not found");
  const result = await repository.transitionExecution(
    context.tenantId,
    execution.executionId,
    parsed.from,
    execution.status,
    now,
    "output" in execution ? JSON.stringify(execution.output) : undefined,
    "error" in execution ? JSON.stringify(execution.error) : undefined,
  );
  if (!result.count)
    throw new Error("Execution changed, expired, or not found");
  return result;
}
export async function requestExecutionApproval(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = OpenHuliApprovalRequestSchema.parse(input);
  if (new Date(parsed.expiresAt) <= now)
    throw new Error("Approval must expire in the future");
  return repository.requestApproval(context.tenantId, parsed);
}
export async function getExecutionApproval(
  approvalId: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  return repository.findApproval(context.tenantId, id(approvalId));
}
export async function decideExecutionApproval(
  input: unknown,
  context: ConversationContext & { userId: string },
  repository: ConversationRepository,
  now = new Date(),
) {
  const parsed = OpenHuliApprovalDecisionSchema.parse(input);
  return repository.decideApproval(
    context.tenantId,
    parsed.approvalId,
    parsed.executionId,
    parsed.decision,
    context.userId,
    now,
  );
}
export async function recordConversationUsage(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  return repository.recordUsage(
    context.tenantId,
    UsageInputSchema.parse(input),
  );
}
export async function getConversationUsage(
  input: unknown,
  context: ConversationContext,
  repository: ConversationRepository,
) {
  const parsed = listInput.parse(input);
  return repository.usage(context.tenantId, parsed.conversationId, parsed.take);
}
