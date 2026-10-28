import {
  OpenHuliIdSchema,
  OpenHuliJsonObjectSchema,
  type ConsoleSnapshot,
} from "@corely/contracts";
import type { ConversationRepository } from "./conversation.repository";

function publicObject(text: string | null) {
  if (!text) return null;
  if (text.length > 16384) return { unavailable: true };
  let value: unknown;
  try {
    value = OpenHuliJsonObjectSchema.parse(JSON.parse(text));
  } catch {
    return { unavailable: true };
  }
  const scrub = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(scrub);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, child]) => [
          key,
          /token|secret|password|authorization|cookie|api.?key/i.test(key)
            ? "[redacted]"
            : scrub(child),
        ]),
      );
    return input;
  };
  return OpenHuliJsonObjectSchema.parse(scrub(value));
}
/** Caller must authenticate the owner; Tenant authority is never accepted from a request body. */
export function listConsoleConversations(
  context: { tenantId: string },
  repository: ConversationRepository,
) {
  return repository.consoleList(context.tenantId);
}
export async function readConsoleActivity(
  input: unknown,
  context: { tenantId: string },
  repository: ConversationRepository,
): Promise<Omit<ConsoleSnapshot, "live">> {
  const record = await repository.consoleActivity(
    context.tenantId,
    OpenHuliIdSchema.parse(input),
  );
  if (!record) throw new Error("Conversation not found");
  return {
    id: record.id,
    deviceId: record.deviceId,
    retainTranscripts: record.retainTranscripts,
    turns: record.turns.map((t) => ({
      ...t,
      sequence: Number(t.sequence),
      createdAt: t.createdAt.toISOString(),
    })),
    messages: record.messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: record.retainTranscripts
        ? (m.contentText?.slice(0, 4096) ?? null)
        : null,
      createdAt: m.createdAt.toISOString(),
    })),
    executions: record.toolExecutions.map((e) => ({
      executionId: e.id,
      turnId: e.turnId,
      toolId: e.toolName,
      status: e.status,
      outcome: e.outcomeKind,
      arguments: publicObject(e.inputJson) ?? {},
      output: publicObject(e.outputJson),
      targetDeviceId: e.targetDeviceId,
      requestHash: e.requestHash,
      approvalId: e.approval?.status === "pending" ? e.approval.id : null,
      expiresAt: e.expiresAt?.toISOString() ?? null,
      createdAt: e.startedAt.toISOString(),
    })),
  };
}
