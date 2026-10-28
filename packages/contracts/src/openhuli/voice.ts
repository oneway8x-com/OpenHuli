import { z } from "zod";
import {
  OpenHuliErrorSchema,
  OpenHuliIdSchema,
  OpenHuliPcmFormatSchema,
  OpenHuliSequenceSchema,
  OpenHuliStreamIdSchema,
  openHuliEnvelope,
  parseOpenHuliJson,
} from "./common";

const turn = { ...openHuliEnvelope, turnId: OpenHuliIdSchema };
export const OpenHuliVoiceClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...openHuliEnvelope,
      type: z.literal("session.start"),
      conversationId: OpenHuliIdSchema,
      streamingResponses: z.literal(true).optional(),
      inputFormat: OpenHuliPcmFormatSchema,
      outputFormat: OpenHuliPcmFormatSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("turn.start"),
      turnSequence: OpenHuliSequenceSchema.refine((sequence) => sequence > 0),
      streamId: OpenHuliStreamIdSchema,
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("turn.commit"),
      lastSequence: OpenHuliSequenceSchema,
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("turn.text"),
      turnSequence: OpenHuliSequenceSchema.refine((sequence) => sequence > 0),
      text: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z.object({ ...turn, type: z.literal("turn.cancel") }).strict(),
  z
    .object({
      ...turn,
      type: z.literal("playback.completed"),
      streamId: OpenHuliStreamIdSchema,
      lastSequence: OpenHuliSequenceSchema,
    })
    .strict(),
]);
export const OpenHuliVoiceServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...turn,
      type: z.literal("response.delta"),
      text: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("tool.result"),
      executionId: OpenHuliIdSchema,
      status: z.enum([
        "succeeded",
        "failed",
        "denied",
        "unknown",
        "awaiting_approval",
        "queued",
        "running",
        "cancelled",
        "expired",
      ]),
    })
    .strict(),

  z
    .object({
      ...openHuliEnvelope,
      type: z.literal("session.ready"),
      sessionId: OpenHuliIdSchema,
      streamingResponses: z.literal(true).optional(),
      inputFormat: OpenHuliPcmFormatSchema,
      outputFormat: OpenHuliPcmFormatSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("response.text"),
      text: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("audio.start"),
      streamId: OpenHuliStreamIdSchema,
      format: OpenHuliPcmFormatSchema,
    })
    .strict(),
  z
    .object({
      ...turn,
      type: z.literal("audio.generation.completed"),
      streamId: OpenHuliStreamIdSchema,
      lastSequence: OpenHuliSequenceSchema,
    })
    .strict(),
  z.object({ ...turn, type: z.literal("turn.completed") }).strict(),
  z
    .object({
      ...turn,
      type: z.literal("turn.failed"),
      error: OpenHuliErrorSchema,
    })
    .strict(),
  z
    .object({
      ...openHuliEnvelope,
      type: z.literal("session.error"),
      error: OpenHuliErrorSchema,
    })
    .strict(),
]);
export type OpenHuliVoiceClientMessage = z.infer<
  typeof OpenHuliVoiceClientMessageSchema
>;
export type OpenHuliVoiceServerMessage = z.infer<
  typeof OpenHuliVoiceServerMessageSchema
>;
export type OpenHuliVoiceMessage =
  | OpenHuliVoiceClientMessage
  | OpenHuliVoiceServerMessage;

export function parseOpenHuliVoiceClientMessage(
  text: string,
): OpenHuliVoiceClientMessage {
  return parseOpenHuliJson(text, OpenHuliVoiceClientMessageSchema);
}
export function parseOpenHuliVoiceServerMessage(
  text: string,
): OpenHuliVoiceServerMessage {
  return parseOpenHuliJson(text, OpenHuliVoiceServerMessageSchema);
}
