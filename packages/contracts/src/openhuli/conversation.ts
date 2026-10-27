import { z } from "zod";
import {
  OpenHuliIdSchema,
  OpenHuliSequenceSchema,
  OpenHuliTimestampSchema,
  OpenHuliVersionSchema,
} from "./common";

export const OpenHuliConversationSchema = z
  .object({
    version: OpenHuliVersionSchema,
    conversationId: OpenHuliIdSchema,
    createdAt: OpenHuliTimestampSchema,
  })
  .strict();
export const OpenHuliTurnSchema = z
  .object({
    version: OpenHuliVersionSchema,
    conversationId: OpenHuliIdSchema,
    turnId: OpenHuliIdSchema,
    turnSequence: OpenHuliSequenceSchema.refine((sequence) => sequence > 0),
    source: z.enum(["text", "voice"]),
    status: z.enum([
      "collecting",
      "committed",
      "responding",
      "completed",
      "cancelled",
      "failed",
    ]),
  })
  .strict();
export const OpenHuliTextTurnInputSchema = z
  .object({
    version: OpenHuliVersionSchema,
    conversationId: OpenHuliIdSchema,
    turnId: OpenHuliIdSchema,
    text: z.string().min(1).max(4096),
  })
  .strict();
export type OpenHuliConversation = z.infer<typeof OpenHuliConversationSchema>;
export type OpenHuliTurn = z.infer<typeof OpenHuliTurnSchema>;
export type OpenHuliTextTurnInput = z.infer<typeof OpenHuliTextTurnInputSchema>;
