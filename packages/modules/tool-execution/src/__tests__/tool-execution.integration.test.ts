import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PrismaService } from "@corely/data";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
  assignOwnerDeviceGrant,
  revokeOwnerDeviceGrant,
} from "@corely/modules-devices";
import {
  IdentityRepository,
  issueAccessToken,
  readAuthConfig,
} from "@corely/modules-identity";
import {
  ConversationRepository,
  transitionToolExecution,
  decideExecutionApproval,
} from "@corely/modules-conversations";
import type { OwnerSession } from "@corely/contracts";
import { ToolExecutionRepository } from "../tool.repository";
import { defineTool, ToolRegistry } from "../tool.registry";
import * as tools from "../tool.use-cases";
import type {
  RegisteredTool,
  ToolContext,
  ToolDependencies,
  ToolOutcome,
} from "../tool.types";

const db = new PrismaService();
const store = new ToolExecutionRepository(db);
const identity = new IdentityRepository(db);
const devices = new DeviceAccessRepository(db);
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  userId = randomUUID();
const authConfig = readAuthConfig({
  NODE_ENV: "development",
  OWNER_EMAIL: `tools-${randomUUID()}@example.test`,
});
let owner: OwnerSession,
  ownerAuth: { kind: "owner"; token: string },
  otherAuth: { kind: "owner"; token: string };
let deviceId: string, deviceAuth: { kind: "device"; token: string };
const activeSessions: string[] = [];
async function ownerToken(tenant = tenantId) {
  const session = await identity.createSession(
    { ...owner, tenantId: tenant },
    randomUUID(),
    new Date(Date.now() + 3600_000),
  );
  activeSessions.push(session.id);
  return {
    kind: "owner" as const,
    token: issueAccessToken(
      { ...owner, tenantId: tenant },
      session.id,
      authConfig.secret,
    ),
  };
}
beforeAll(async () => {
  await db.connect();
  await db.user.create({
    data: {
      id: userId,
      email: authConfig.ownerEmail,
      passwordHash: "",
      name: "Synthetic tool owner",
    },
  });
  for (const tenant of [tenantId, otherTenantId]) {
    await db.tenant.create({
      data: { id: tenant, name: "Tools test", slug: tenant },
    });
    const role = await db.role.create({
      data: {
        tenantId: tenant,
        name: "Owner",
        systemKey: "OWNER",
        scope: "TENANT",
      },
    });
    await db.membership.create({
      data: { userId, tenantId: tenant, roleId: role.id },
    });
  }
  owner = {
    userId,
    tenantId,
    email: authConfig.ownerEmail,
    name: "Synthetic tool owner",
    tenantName: "Tools test",
  };
  ownerAuth = await ownerToken();
  otherAuth = await ownerToken(otherTenantId);
  const paired = await pairOwnerDevice(
    {
      name: "Voice device",
      room: null,
      location: null,
      profileId: "esp32-voice",
      profileVersion: 1,
      capabilities: [
        {
          kind: "microphone",
          format: {
            encoding: "pcm_s16le",
            sampleRateHz: 16000,
            channels: 1,
            chunkDurationMs: 20,
          },
        },
        { kind: "ping" },
      ],
    },
    owner,
    devices,
  );
  deviceId = paired.device.id;
  const voice = paired.credentials.find(
    (credential) => credential.purpose === "voice",
  );
  if (!voice) throw new Error("Missing synthetic voice credential");
  deviceAuth = { kind: "device", token: voice.token };
});
afterAll(async () => {
  const scope = { tenantId: { in: [tenantId, otherTenantId] } };
  await db.toolPreauthorization.deleteMany({ where: scope });
  await db.auditLog.deleteMany({ where: scope });
  await db.toolExecution.deleteMany({ where: scope });
  await db.conversationTurn.deleteMany({ where: scope });
  await db.agentRun.deleteMany({ where: scope });
  await db.device.deleteMany({ where: scope });
  await db.refreshToken.deleteMany({ where: scope });
  await db.membership.deleteMany({ where: scope });
  await db.role.deleteMany({ where: scope });
  await db.tenant.deleteMany({ where: { id: scope.tenantId } });
  await db.user.delete({ where: { id: userId } });
  await db.disconnect();
});
function registered(
  effect: "read" | "write",
  execute: (
    args: { text: string },
    context: ToolContext,
  ) => Promise<ToolOutcome<{ value: string }>>,
  options: {
    revision?: string;
    timeoutMs?: number;
    maxAttempts?: number;
    approval?: "never" | "required";
    reconcile?: (
      args: { text: string },
      context: ToolContext,
    ) => Promise<ToolOutcome<{ value: string }> | { kind: "unknown" }>;
  } = {},
) {
  return defineTool({
    id: `test.${effect}`,
    revision: options.revision ?? "v1",
    effect,
    resource: "tenant",
    risk: "low",
    approval: options.approval ?? "never",
    timeoutMs: options.timeoutMs ?? 100,
    maxAttempts: options.maxAttempts ?? 1,
    input: z.object({ text: z.string().min(1).max(100) }).strict(),
    output: z.object({ value: z.string() }).strict(),
    execute,
    ...(options.reconcile ? { reconcile: options.reconcile } : {}),
  });
}
const success = async () => ({
  kind: "succeeded" as const,
  output: { value: "done" },
});
const dependencies = (
  tool: RegisteredTool,
  repository = store,
): ToolDependencies => ({
  store: repository,
  identity,
  devices,
  auth: authConfig,
  registry: new ToolRegistry([tool]),
});
async function request(
  tool: RegisteredTool,
  fromDevice = false,
  status = "committed",
) {
  const runId = randomUUID(),
    turnId = randomUUID();
  await db.agentRun.create({
    data: {
      id: runId,
      tenantId,
      status: "active",
      deviceId: fromDevice ? deviceId : null,
    },
  });
  await db.conversationTurn.create({
    data: {
      id: turnId,
      tenantId,
      runId,
      sequence: 1,
      source: fromDevice ? "voice" : "text",
      status,
      correlationId: "test",
    },
  });
  return {
    toolCall: {
      version: 1,
      conversationId: runId,
      turnId,
      toolCallId: randomUUID(),
      toolId: tool.id,
      arguments: { text: "safe input" },
    },
    correlationId: "test",
  };
}
async function approve(
  execution: {
    executionId: string;
    approvalId: string | null;
    requestHash: string;
    targetDeviceId: string | null;
  },
  deps: ToolDependencies,
) {
  return tools.decideToolApproval(
    {
      version: 1,
      executionId: execution.executionId,
      approvalId: execution.approvalId,
      decision: "approve",
      requestHash: execution.requestHash,
      targetDeviceId: execution.targetDeviceId,
    },
    ownerAuth,
    deps,
  );
}

