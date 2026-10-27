import { z } from "zod";
import {
  OpenHuliIdSchema,
  OpenHuliToolCallSchema,
  OpenHuliTurnSchema,
} from "@corely/contracts";

export const StartConversationSchema = z
  .object({
    id: OpenHuliIdSchema,
    deviceId: OpenHuliIdSchema.optional(),
    correlationId: OpenHuliIdSchema,
    retainTranscripts: z.boolean().default(false),
    expiresAt: z.date().optional(),
  })
  .strict();
export const StartTurnSchema = OpenHuliTurnSchema.extend({
  correlationId: OpenHuliIdSchema,
});
export const MessageInputSchema = z
  .object({
    id: OpenHuliIdSchema,
    conversationId: OpenHuliIdSchema,
    turnId: OpenHuliIdSchema,
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(4096).optional(),
  })
  .strict();
export const ClaimToolSchema = z
  .object({
    executionId: OpenHuliIdSchema,
    toolCall: OpenHuliToolCallSchema,
    correlationId: OpenHuliIdSchema,
    expiresAt: z.date(),
  })
  .strict();
export const UsageInputSchema = z
  .object({
    conversationId: OpenHuliIdSchema,
    turnId: OpenHuliIdSchema.optional(),
    eventId: OpenHuliIdSchema,
    metric: z.enum([
      "input_tokens",
      "output_tokens",
      "audio_input_ms",
      "audio_output_ms",
      "tool_calls",
      "cost_microusd",
    ]),
    quantity: z.number().int().min(0).max(2147483647),
  })
  .strict();
export type StartConversationInput = z.infer<typeof StartConversationSchema>;
export type StartTurnInput = z.infer<typeof StartTurnSchema>;
export type MessageInput = z.infer<typeof MessageInputSchema>;
export type ClaimToolInput = z.infer<typeof ClaimToolSchema>;
export type UsageInput = z.infer<typeof UsageInputSchema>;
