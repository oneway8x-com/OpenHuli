import { z } from "zod";
import { OpenHuliIdSchema } from "@corely/contracts";
import { VoiceLimitError } from "@corely/modules-voice";
import type { ConversationOperationsRepository } from "./conversation-operations.repository";
import type {
  ConversationBudgets,
  ConversationPolicy,
} from "./conversation-operations.types";

/** Owner/operator configuration, never model or device claims. Amounts are integer micro USD. */
export const ConversationPolicySchema = z
  .object({
    sessionsPerDay: z.number().int().min(1).max(10000),
    concurrentSessions: z.number().int().min(1).max(32),
    audioSecondsPerDay: z.number().int().min(1).max(36000),
    audioSecondsPerSession: z.number().int().min(1).max(3600),
    sessionTimeoutMs: z.number().int().min(100).max(3600000),
    dailyBudgetMicros: z.number().int().min(0).max(1000000000),
    sessionReservationMicros: z.number().int().min(1).max(1000000000),
    inputMicrosPerMillionTokens: z
      .number()
      .int()
      .min(1)
      .max(1000000000)
      .optional(),
    outputMicrosPerMillionTokens: z
      .number()
      .int()
      .min(1)
      .max(1000000000)
      .optional(),
    retentionDays: z.number().int().min(1).max(30),
  })
  .strict();

export function createConversationBudgets(
  repository: ConversationOperationsRepository,
  input: ConversationPolicy,
): ConversationBudgets {
  const policy = ConversationPolicySchema.parse(input);
  return {
    async acquire(context) {
      if (context.signal.aborted) throw new Error("Session cancelled");
      const now = new Date();
      const day = await repository.reserve(context, policy, now);
      const controller = new AbortController();
      let bytes = 0,
        estimated = 0;
      const turnCosts = new Map<string, number>();
      let closing: Promise<void> | undefined;
      const fail = (message: string): never => {
        const error = new VoiceLimitError(message);
        controller.abort(error);
        throw error;
      };
      const timer = setTimeout(
        () =>
          controller.abort(new VoiceLimitError("Session time budget reached")),
        policy.sessionTimeoutMs,
      );
      timer.unref?.();
      const check = () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (context.signal.aborted) throw new Error("Session cancelled");
        if (Date.now() - now.getTime() >= policy.sessionTimeoutMs)
          fail("Session time budget reached");
      };
      return {
        signal: controller.signal,
        check,
        async audio(size) {
          check();
          z.number().int().min(1).max(640).parse(size);
          if (bytes + size > policy.audioSecondsPerSession * 32000)
            fail("Session audio quota reached");
          bytes += size;
          try {
            await repository.audio(
              context,
              day,
              size,
              policy.audioSecondsPerDay * 32000,
            );
          } catch (error) {
            controller.abort(error);
            throw error;
          }
          check();
        },
        async usage(inputTokens, outputTokens, turnId) {
          check();
          if (
            !policy.inputMicrosPerMillionTokens ||
            !policy.outputMicrosPerMillionTokens
          )
            return null;
          const cost = Math.ceil(
            (inputTokens * policy.inputMicrosPerMillionTokens +
              outputTokens * policy.outputMicrosPerMillionTokens) /
              1000000,
          );
          estimated += Math.max(0, cost - (turnCosts.get(turnId) ?? 0));
          turnCosts.set(turnId, Math.max(cost, turnCosts.get(turnId) ?? 0));
          if (estimated >= policy.sessionReservationMicros)
            fail("Provider session spend allocation reached");
          return cost;
        },
        close() {
          if (!closing) {
            clearTimeout(timer);
            controller.abort(new Error("Session closed"));
            closing = repository.close(context);
          }
          return closing;
        },
      };
    },
  };
}

/** Caller authenticates owner authority; requests cannot supply Tenant IDs. */
export async function readConversationDiagnostics(
  input: unknown,
  context: { tenantId: string },
  repository: ConversationOperationsRepository,
) {
  const record = await repository.diagnostics(
    context.tenantId,
    OpenHuliIdSchema.parse(input),
  );
  if (!record) throw new Error("Conversation not found");
  return {
    ...record,
    costUnit: "micro_usd",
    costStatus:
      record.turns.length === 0 ||
      record.turns.some(
        (t) => t.usageStatus === "unknown" || t.estimatedCostMicros === null,
      )
        ? "unknown"
        : "estimated",
    rawAudioRetained: false,
  };
}
export function clearConversationPrivateData(
  input: unknown,
  context: { tenantId: string },
  repository: ConversationOperationsRepository,
  policy: ConversationPolicy,
  now = new Date(),
) {
  const command = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("cleanup") }).strict(),
      z
        .object({
          action: z.literal("delete"),
          conversationId: OpenHuliIdSchema,
        })
        .strict(),
    ])
    .parse(input);
  return repository.privacy(
    context.tenantId,
    new Date(now.getTime() - policy.retentionDays * 86400000),
    now,
    command.action === "delete" ? command.conversationId : undefined,
  );
}
