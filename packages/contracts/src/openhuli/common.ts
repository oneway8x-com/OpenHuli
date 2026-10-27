import { z } from "zod";

export const OPENHULI_PROTOCOL_VERSION = 1;
export const OPENHULI_MAX_JSON_BYTES = 16_384;
export const OpenHuliVersionSchema = z.literal(OPENHULI_PROTOCOL_VERSION);
export const OpenHuliIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const OpenHuliSequenceSchema = z.number().int().min(0).max(0xffff_ffff);
export const OpenHuliStreamIdSchema = OpenHuliSequenceSchema.refine(
  (id) => id > 0,
);
export const OpenHuliTimestampSchema = z.string().datetime({ offset: true });
export const openHuliEnvelope = {
  version: OpenHuliVersionSchema,
  messageId: OpenHuliIdSchema,
};

export class OpenHuliProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenHuliProtocolError";
  }
}

// Bound traversal before recursive schema validation, including direct schema consumers.
function isBoundedJson(value: unknown): boolean {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item || ++nodes > 1024 || item.depth > 8) return false;
    if (item.value !== null && typeof item.value === "object") {
      for (const child of Object.values(item.value)) {
        if (stack.length >= 1024) return false;
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return true;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(4096),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema).max(64),
    z.record(z.string().min(1).max(64), JsonValueSchema),
  ]),
);
export const OpenHuliJsonObjectSchema = z
  .unknown()
  .refine(isBoundedJson, "JSON exceeds depth/node limits")
  .pipe(z.record(z.string().min(1).max(64), JsonValueSchema));

/** Complete UTF-8 JSON messages only. Set the transport's byte limit too. */
export function parseOpenHuliJson<T>(text: string, schema: z.ZodType<T>): T {
  if (
    text.length > OPENHULI_MAX_JSON_BYTES ||
    new TextEncoder().encode(text).length > OPENHULI_MAX_JSON_BYTES
  ) {
    throw new OpenHuliProtocolError("JSON message exceeds byte limit");
  }
  const value: unknown = JSON.parse(text);
  if (!isBoundedJson(value))
    throw new OpenHuliProtocolError("JSON exceeds depth/node limits");
  return schema.parse(value);
}

export const OpenHuliErrorSchema = z
  .object({
    code: z.enum([
      "invalid_message",
      "unsupported_version",
      "unsupported_capability",
      "unauthorized",
      "not_found",
      "out_of_order",
      "duplicate_id",
      "expired",
      "cancelled",
      "limit_exceeded",
      "provider_unavailable",
      "execution_failed",
      "outcome_unknown",
    ]),
    message: z.string().min(1).max(256),
    correlationId: OpenHuliIdSchema,
    retryable: z.boolean(),
  })
  .strict();
export type OpenHuliError = z.infer<typeof OpenHuliErrorSchema>;

export const OpenHuliPcmFormatSchema = z
  .object({
    encoding: z.literal("pcm_s16le"),
    sampleRateHz: z.literal(16000),
    channels: z.literal(1),
    chunkDurationMs: z.literal(20),
  })
  .strict();
export const OPENHULI_PCM_FORMAT = OpenHuliPcmFormatSchema.parse({
  encoding: "pcm_s16le",
  sampleRateHz: 16000,
  channels: 1,
  chunkDurationMs: 20,
});
