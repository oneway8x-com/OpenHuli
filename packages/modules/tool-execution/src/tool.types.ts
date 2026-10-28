import type { z } from "zod";
import type {
  OpenHuliJsonObjectSchema,
  OpenHuliExecutionStatus,
} from "@corely/contracts";
import type { DeviceSession, DeviceAccessStore } from "@corely/modules-devices";
import type { AuthConfig, IdentityStore } from "@corely/modules-identity";
import type { ToolExecutionRepository } from "./tool.repository";
import type { ToolRegistry } from "./tool.registry";

export type JsonObject = z.infer<typeof OpenHuliJsonObjectSchema>;
export type Actor =
  | {
      kind: "owner";
      tenantId: string;
      userId: string;
      sessionId: string;
      accessExpiresAt: number;
    }
  | ({ kind: "device" } & DeviceSession);
/** verified-device is an internal server composition input, never a wire authentication payload. */
export type ToolAuthentication =
  | { kind: "owner" | "device"; token: string }
  | {
      kind: "verified-device";
      session: DeviceSession;
    };
export interface ToolContext {
  tenantId: string;
  executionId: string;
  targetDeviceId: string | null;
  idempotencyKey: string;
  signal: AbortSignal;
}
export type ToolOutcome<T extends JsonObject = JsonObject> =
  | { kind: "succeeded" | "partial"; output: T }
  | { kind: "failed" };
export type ReconciliationOutcome = ToolOutcome | { kind: "unknown" };
export interface RegisteredTool {
  readonly id: string;
  readonly revision: string;
  readonly effect: "read" | "write";
  readonly resource: "tenant" | "device";
  readonly risk: "low" | "high";
  readonly approval: "never" | "required";
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly policyHash: string;
  parse(value: unknown): JsonObject;
  target(value: JsonObject): string | null;
  execute(value: JsonObject, context: ToolContext): Promise<ToolOutcome>;
  reconcile?: (
    value: JsonObject,
    context: ToolContext,
  ) => Promise<ReconciliationOutcome>;
}
export interface ExecutionRecord {
  id: string;
  tenantId: string;
  runId: string;
  turnId: string | null;
  toolCallId: string;
  toolName: string;
  inputJson: string;
  outputJson: string | null;
  errorJson: string | null;
  status: string;
  effect: string | null;
  requestHash: string | null;
  policyHash: string | null;
  actorJson: string | null;
  targetDeviceId: string | null;
  expiresAt: Date | null;
  dispatchDeadline: Date | null;
  outcomeKind: string | null;
  attempts: number;
  approval: {
    id: string;
    requestHash: string | null;
    argumentsJson: string;
    status: string;
    expiresAt: Date;
    decidedByUserId: string | null;
  } | null;
}
export interface ExecutionView {
  executionId: string;
  toolId: string;
  conversationId: string;
  turnId: string;
  arguments: JsonObject;
  expiresAt: string;
  toolCallId: string;
  status: OpenHuliExecutionStatus;
  outcome: "succeeded" | "partial" | "failed" | null;
  output: JsonObject | null;
  error: string | null;
  approvalId: string | null;
  requestHash: string;
  targetDeviceId: string | null;
}
export type ToolStore = Pick<
  ToolExecutionRepository,
  | "context"
  | "reserve"
  | "findByCall"
  | "get"
  | "begin"
  | "finish"
  | "decide"
  | "cancel"
  | "preauthorize"
  | "revokePreauthorization"
  | "preauthorization"
  | "markAbandoned"
  | "claimReconciliation"
  | "finishReconciliation"
>;
export interface ToolDependencies {
  store: ToolStore;
  devices: DeviceAccessStore;
  identity: IdentityStore;
  auth: AuthConfig;
  registry: ToolRegistry;
}