describe("authorized durable execution", () => {
  it("validates registration, schemas, authentication, committed turns and grants before any effect", async () => {
    const effect = vi.fn(success),
      tool = registered("read", effect),
      deps = dependencies(tool);
    const input = await request(tool, true);
    await expect(tools.submitToolCall(input, deviceAuth, deps)).rejects.toThrow(
      "grant",
    );
    await expect(
      tools.submitToolCall(
        {
          ...input,
          toolCall: {
            ...input.toolCall,
            arguments: { destination: "unregistered" },
          },
        },
        ownerAuth,
        deps,
      ),
    ).rejects.toThrow();
    await expect(
      tools.submitToolCall(
        { ...input, toolCall: { ...input.toolCall, toolId: "unknown" } },
        ownerAuth,
        deps,
      ),
    ).rejects.toThrow("registered");
    await expect(
      tools.submitToolCall(input, { kind: "owner", token: "forged" }, deps),
    ).rejects.toThrow("authentication");
    await expect(
      tools.submitToolCall(
        await request(tool, false, "collecting"),
        ownerAuth,
        deps,
      ),
    ).rejects.toThrow("committed");
    expect(effect).not.toHaveBeenCalled();
  });
  it("executes an allowed read once under concurrent deliveries and service restart", async () => {
    const effect = vi.fn(success),
      tool = registered("read", effect),
      deps = dependencies(tool),
      input = await request(tool);
    const deliveries = await Promise.all(
      Array.from({ length: 6 }, () =>
        tools.submitToolCall(input, ownerAuth, deps),
      ),
    );
    expect(new Set(deliveries.map((record) => record.executionId)).size).toBe(
      1,
    );
    const id = deliveries[0].executionId;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        tools.dispatchToolExecution(id, ownerAuth, deps),
      ),
    );
    expect(effect).toHaveBeenCalledTimes(1);
    const restarted = dependencies(tool, new ToolExecutionRepository(db));
    expect(
      (await tools.dispatchToolExecution(id, ownerAuth, restarted)).status,
    ).toBe("succeeded");
    expect(
      (await tools.submitToolCall(input, ownerAuth, restarted)).executionId,
    ).toBe(id);
    expect(effect).toHaveBeenCalledTimes(1);
    await db.conversationTurn.update({
      where: {
        tenantId_runId_id: {
          tenantId,
          runId: input.toolCall.conversationId,
          id: input.toolCall.turnId,
        },
      },
      data: { status: "completed" },
    });
    expect(
      (await tools.submitToolCall(input, ownerAuth, restarted)).status,
    ).toBe("succeeded");
    await expect(tools.getToolExecution(id, otherAuth, deps)).rejects.toThrow(
      "not found",
    );
  });
  it("requires explicit low-risk owner preauthorization and rechecks its revocation", async () => {
    const effect = vi.fn(success),
      tool = registered("write", effect),
      deps = dependencies(tool);
    const consent = await tools.preauthorizeTool(
      {
        toolId: tool.id,
        sourceDeviceId: null,
        targetDeviceId: null,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      ownerAuth,
      deps,
    );
    const queued = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    expect(queued.status).toBe("queued");
    expect(
      (await tools.dispatchToolExecution(queued.executionId, ownerAuth, deps))
        .status,
    ).toBe("succeeded");
    const denied = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    await tools.revokeToolPreauthorization(consent.id, otherAuth, deps);
    expect(
      await store.preauthorization(
        tenantId,
        userId,
        tool.id,
        tool.policyHash,
        "[null,null]",
        new Date(),
      ),
    ).toBe(true);
    await tools.revokeToolPreauthorization(consent.id, ownerAuth, deps);
    expect(
      (await tools.dispatchToolExecution(denied.executionId, ownerAuth, deps))
        .status,
    ).toBe("failed");
    expect(effect).toHaveBeenCalledTimes(1);
    expect(
      (await tools.submitToolCall(await request(tool), ownerAuth, deps)).status,
    ).toBe("awaiting_approval");
  });
  it("binds approval to exact arguments, hash, target and tenant and decides once", async () => {
    const effect = vi.fn(success),
      tool = registered("write", effect, { approval: "required" }),
      deps = dependencies(tool),
      input = await request(tool);
    const pending = await tools.submitToolCall(input, ownerAuth, deps);
    expect(pending.status).toBe("awaiting_approval");
    expect(
      (await tools.dispatchToolExecution(pending.executionId, ownerAuth, deps))
        .status,
    ).toBe("awaiting_approval");
    await expect(
      tools.submitToolCall(
        {
          ...input,
          toolCall: { ...input.toolCall, arguments: { text: "substituted" } },
        },
        ownerAuth,
        deps,
      ),
    ).rejects.toThrow("identity conflict");
    const decision = {
      version: 1,
      executionId: pending.executionId,
      approvalId: pending.approvalId,
      decision: "approve",
      requestHash: pending.requestHash,
      targetDeviceId: null,
    };
    await expect(
      tools.decideToolApproval(decision, otherAuth, deps),
    ).rejects.toThrow("not found");
    await expect(
      tools.decideToolApproval(
        { ...decision, requestHash: "0".repeat(64) },
        ownerAuth,
        deps,
      ),
    ).rejects.toThrow("identity");
    await expect(
      tools.decideToolApproval(
        { ...decision, targetDeviceId: deviceId },
        ownerAuth,
        deps,
      ),
    ).rejects.toThrow("identity");
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        tools.decideToolApproval(decision, ownerAuth, deps),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await tools.dispatchToolExecution(pending.executionId, ownerAuth, deps);
    expect(effect).toHaveBeenCalledTimes(1);
    await expect(
      tools.decideToolApproval(decision, ownerAuth, deps),
    ).rejects.toThrow();
  });
  it("blocks the older persistence-only transition and approval paths", async () => {
    const tool = registered("write", success),
      deps = dependencies(tool),
      input = await request(tool),
      pending = await tools.submitToolCall(input, ownerAuth, deps);
    const oldRepository = new ConversationRepository(db);
    await expect(
      decideExecutionApproval(
        {
          version: 1,
          approvalId: pending.approvalId,
          executionId: pending.executionId,
          decision: "approve",
        },
        owner,
        oldRepository,
      ),
    ).rejects.toThrow();
    await approve(pending, deps);
    await expect(
      transitionToolExecution(
        {
          from: "queued",
          execution: {
            version: 1,
            executionId: pending.executionId,
            toolCallId: input.toolCall.toolCallId,
            updatedAt: new Date().toISOString(),
            status: "running",
          },
        },
        owner,
        oldRepository,
      ),
    ).rejects.toThrow();
  });
  it("rejects expired/cancelled session approvals and registry policy changes", async () => {
    const effect = vi.fn(success),
      tool = registered("write", effect),
      deps = dependencies(tool),
      input = await request(tool),
      pending = await tools.submitToolCall(input, ownerAuth, deps);
    await db.conversationTurn.update({
      where: {
        tenantId_runId_id: {
          tenantId,
          runId: input.toolCall.conversationId,
          id: input.toolCall.turnId,
        },
      },
      data: { status: "cancelled" },
    });
    await expect(approve(pending, deps)).rejects.toThrow("committed");
    const second = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    await db.toolExecution.update({
      where: { tenantId_id: { tenantId, id: second.executionId } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await approve(second, deps)).status).toBe("expired");
    const third = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    const changed = dependencies(
      registered("write", effect, { revision: "v2" }),
    );
    await expect(approve(third, changed)).rejects.toThrow("policy");
    expect(effect).not.toHaveBeenCalled();
  });
  it("rechecks live device grants at dispatch and never treats approval as a grant", async () => {
    const effect = vi.fn(success),
      tool = registered("read", effect),
      deps = dependencies(tool);
    await assignOwnerDeviceGrant(
      deviceId,
      {
        toolId: tool.id,
        targetDeviceIds: [],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      owner,
      devices,
    );
    const input = await request(tool, true),
      execution = await tools.submitToolCall(input, deviceAuth, deps);
    await revokeOwnerDeviceGrant(deviceId, tool.id, owner, devices);
    expect(
      (
        await tools.dispatchToolExecution(
          execution.executionId,
          deviceAuth,
          deps,
        )
      ).status,
    ).toBe("failed");
    expect(effect).not.toHaveBeenCalled();
    const otherRun = await request(tool);
    await assignOwnerDeviceGrant(
      deviceId,
      {
        toolId: tool.id,
        targetDeviceIds: [],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      owner,
      devices,
    );
    await expect(
      tools.submitToolCall(otherRun, deviceAuth, deps),
    ).rejects.toThrow("committed");
  });
  it("persists rejected approvals and cancellation without performing effects", async () => {
    const effect = vi.fn(success),
      tool = registered("write", effect),
      deps = dependencies(tool),
      pending = await tools.submitToolCall(
        await request(tool),
        ownerAuth,
        deps,
      );
    const rejected = await tools.decideToolApproval(
      {
        version: 1,
        executionId: pending.executionId,
        approvalId: pending.approvalId,
        decision: "reject",
        requestHash: pending.requestHash,
        targetDeviceId: null,
      },
      ownerAuth,
      deps,
    );
    expect(rejected.status).toBe("cancelled");
    await tools.dispatchToolExecution(pending.executionId, ownerAuth, deps);
    const cancelled = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    expect(
      (await tools.cancelToolExecution(cancelled.executionId, ownerAuth, deps))
        .status,
    ).toBe("cancelled");
    await expect(approve(cancelled, deps)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
  });
  it("keeps timeout-after-remote-acceptance unknown and reconciles without repeating the write", async () => {
    const remote = new Map<string, { value: string }>();
    const effect = vi.fn(
      async (
        _args: { text: string },
        context: ToolContext,
      ): Promise<ToolOutcome<{ value: string }>> => {
        remote.set(context.idempotencyKey, { value: "remote accepted" });
        return new Promise(() => {});
      },
    );
    const tool = registered("write", effect, {
        timeoutMs: 20,
        reconcile: async (_args, context) => {
          const output = remote.get(context.idempotencyKey);
          return output ? { kind: "succeeded", output } : { kind: "unknown" };
        },
      }),
      deps = dependencies(tool);
    const pending = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    await approve(pending, deps);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        tools.dispatchToolExecution(pending.executionId, ownerAuth, deps),
      ),
    );
    expect(
      (await tools.getToolExecution(pending.executionId, ownerAuth, deps))
        .status,
    ).toBe("unknown");
    const restarted = dependencies(tool, new ToolExecutionRepository(db));
    expect(
      (
        await tools.dispatchToolExecution(
          pending.executionId,
          ownerAuth,
          restarted,
        )
      ).status,
    ).toBe("unknown");
    const reconciled = await tools.reconcileToolExecution(
      pending.executionId,
      ownerAuth,
      restarted,
    );
    expect(reconciled.status).toBe("succeeded");
    expect(reconciled.output).toEqual({ value: "remote accepted" });
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it("recovers abandoned running work conservatively after a restart", async () => {
    const effect = vi.fn(success),
      tool = registered("write", effect),
      deps = dependencies(tool),
      pending = await tools.submitToolCall(
        await request(tool),
        ownerAuth,
        deps,
      );
    await approve(pending, deps);
    await db.toolExecution.update({
      where: { tenantId_id: { tenantId, id: pending.executionId } },
      data: {
        status: "running",
        dispatchDeadline: new Date(Date.now() - 1000),
      },
    });
    expect(
      (
        await tools.reconcileToolExecution(
          pending.executionId,
          ownerAuth,
          dependencies(tool, new ToolExecutionRepository(db)),
        )
      ).status,
    ).toBe("unknown");
    await tools.dispatchToolExecution(pending.executionId, ownerAuth, deps);
    expect(effect).not.toHaveBeenCalled();
  });
  it("persists partial success and retries only registered reads", async () => {
    const partial = registered("write", async () => ({
        kind: "partial",
        output: { value: "one of two actions completed" },
      })),
      deps = dependencies(partial),
      pending = await tools.submitToolCall(
        await request(partial),
        ownerAuth,
        deps,
      );
    await approve(pending, deps);
    const result = await tools.dispatchToolExecution(
      pending.executionId,
      ownerAuth,
      deps,
    );
    expect(result.status).toBe("failed");
    expect(result.outcome).toBe("partial");
    expect(result.output).toEqual({ value: "one of two actions completed" });
    let calls = 0;
    const read = registered(
      "read",
      async () => {
        if (++calls === 1) throw new Error("Synthetic read failure");
        return success();
      },
      { maxAttempts: 2 },
    );
    const readDeps = dependencies(read),
      queued = await tools.submitToolCall(
        await request(read),
        ownerAuth,
        readDeps,
      );
    expect(
      (
        await tools.dispatchToolExecution(
          queued.executionId,
          ownerAuth,
          readDeps,
        )
      ).status,
    ).toBe("succeeded");
    expect(calls).toBe(2);
  });
  it("requires current device grants even after owner approval", async () => {
    const effect = vi.fn(success),
      tool = registered("write", effect, { approval: "required" }),
      deps = dependencies(tool);
    await assignOwnerDeviceGrant(
      deviceId,
      {
        toolId: tool.id,
        targetDeviceIds: [],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      owner,
      devices,
    );
    const pending = await tools.submitToolCall(
      await request(tool, true),
      deviceAuth,
      deps,
    );
    await approve(pending, deps);
    await revokeOwnerDeviceGrant(deviceId, tool.id, owner, devices);
    expect(
      (await tools.dispatchToolExecution(pending.executionId, ownerAuth, deps))
        .status,
    ).toBe("failed");
    expect(effect).not.toHaveBeenCalled();
  });
  it("binds device preauthorization to the exact target and retains no authentication secrets", async () => {
    const paired = await pairOwnerDevice(
      {
        name: "Target",
        room: null,
        location: null,
        profileId: "weather-station",
        profileVersion: 1,
        capabilities: [
          { kind: "ping" },
          { kind: "temperature" },
          { kind: "humidity" },
        ],
      },
      owner,
      devices,
    );
    const targetId = paired.device.id;
    const effect = vi.fn(async () => ({
      kind: "succeeded" as const,
      output: { value: "targeted" },
    }));
    const tool = defineTool({
        id: "test.target",
        revision: "v1",
        effect: "write",
        resource: "device",
        risk: "low",
        approval: "never",
        timeoutMs: 1000,
        maxAttempts: 1,
        input: z.object({ targetDeviceId: z.string() }).strict(),
        output: z.object({ value: z.string() }).strict(),
        target: (args) => args.targetDeviceId,
        execute: effect,
      }),
      deps = dependencies(tool);
    await assignOwnerDeviceGrant(
      deviceId,
      {
        toolId: tool.id,
        targetDeviceIds: [targetId],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      owner,
      devices,
    );
    const input = await request(tool, true);
    const call = {
      ...input,
      toolCall: { ...input.toolCall, arguments: { targetDeviceId: targetId } },
    };
    await expect(
      tools.submitToolCall(
        {
          ...call,
          toolCall: {
            ...call.toolCall,
            arguments: { targetDeviceId: deviceId },
          },
        },
        deviceAuth,
        deps,
      ),
    ).rejects.toThrow("not granted");
    await tools.preauthorizeTool(
      {
        toolId: tool.id,
        sourceDeviceId: deviceId,
        targetDeviceId: targetId,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      ownerAuth,
      deps,
    );
    const queued = await tools.submitToolCall(call, deviceAuth, deps);
    expect(queued.status).toBe("queued");
    expect(queued.targetDeviceId).toBe(targetId);
    expect(
      (await tools.dispatchToolExecution(queued.executionId, deviceAuth, deps))
        .status,
    ).toBe("succeeded");
    const stored = await store.get(tenantId, queued.executionId);
    expect(stored?.actorJson).not.toContain(deviceAuth.token);
    expect(stored?.actorJson).not.toContain(ownerAuth.token);
    const ownerInput = await request(tool);
    expect(
      (
        await tools.submitToolCall(
          {
            ...ownerInput,
            toolCall: {
              ...ownerInput.toolCall,
              arguments: { targetDeviceId: targetId },
            },
          },
          ownerAuth,
          deps,
        )
      ).status,
    ).toBe("awaiting_approval");
    await expect(
      tools.preauthorizeTool(
        {
          toolId: tool.id,
          sourceDeviceId: deviceId,
          targetDeviceId: targetId,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        otherAuth,
        deps,
      ),
    ).rejects.toThrow("not found");
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it("keeps a write cancelled during dispatch unknown even if the callback completes later", async () => {
    let started = () => {};
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const effect = vi.fn(async () => {
      started();
      await gate;
      return success();
    });
    const tool = registered("write", effect, { timeoutMs: 1000 }),
      deps = dependencies(tool);
    const pending = await tools.submitToolCall(
      await request(tool),
      ownerAuth,
      deps,
    );
    await approve(pending, deps);
    const running = tools.dispatchToolExecution(
      pending.executionId,
      ownerAuth,
      deps,
    );
    await startedPromise;
    expect(
      (await tools.cancelToolExecution(pending.executionId, ownerAuth, deps))
        .status,
    ).toBe("unknown");
    release();
    expect((await running).status).toBe("unknown");
    await tools.dispatchToolExecution(pending.executionId, ownerAuth, deps);
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch an already cancelled request and treats invalid write output as unknown", async () => {
    const effect = vi.fn(success),
      read = registered("read", effect),
      deps = dependencies(read);
    const queued = await tools.submitToolCall(
      await request(read),
      ownerAuth,
      deps,
    );
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await tools.dispatchToolExecution(
          queued.executionId,
          ownerAuth,
          deps,
          controller.signal,
        )
      ).status,
    ).toBe("cancelled");
    expect(effect).not.toHaveBeenCalled();
    const invalid = defineTool({
        id: "test.output",
        revision: "v1",
        effect: "write",
        resource: "tenant",
        risk: "low",
        approval: "required",
        timeoutMs: 100,
        maxAttempts: 1,
        input: z.object({ text: z.string() }).strict(),
        output: z.object({ value: z.string().regex(/^validated:/) }).strict(),
        execute: success,
      }),
      writeDeps = dependencies(invalid);
    const pending = await tools.submitToolCall(
      await request(invalid),
      ownerAuth,
      writeDeps,
    );
    await approve(pending, writeDeps);
    const result = await tools.dispatchToolExecution(
      pending.executionId,
      ownerAuth,
      writeDeps,
    );
    expect(result.status).toBe("unknown");
    expect(result.output).toBeNull();
  });
  it("revalidates the originating owner session before approval", async () => {
    const sourceAuth = await ownerToken(),
      tool = registered("write", success),
      deps = dependencies(tool),
      pending = await tools.submitToolCall(
        await request(tool),
        sourceAuth,
        deps,
      );
    const id = activeSessions.at(-1);
    if (!id) throw new Error("Missing test session");
    await db.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await expect(approve(pending, deps)).rejects.toThrow("session");
  });
});
