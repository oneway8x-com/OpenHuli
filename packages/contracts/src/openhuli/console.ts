import { z } from "zod";
import { OpenHuliIdSchema, OpenHuliJsonObjectSchema } from "./common";
export const ConsoleSnapshotSchema = z.object({
  id: OpenHuliIdSchema,
  deviceId: OpenHuliIdSchema.nullable(),
  retainTranscripts: z.boolean(),
  live: z.boolean(),
  turns: z.array(
    z.object({
      id: z.string(),
      sequence: z.number(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.string(),
      text: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  executions: z.array(
    z.object({
      executionId: OpenHuliIdSchema,
      turnId: z.string().nullable(),
      toolId: z.string(),
      status: z.string(),
      outcome: z.string().nullable(),
      arguments: OpenHuliJsonObjectSchema,
      output: OpenHuliJsonObjectSchema.nullable(),
      targetDeviceId: z.string().nullable(),
      requestHash: z.string().nullable(),
      approvalId: z.string().nullable(),
      expiresAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type ConsoleSnapshot = z.infer<typeof ConsoleSnapshotSchema>;
export const ConsoleCommandSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), deviceId: OpenHuliIdSchema })
    .strict(),
  z
    .object({
      action: z.literal("text"),
      conversationId: OpenHuliIdSchema,
      turnId: OpenHuliIdSchema,
      text: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({ action: z.literal("cancel"), conversationId: OpenHuliIdSchema })
    .strict(),
  z
    .object({
      action: z.literal("approval"),
      conversationId: OpenHuliIdSchema,
      executionId: OpenHuliIdSchema,
      approvalId: OpenHuliIdSchema,
      requestHash: z.string().regex(/^[a-f0-9]{64}$/),
      targetDeviceId: OpenHuliIdSchema.nullable(),
      decision: z.enum(["approve", "reject"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel-execution"),
      conversationId: OpenHuliIdSchema,
      executionId: OpenHuliIdSchema,
    })
    .strict(),
]);
