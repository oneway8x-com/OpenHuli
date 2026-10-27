import { z } from "zod";
import {
  OpenHuliErrorSchema,
  OpenHuliIdSchema,
  OpenHuliJsonObjectSchema,
  OpenHuliTimestampSchema,
  OpenHuliVersionSchema,
} from "./common";

export const OpenHuliExecutionStatusSchema = z.enum([
  "queued",
  "awaiting_approval",
  "running",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
  "unknown",
]);
export const OpenHuliToolDefinitionSchema = z
  .object({
    version: OpenHuliVersionSchema,
    toolId: OpenHuliIdSchema,
    description: z.string().min(1).max(512),
    effect: z.enum(["read", "write"]),
    approval: z.enum(["never", "required"]),
    inputSchema: OpenHuliJsonObjectSchema,
    outputSchema: OpenHuliJsonObjectSchema,
  })
  .strict();
export const OpenHuliToolCallSchema = z
  .object({
    version: OpenHuliVersionSchema,
    toolCallId: OpenHuliIdSchema,
    conversationId: OpenHuliIdSchema,
    turnId: OpenHuliIdSchema,
    toolId: OpenHuliIdSchema,
    arguments: OpenHuliJsonObjectSchema,
  })
  .strict();
export const OpenHuliApprovalRequestSchema = z
  .object({
    version: OpenHuliVersionSchema,
    approvalId: OpenHuliIdSchema,
    executionId: OpenHuliIdSchema,
    toolCall: OpenHuliToolCallSchema,
    expiresAt: OpenHuliTimestampSchema,
  })
  .strict();
export const OpenHuliApprovalDecisionSchema = z
  .object({
    version: OpenHuliVersionSchema,
    approvalId: OpenHuliIdSchema,
    executionId: OpenHuliIdSchema,
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

const executionBase = {
  version: OpenHuliVersionSchema,
  executionId: OpenHuliIdSchema,
  toolCallId: OpenHuliIdSchema,
  updatedAt: OpenHuliTimestampSchema,
};
export const OpenHuliExecutionSchema = z.discriminatedUnion("status", [
  z.object({ ...executionBase, status: z.literal("queued") }).strict(),
  z
    .object({
      ...executionBase,
      status: z.literal("awaiting_approval"),
      approvalId: OpenHuliIdSchema,
    })
    .strict(),
  z.object({ ...executionBase, status: z.literal("running") }).strict(),
  z
    .object({
      ...executionBase,
      status: z.literal("succeeded"),
      output: OpenHuliJsonObjectSchema,
    })
    .strict(),
  z
    .object({
      ...executionBase,
      status: z.enum(["failed", "expired", "cancelled", "unknown"]),
      error: OpenHuliErrorSchema,
    })
    .strict(),
]);
export type OpenHuliExecutionStatus = z.infer<
  typeof OpenHuliExecutionStatusSchema
>;
export type OpenHuliToolDefinition = z.infer<
  typeof OpenHuliToolDefinitionSchema
>;
export type OpenHuliToolCall = z.infer<typeof OpenHuliToolCallSchema>;
export type OpenHuliApprovalRequest = z.infer<
  typeof OpenHuliApprovalRequestSchema
>;
export type OpenHuliApprovalDecision = z.infer<
  typeof OpenHuliApprovalDecisionSchema
>;
export type OpenHuliExecution = z.infer<typeof OpenHuliExecutionSchema>;
