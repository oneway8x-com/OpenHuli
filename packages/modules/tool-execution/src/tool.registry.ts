import { createHash } from "node:crypto";
import { z } from "zod";
import {
  OpenHuliIdSchema,
  OpenHuliJsonObjectSchema,
  OPENHULI_MAX_JSON_BYTES,
} from "@corely/contracts";
import type {
  JsonObject,
  RegisteredTool,
  ToolContext,
  ToolOutcome,
} from "./tool.types";

/** Stable serialization makes object key ordering irrelevant to an approval identity. */
export function canonicalJson(value: unknown): string {
  const object = OpenHuliJsonObjectSchema.parse(value);
  function sort(item: JsonObject[string]): JsonObject[string] {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, sort(item[key])]),
      );
    }
    return item;
  }
  const text = JSON.stringify(sort(object));
  if (Buffer.byteLength(text) > OPENHULI_MAX_JSON_BYTES)
    throw new Error("Tool JSON exceeds byte limit");
  return text;
}
export const hashJson = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const PolicySchema = z
  .object({
    id: OpenHuliIdSchema,
    revision: OpenHuliIdSchema,
    effect: z.enum(["read", "write"]),
    resource: z.enum(["tenant", "device"]),
    risk: z.enum(["low", "high"]),
    approval: z.enum(["never", "required"]),
    timeoutMs: z.number().int().min(10).max(30000),
    maxAttempts: z.number().int().min(1).max(3),
  })
  .strict()
  .refine(
    (p) => p.effect === "read" || p.maxAttempts === 1,
    "Writes cannot be retried by execution",
  )
  .refine(
    (p) => p.risk === "low" || p.approval === "required",
    "High-risk tools require per-execution approval",
  );
export function defineTool<
  A extends JsonObject,
  O extends JsonObject,
>(definition: {
  id: string;
  revision: string;
  effect: "read" | "write";
  resource: "tenant" | "device";
  risk: "low" | "high";
  approval: "never" | "required";
  timeoutMs: number;
  maxAttempts: number;
  input: z.ZodType<A, z.ZodTypeDef, unknown>;
  output: z.ZodType<O, z.ZodTypeDef, unknown>;
  target?: (args: A) => string;
  execute: (args: A, context: ToolContext) => Promise<ToolOutcome<O>>;
  // Query-only reconciliation: never repeat the original effect.
  reconcile?: (
    args: A,
    context: ToolContext,
  ) => Promise<ToolOutcome<O> | { kind: "unknown" }>;
}): RegisteredTool {
  const { input, output, target, execute, reconcile, ...policyInput } =
    definition;
  const policy = PolicySchema.parse(policyInput);
  if ((policy.resource === "device") !== Boolean(target))
    throw new Error("Device tools require an exact registered target resolver");
  const parse = (value: unknown) =>
    OpenHuliJsonObjectSchema.parse(
      input.parse(OpenHuliJsonObjectSchema.parse(value)),
    );
  const validateOutcome = (outcome: ToolOutcome<O>): ToolOutcome => {
    if (outcome.kind === "failed" && outcome.output === undefined)
      return { kind: "failed" };
    const result = OpenHuliJsonObjectSchema.parse(output.parse(outcome.output));
    canonicalJson(result);
    return { kind: outcome.kind, output: result };
  };
  return Object.freeze({
    ...policy,
    policyHash: hashJson(policy),
    parse,
    target: (value: JsonObject) =>
      target ? OpenHuliIdSchema.parse(target(input.parse(value))) : null,
    execute: async (value: JsonObject, context: ToolContext) =>
      validateOutcome(await execute(input.parse(value), context)),
    ...(reconcile
      ? {
          reconcile: async (value: JsonObject, context: ToolContext) => {
            const outcome = await reconcile(input.parse(value), context);
            return outcome.kind === "unknown"
              ? outcome
              : validateOutcome(outcome);
          },
        }
      : {}),
  });
}
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  constructor(tools: readonly RegisteredTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.id)) throw new Error("Duplicate registered tool");
      this.tools.set(tool.id, tool);
    }
  }
  get(id: string): RegisteredTool {
    const tool = this.tools.get(id);
    if (!tool) throw new Error("Tool is not registered");
    return tool;
  }
}
