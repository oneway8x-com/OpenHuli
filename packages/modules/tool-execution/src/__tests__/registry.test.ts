import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalJson,
  defineTool,
  hashJson,
  ToolRegistry,
} from "../tool.registry";

function definition() {
  return {
    id: "test.read",
    revision: "v1",
    effect: "read" as const,
    resource: "tenant" as const,
    risk: "low" as const,
    approval: "never" as const,
    timeoutMs: 100,
    maxAttempts: 2,
    input: z.object({ text: z.string().min(1) }).strict(),
    output: z.object({ value: z.string() }).strict(),
    execute: async () => ({
      kind: "succeeded" as const,
      output: { value: "ok" },
    }),
  };
}
describe("server-owned tool registry", () => {
  it("rejects duplicate tools, unknown tools, invalid inputs and excessive JSON", () => {
    const tool = defineTool(definition());
    expect(() => new ToolRegistry([tool, tool])).toThrow("Duplicate");
    expect(() => new ToolRegistry([tool]).get("made.up")).toThrow("registered");
    expect(() =>
      tool.parse({ text: "x", destination: "https://untrusted.example" }),
    ).toThrow();
    expect(() => canonicalJson({ payload: "x".repeat(4097) })).toThrow();
    expect(() =>
      canonicalJson({ nested: Array.from({ length: 65 }, () => "x") }),
    ).toThrow();
  });
  it("canonicalizes nested arguments and binds policy revisions", () => {
    expect(hashJson({ z: { a: 1, b: 2 }, a: [1, 2] })).toBe(
      hashJson({ a: [1, 2], z: { b: 2, a: 1 } }),
    );
    const tool = defineTool(definition());
    expect(tool.policyHash).not.toBe(
      defineTool({ ...definition(), revision: "v2" }).policyHash,
    );
    expect(Object.isFrozen(tool)).toBe(true);
  });
  it("forbids write retries, implicit device targets and high-risk preauthorization", () => {
    expect(() => defineTool({ ...definition(), effect: "write" })).toThrow(
      "retried",
    );
    expect(() => defineTool({ ...definition(), resource: "device" })).toThrow(
      "target",
    );
    expect(() => defineTool({ ...definition(), risk: "high" })).toThrow(
      "approval",
    );
  });
});

it("validates explicit failed output while retaining output-free failure compatibility", async () => {
  const tool = defineTool({
    ...definition(),
    execute: async () => ({
      kind: "failed" as const,
      output: { value: "unsupported" },
    }),
  });
  expect(
    await tool.execute(
      { text: "test" },
      {
        tenantId: "tenant",
        executionId: "execution",
        targetDeviceId: null,
        idempotencyKey: "key",
        signal: new AbortController().signal,
      },
    ),
  ).toEqual({ kind: "failed", output: { value: "unsupported" } });
  const legacy = defineTool({
    ...definition(),
    execute: async () => ({ kind: "failed" as const }),
  });
  expect(
    await legacy.execute(
      { text: "test" },
      {
        tenantId: "tenant",
        executionId: "execution",
        targetDeviceId: null,
        idempotencyKey: "key",
        signal: new AbortController().signal,
      },
    ),
  ).toEqual({ kind: "failed" });
});
