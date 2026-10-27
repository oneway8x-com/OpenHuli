import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  OpenHuliApprovalDecisionSchema,
  OpenHuliExecutionStatusSchema,
  OpenHuliIdSchema,
  OpenHuliJsonObjectSchema,
  OpenHuliToolCallSchema,
} from "@corely/contracts";
import {
  authenticate,
  authorizeScope,
  hasPreauthorization,
  requireContext,
  requireVisibility,
  scopeKey,
} from "./tool.auth";
import { canonicalJson, hashJson } from "./tool.registry";
import type {
  Actor,
  ExecutionRecord,
  ExecutionView,
  JsonObject,
  RegisteredTool,
  ToolAuthentication,
  ToolContext,
  ToolDependencies,
} from "./tool.types";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
function requestHash(
  actor: Actor,
  runId: string,
  turnId: string,
  toolCallId: string,
  tool: RegisteredTool,
  args: JsonObject,
  target: string | null,
) {
  return hashJson({
    actor,
    runId,
    turnId,
    toolCallId,
    toolId: tool.id,
    policyHash: tool.policyHash,
    arguments: args,
    target,
  });
}
function view(record: ExecutionRecord): ExecutionView {
  return {
    executionId: record.id,
    toolId: record.toolName,
    conversationId: record.runId,
    turnId: OpenHuliIdSchema.parse(record.turnId),
    arguments: OpenHuliJsonObjectSchema.parse(JSON.parse(record.inputJson)),
    expiresAt: z.date().parse(record.expiresAt).toISOString(),
    toolCallId: record.toolCallId,
    status: OpenHuliExecutionStatusSchema.parse(record.status),
    outcome: z
      .enum(["succeeded", "partial", "failed"])
      .nullable()
      .parse(record.outcomeKind),
    output:
      record.outputJson === null
        ? null
        : OpenHuliJsonObjectSchema.parse(JSON.parse(record.outputJson)),
    error: record.errorJson,
    approvalId: record.approval?.id ?? null,
    requestHash: digest.parse(record.requestHash),
    targetDeviceId: record.targetDeviceId,
  };
}
async function load(
  id: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
) {
  const actor = await authenticate(auth, deps);
  const record = await deps.store.get(
    actor.tenantId,
    OpenHuliIdSchema.parse(id),
  );
  if (!record) throw new Error("Execution not found");
  const source = requireVisibility(actor, record);
  return { actor, source, record };
}
async function current(record: ExecutionRecord, deps: ToolDependencies) {
  const result = await deps.store.get(record.tenantId, record.id);
  if (!result) throw new Error("Execution not found");
  return view(result);
}
function registered(
  record: ExecutionRecord,
  source: Actor,
  deps: ToolDependencies,
) {
  const tool = deps.registry.get(record.toolName);
  const args = tool.parse(JSON.parse(record.inputJson));
  const target = tool.target(args);
  if (
    !record.turnId ||
    tool.policyHash !== record.policyHash ||
    target !== record.targetDeviceId ||
    requestHash(
      source,
      record.runId,
      record.turnId,
      record.toolCallId,
      tool,
      args,
      target,
    ) !== record.requestHash
  )
    throw new Error("Registered policy or exact arguments changed");
  return { tool, args, target };
}
async function authorizeDispatch(
  record: ExecutionRecord,
  source: Actor,
  deps: ToolDependencies,
) {
  const registeredTool = registered(record, source, deps);
  await requireContext(
    source,
    record.runId,
    OpenHuliIdSchema.parse(record.turnId),
    deps,
  );
  await authorizeScope(
    source,
    registeredTool.tool,
    registeredTool.target,
    deps,
  );
  return registeredTool;
}
async function expire(record: ExecutionRecord, deps: ToolDependencies) {
  if (!record.expiresAt || record.expiresAt <= new Date()) {
    if (["queued", "awaiting_approval"].includes(record.status))
      await deps.store.finish(
        record,
        "expired",
        "Execution expired before dispatch",
        record.attempts,
        undefined,
        record.status,
      );
    return true;
  }
  return false;
}
export async function submitToolCall(
  input: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
): Promise<ExecutionView> {
  const parsed = z
    .object({
      toolCall: OpenHuliToolCallSchema,
      correlationId: OpenHuliIdSchema,
    })
    .strict()
    .parse(input);
  const actor = await authenticate(auth, deps);
  const tool = deps.registry.get(parsed.toolCall.toolId);
  const args = tool.parse(parsed.toolCall.arguments);
  const target = tool.target(args);
  await authorizeScope(actor, tool, target, deps);
  const identityHash = requestHash(
    actor,
    parsed.toolCall.conversationId,
    parsed.toolCall.turnId,
    parsed.toolCall.toolCallId,
    tool,
    args,
    target,
  );
  const existing = await deps.store.findByCall(
    actor.tenantId,
    parsed.toolCall.conversationId,
    parsed.toolCall.toolCallId,
  );
  if (existing) {
    if (existing.requestHash !== identityHash)
      throw new Error("Tool-call identity conflict");
    return view(existing);
  }
  const context = await requireContext(
    actor,
    parsed.toolCall.conversationId,
    parsed.toolCall.turnId,
    deps,
  );
  await authorizeScope(actor, tool, target, deps);
  const needsApproval =
    tool.approval === "required" ||
    (tool.effect === "write" &&
      !(await hasPreauthorization(actor, tool, target, deps)));
  const record = await deps.store.reserve({
    tenantId: actor.tenantId,
    runId: parsed.toolCall.conversationId,
    turnId: parsed.toolCall.turnId,
    toolCallId: parsed.toolCall.toolCallId,
    toolName: tool.id,
    inputJson: canonicalJson(args),
    requestHash: identityHash,
    policyHash: tool.policyHash,
    actor,
    targetDeviceId: target,
    correlationId: parsed.correlationId,
    expiresAt: new Date(
      Math.min(Date.now() + 300_000, context.expiresAt?.getTime() ?? Infinity),
    ),
    needsApproval,
    effect: tool.effect,
  });
  return view(record);
}
export async function getToolExecution(
  id: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
) {
  return view((await load(id, auth, deps)).record);
}
export async function decideToolApproval(
  input: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
) {
  const parsed = OpenHuliApprovalDecisionSchema.extend({
    requestHash: digest,
    targetDeviceId: OpenHuliIdSchema.nullable(),
  }).parse(input);
  const { actor, source, record } = await load(parsed.executionId, auth, deps);
  if (actor.kind !== "owner") throw new Error("Owner approval required");
  if (
    record.requestHash !== parsed.requestHash ||
    record.targetDeviceId !== parsed.targetDeviceId ||
    record.approval?.id !== parsed.approvalId
  )
    throw new Error("Approval identity does not match");
  if (await expire(record, deps)) return current(record, deps);
  if (parsed.decision === "approve")
    await authorizeDispatch(record, source, deps);
  await deps.store.decide(
    record,
    parsed.approvalId,
    actor.userId,
    parsed.decision,
    new Date(),
  );
  return current(record, deps);
}
export async function preauthorizeTool(
  input: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
) {
  const parsed = z
    .object({
      toolId: OpenHuliIdSchema,
      sourceDeviceId: OpenHuliIdSchema.nullable(),
      targetDeviceId: OpenHuliIdSchema.nullable(),
      expiresAt: z.string().datetime({ offset: true }),
    })
    .strict()
    .parse(input);
  const actor = await authenticate(auth, deps);
  if (actor.kind !== "owner")
    throw new Error("Owner preauthorization required");
  const tool = deps.registry.get(parsed.toolId);
  if (
    tool.effect !== "write" ||
    tool.risk !== "low" ||
    tool.approval !== "never"
  )
    throw new Error("This tool requires per-execution approval");
  if ((tool.resource === "device") !== (parsed.targetDeviceId !== null))
    throw new Error("Resource scope does not match");
  const expiresAt = new Date(parsed.expiresAt);
  if (
    expiresAt <= new Date() ||
    expiresAt.getTime() > Date.now() + 30 * 24 * 3600_000
  )
    throw new Error("Preauthorization expiry must be within 30 days");
  for (const id of [parsed.sourceDeviceId, parsed.targetDeviceId]) {
    if (id !== null) {
      const device = await deps.devices.findDevice(actor.tenantId, id);
      if (!device || device.status !== "active")
        throw new Error("Device not found");
    }
  }
  const consent = await deps.store.preauthorize({
    tenantId: actor.tenantId,
    ownerUserId: actor.userId,
    toolId: tool.id,
    policyHash: tool.policyHash,
    scopeKey: scopeKey(parsed.sourceDeviceId, parsed.targetDeviceId),
    sourceDeviceId: parsed.sourceDeviceId,
    targetDeviceId: parsed.targetDeviceId,
    expiresAt,
  });
  return { id: consent.id, expiresAt: consent.expiresAt };
}
export async function revokeToolPreauthorization(
  id: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
) {
  const actor = await authenticate(auth, deps);
  if (actor.kind !== "owner")
    throw new Error("Owner preauthorization required");
  await deps.store.revokePreauthorization(
    actor.tenantId,
    actor.userId,
    OpenHuliIdSchema.parse(id),
  );
}
class Interrupted extends Error {
  constructor(readonly kind: "cancelled" | "timeout") {
    super(kind);
  }
}
async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const interrupt = new Promise<never>((_, reject) => {
    abort = () => {
      controller.abort();
      reject(new Interrupted("cancelled"));
    };
    timer = setTimeout(() => {
      controller.abort();
      reject(new Interrupted("timeout"));
    }, milliseconds);
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) abort();
  });
  try {
    return await Promise.race([
      interrupt,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Interrupted("cancelled");
        return work(controller.signal);
      }),
    ]);
  } finally {
    controller.abort();
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}
const executorContext = (
  record: ExecutionRecord,
  signal: AbortSignal,
): ToolContext => ({
  tenantId: record.tenantId,
  executionId: record.id,
  targetDeviceId: record.targetDeviceId,
  idempotencyKey: `openhuli:${record.tenantId}:${record.id}`,
  signal,
});
async function consent(
  record: ExecutionRecord,
  source: Actor,
  tool: RegisteredTool,
  deps: ToolDependencies,
) {
  if (record.approval) {
    const approval = record.approval;
    const owner = await deps.identity.findOwner(
      deps.auth.ownerEmail,
      record.tenantId,
    );
    if (
      approval.status !== "approved" ||
      approval.expiresAt <= new Date() ||
      approval.requestHash !== record.requestHash ||
      approval.argumentsJson !== record.inputJson ||
      !owner ||
      owner.userId !== approval.decidedByUserId
    )
      throw new Error("Current exact owner approval required");
  } else if (
    tool.approval === "required" ||
    (tool.effect === "write" &&
      !(await hasPreauthorization(source, tool, record.targetDeviceId, deps)))
  )
    throw new Error("Owner preauthorization is no longer current");
}
export async function dispatchToolExecution(
  id: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
  signal?: AbortSignal,
): Promise<ExecutionView> {
  const { source, record } = await load(id, auth, deps);
  if (await expire(record, deps)) return current(record, deps);
  if (record.status !== "queued") return view(record);
  if (signal?.aborted) {
    await deps.store.cancel(record, "cancelled");
    return current(record, deps);
  }
  let tool: RegisteredTool, args: JsonObject;
  try {
    ({ tool, args } = await authorizeDispatch(record, source, deps));
    await consent(record, source, tool, deps);
  } catch {
    await deps.store.finish(
      record,
      "failed",
      "Authorization, session, or registered policy changed before dispatch",
      0,
      undefined,
      "queued",
    );
    return current(record, deps);
  }
  const deadline = new Date(
    Date.now() + tool.timeoutMs * tool.maxAttempts + 5000,
  );
  if (!(await deps.store.begin(record, deadline))) return current(record, deps);
  for (let attempt = 1; ; attempt++) {
    let dispatched = false;
    try {
      // Also recheck grants before a read retry. Writes have exactly one dispatch attempt.
      await authorizeDispatch(record, source, deps);
      await consent(record, source, tool, deps);
      if ((record.expiresAt?.getTime() ?? 0) <= Date.now())
        throw new Interrupted("timeout");
      const outcome = await bounded(
        (attemptSignal) => {
          dispatched = true;
          return tool.execute(args, executorContext(record, attemptSignal));
        },
        Math.min(
          tool.timeoutMs,
          Math.max(1, (record.expiresAt?.getTime() ?? Date.now()) - Date.now()),
        ),
        signal,
      );
      await deps.store.finish(
        record,
        outcome.kind === "succeeded" ? "succeeded" : "failed",
        outcome.kind === "partial"
          ? "Partially completed"
          : outcome.kind === "failed"
            ? "Executor confirmed failure"
            : null,
        attempt,
        outcome,
      );
      return current(record, deps);
    } catch (error) {
      const cancelled =
        signal?.aborted ||
        (error instanceof Interrupted && error.kind === "cancelled");
      if (
        tool.effect === "read" &&
        !cancelled &&
        attempt < tool.maxAttempts &&
        (record.expiresAt?.getTime() ?? 0) > Date.now()
      )
        continue;
      const status =
        tool.effect === "write" && dispatched
          ? "unknown"
          : cancelled
            ? "cancelled"
            : (record.expiresAt?.getTime() ?? 0) <= Date.now()
              ? "expired"
              : "failed";
      await deps.store.finish(
        record,
        status,
        status === "unknown"
          ? "Write outcome is unknown; reconcile before taking further action"
          : cancelled
            ? "Execution cancelled"
            : "Read execution failed",
        attempt,
      );
      return current(record, deps);
    }
  }
}
export async function cancelToolExecution(
  id: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
) {
  const { record } = await load(id, auth, deps);
  await deps.store.cancel(
    record,
    record.effect === "write" ? "unknown" : "cancelled",
  );
  return current(record, deps);
}
export async function reconcileToolExecution(
  id: unknown,
  auth: ToolAuthentication,
  deps: ToolDependencies,
): Promise<ExecutionView> {
  const { source, actor, record } = await load(id, auth, deps);
  const { tool, args, target } = registered(record, source, deps);
  // Current requester authorizes this read; original sessions may have expired after a write.
  await authorizeScope(actor, tool, target, deps);
  await deps.store.markAbandoned(record, new Date());
  const stored = await deps.store.get(record.tenantId, record.id);
  if (!stored || stored.status !== "unknown" || !tool.reconcile)
    return current(record, deps);
  const token = randomUUID();
  if (
    !(await deps.store.claimReconciliation(
      stored,
      token,
      new Date(Date.now() + tool.timeoutMs + 1000),
    ))
  )
    return current(record, deps);
  try {
    const result = await bounded(
      (signal) =>
        tool.reconcile
          ? tool.reconcile(args, executorContext(stored, signal))
          : Promise.resolve({ kind: "unknown" as const }),
      tool.timeoutMs,
    );
    await deps.store.finishReconciliation(
      stored,
      token,
      result.kind === "unknown" ? null : result,
    );
  } catch {
    await deps.store.finishReconciliation(stored, token, null);
  }
  return current(record, deps);
}
