import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaService } from "@corely/data";
import {
  OPENHULI_PCM_FORMAT,
  type DeviceCommand,
  type DeviceCommandResult,
} from "@corely/contracts";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
  deviceMqttIdentity,
  assignOwnerDeviceGrant,
} from "@corely/modules-devices";
import {
  IdentityRepository,
  readAuthConfig,
  issueAccessToken,
} from "@corely/modules-identity";
import {
  TelemetryRepository,
  ingestBrokerMessage,
} from "@corely/modules-telemetry";
import {
  ToolExecutionRepository,
  ToolRegistry,
  submitToolCall,
  dispatchToolExecution,
  preauthorizeTool,
  reconcileToolExecution,
  type ToolAuthentication,
} from "@corely/modules-tool-execution";
import { DeviceCommandRepository } from "../device-command.repository";
import { createDeviceCommandTools } from "../device-command.tools";
import {
  dispatchDeviceCommand,
  getCommandOutcome,
  ingestDeviceCommandResult,
} from "../device-command.use-cases";
import type { DeviceCommandDependencies } from "../device-command.types";
const db = new PrismaService(),
  devices = new DeviceAccessRepository(db),
  identity = new IdentityRepository(db);
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  userId = randomUUID();
const auth = readAuthConfig({
  NODE_ENV: "development",
  OWNER_EMAIL: `commands-${randomUUID()}@example.test`,
});
let ownerAuth: ToolAuthentication;
let source: Awaited<ReturnType<typeof pairOwnerDevice>>;
beforeAll(async () => {
  await db.user.create({
    data: {
      id: userId,
      email: auth.ownerEmail,
      passwordHash: "",
      name: "Synthetic commands owner",
    },
  });
  for (const id of [tenantId, otherTenantId]) {
    await db.tenant.create({
      data: { id, slug: id, name: "Synthetic commands" },
    });
    const role = await db.role.create({
      data: {
        tenantId: id,
        name: "Owner",
        systemKey: "OWNER",
        scope: "TENANT",
      },
    });
    await db.membership.create({
      data: { tenantId: id, userId, roleId: role.id },
    });
  }
  const owner = {
    tenantId,
    userId,
    email: auth.ownerEmail,
    name: "Test",
    tenantName: "Test",
  };
  const session = await identity.createSession(
    owner,
    randomUUID(),
    new Date(Date.now() + 3600000),
  );
  ownerAuth = {
    kind: "owner",
    token: issueAccessToken(owner, session.id, auth.secret),
  };
  source = await pairOwnerDevice(
    {
      name: "Source microphone",
      profileId: "esp32-voice",
      profileVersion: 1,
      capabilities: [
        { kind: "microphone", format: OPENHULI_PCM_FORMAT },
        { kind: "ping" },
      ],
    },
    { tenantId, userId },
    devices,
  );
});
afterAll(async () => {
  const scope = { tenantId: { in: [tenantId, otherTenantId] } };
  await db.deviceCommand.deleteMany({ where: scope });
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
async function fixture(
  display = true,
  sourceKind: "owner" | "device" = "owner",
) {
  const paired = await pairOwnerDevice(
    {
      name: "Target station",
      profileId: "weather-station",
      profileVersion: 1,
      capabilities: [
        { kind: "temperature" },
        { kind: "humidity" },
        { kind: "ping" },
        ...(display ? [{ kind: "display", maxTextLength: 32 }] : []),
      ],
    },
    { tenantId, userId },
    devices,
  );
  const credential = paired.credentials.find(
    (value) => value.purpose === "mqtt",
  );
  if (!credential) throw new Error("credential");
  const identityString = deviceMqttIdentity({
    tenantId,
    deviceId: paired.device.id,
    credentialId: credential.credentialId,
  });
  const published: DeviceCommand[] = [];
  const telemetry = {
    store: new TelemetryRepository(db),
    devices,
    epoch: randomUUID(),
    policy: { intervalSeconds: 30, retentionDays: 7 },
  };
  const commands: DeviceCommandDependencies = {
    store: new DeviceCommandRepository(db),
    devices,
    telemetry,
    acknowledgementTimeoutMs: 1500,
    publisher: {
      isReady: () => true,
      publishCommand: vi.fn(async (command: DeviceCommand) => {
        published.push(command);
        return "accepted" as const;
      }),
    },
  };
  const deps = {
    store: new ToolExecutionRepository(db),
    devices,
    identity,
    auth,
    registry: new ToolRegistry(createDeviceCommandTools(commands)),
  };
  const authentication: ToolAuthentication =
    sourceKind === "owner"
      ? ownerAuth
      : {
          kind: "device",
          token:
            source.credentials.find((value) => value.purpose === "voice")
              ?.token ?? "",
        };
  await ingestBrokerMessage(
    {
      identity: identityString,
      topic: paired.mqtt.presence,
      retained: false,
      payload: JSON.stringify({
        version: 1,
        type: "device.presence",
        messageId: randomUUID(),
        deviceId: paired.device.id,
        bootId: "boot",
        sequence: 0,
        status: "online",
        sentAt: new Date().toISOString(),
      }),
    },
    telemetry,
  );
  async function request(
    toolId = "device.ping",
    args: Record<string, unknown> = { deviceId: paired.device.id },
  ) {
    if (sourceKind === "device")
      await assignOwnerDeviceGrant(
        source.device.id,
        {
          toolId,
          targetDeviceIds: [paired.device.id],
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        { tenantId, userId },
        devices,
      );
    await preauthorizeTool(
      {
        toolId,
        sourceDeviceId: sourceKind === "device" ? source.device.id : null,
        targetDeviceId: paired.device.id,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      ownerAuth,
      deps,
    );
    const runId = randomUUID(),
      turnId = randomUUID();
    await db.agentRun.create({
      data: {
        id: runId,
        tenantId,
        deviceId: sourceKind === "device" ? source.device.id : null,
        status: "active",
      },
    });
    await db.conversationTurn.create({
      data: {
        id: turnId,
        tenantId,
        runId,
        sequence: 1,
        source: sourceKind === "device" ? "voice" : "text",
        status: "committed",
        correlationId: turnId,
      },
    });
    const input = {
      toolCall: {
        version: 1,
        conversationId: runId,
        turnId,
        toolCallId: randomUUID(),
        toolId,
        arguments: args,
      },
      correlationId: turnId,
    };
    return { input, queued: await submitToolCall(input, authentication, deps) };
  }
  function receipt(
    command: DeviceCommand,
    status: "succeeded" | "failed" = "succeeded",
  ): DeviceCommandResult {
    return {
      version: 1,
      type: "device.command.result",
      messageId: randomUUID(),
      commandId: command.commandId,
      executionId: command.executionId,
      deviceId: command.deviceId,
      completedAt: new Date().toISOString(),
      ...(status === "succeeded"
        ? { status }
        : {
            status,
            error: {
              code: "execution_failed",
              message: "Device rejected",
              correlationId: command.commandId,
              retryable: false,
            },
          }),
    };
  }
  const acknowledge = (result: DeviceCommandResult, retained = false) =>
    ingestDeviceCommandResult(
      {
        identity: identityString,
        topic: paired.mqtt.commandResults,
        retained,
        payload: JSON.stringify(result),
      },
      commands,
    );
  return {
    paired,
    published,
    commands,
    deps,
    authentication,
    request,
    receipt,
    acknowledge,
  };
}
it.each(["owner", "device"] as const)(
  "uses the same authorized executor for %s and waits for a matching execution receipt",
  async (kind) => {
    const f = await fixture(true, kind),
      request = await f.request();
    const pending = dispatchToolExecution(
      request.queued.executionId,
      f.authentication,
      f.deps,
    );
    await vi.waitFor(() => expect(f.published).toHaveLength(1));
    const command = f.published[0];
    expect(
      (await getCommandOutcome(command.commandId, { tenantId }, f.commands))
        .status,
    ).toBe("pending");
    expect(
      (
        await db.toolExecution.findUnique({
          where: { id: command.executionId },
        })
      )?.status,
    ).toBe("running");
    await expect(
      f.acknowledge({ ...f.receipt(command), executionId: "wrong" }),
    ).rejects.toThrow("identity");
    await expect(f.acknowledge(f.receipt(command), true)).rejects.toThrow(
      "Retained",
    );
    const result = f.receipt(command);
    expect(await f.acknowledge(result)).toBe(true);
    expect((await pending).status).toBe("succeeded");
    expect(await f.acknowledge(f.receipt(command, "failed"))).toBe(false);
    expect(
      (await submitToolCall(request.input, f.authentication, f.deps))
        .executionId,
    ).toBe(command.executionId);
    expect(
      (
        await dispatchToolExecution(
          command.executionId,
          f.authentication,
          f.deps,
        )
      ).status,
    ).toBe("succeeded");
    expect(f.published).toHaveLength(1);
  },
);
it.each(["offline", "unsupported", "text-limit", "not-sent"])(
  "returns an explicit %s failure without claiming execution",
  async (kind) => {
    const f = await fixture(kind !== "unsupported");
    if (kind === "offline") f.commands.telemetry.epoch = "another-backend";
    if (kind === "not-sent")
      f.commands.publisher.publishCommand = async () => "not_sent";
    const display = kind === "unsupported" || kind === "text-limit";
    const { queued } = await f.request(
      display ? "display.message" : "device.ping",
      display
        ? { deviceId: f.paired.device.id, text: "x".repeat(33) }
        : undefined,
    );
    const result = await dispatchToolExecution(
      queued.executionId,
      f.authentication,
      f.deps,
    );
    expect(result.status).toBe("failed");
    expect(result.output?.status).toBe("failed");
    expect(f.published).toHaveLength(0);
  },
);
it("ack timeout and cancellation after dispatch remain unknown; late receipts cannot revive them", async () => {
  for (const cancelled of [false, true]) {
    const f = await fixture(),
      { queued } = await f.request(),
      controller = new AbortController();
    f.commands.acknowledgementTimeoutMs = 150;
    const pending = dispatchToolExecution(
      queued.executionId,
      f.authentication,
      f.deps,
      controller.signal,
    );
    await vi.waitFor(() => expect(f.published).toHaveLength(1));
    const receipt = f.receipt(f.published[0]);
    if (cancelled) controller.abort();
    expect((await pending).status).toBe("unknown");
    await vi.waitFor(async () =>
      expect(
        (await getCommandOutcome(queued.executionId, { tenantId }, f.commands))
          .status,
      ).toBe("unknown"),
    );
    expect(await f.acknowledge(receipt)).toBe(false);
    expect(
      (
        await reconcileToolExecution(
          queued.executionId,
          f.authentication,
          f.deps,
        )
      ).status,
    ).toBe("unknown");
    expect(
      (await getCommandOutcome(queued.executionId, { tenantId }, f.commands))
        .result,
    ).toHaveProperty("lateAcknowledgement");
    expect(
      (await getCommandOutcome(queued.executionId, { tenantId }, f.commands))
        .result?.reason,
    ).toBe(cancelled ? "dispatch_unknown" : "ack_timeout");
    await dispatchToolExecution(queued.executionId, f.authentication, f.deps);
    expect(f.published).toHaveLength(1);
  }
});
it("rejects cross-Tenant outcome reads and acknowledgements from another device", async () => {
  const f = await fixture(),
    other = await fixture(),
    { queued } = await f.request();
  const pending = dispatchToolExecution(
    queued.executionId,
    f.authentication,
    f.deps,
  );
  await vi.waitFor(() => expect(f.published).toHaveLength(1));
  await expect(
    getCommandOutcome(
      queued.executionId,
      { tenantId: otherTenantId },
      f.commands,
    ),
  ).rejects.toThrow("not found");
  await expect(other.acknowledge(f.receipt(f.published[0]))).rejects.toThrow(
    "identity",
  );
  await f.acknowledge(f.receipt(f.published[0]));
  expect((await pending).status).toBe("succeeded");
});

it("settles pending dispatch as unknown before a host closes persistence", async () => {
  const f = await fixture(),
    lifetime = new AbortController();
  f.commands.signal = lifetime.signal;
  f.commands.inflight = new Set();
  const { queued } = await f.request();
  const pending = dispatchToolExecution(
    queued.executionId,
    f.authentication,
    f.deps,
  );
  await vi.waitFor(() => expect(f.published).toHaveLength(1));
  expect(f.commands.inflight.size).toBe(1);
  lifetime.abort();
  expect((await pending).status).toBe("unknown");
  expect(f.commands.inflight.size).toBe(0);
  expect(
    (await getCommandOutcome(queued.executionId, { tenantId }, f.commands))
      .status,
  ).toBe("unknown");
});

it.each(["failed", "expired"] as const)(
  "propagates an explicit device %s receipt without reporting success",
  async (status) => {
    const f = await fixture(),
      { queued } = await f.request();
    const pending = dispatchToolExecution(
      queued.executionId,
      f.authentication,
      f.deps,
    );
    await vi.waitFor(() => expect(f.published).toHaveLength(1));
    const command = f.published[0];
    await f.acknowledge({
      version: 1,
      type: "device.command.result",
      messageId: randomUUID(),
      commandId: command.commandId,
      executionId: command.executionId,
      deviceId: command.deviceId,
      completedAt: new Date().toISOString(),
      status,
      error: {
        code: status === "expired" ? "expired" : "execution_failed",
        message: "Not executed",
        correlationId: command.commandId,
        retryable: false,
      },
    });
    const result = await pending;
    expect(result.status).toBe("failed");
    expect(result.output?.status).toBe(status);
  },
);
it.each(["prepared", "pending"])(
  "reconciles abandoned %s state after restart without publishing",
  async (status) => {
    const f = await fixture(),
      { queued } = await f.request(),
      past = new Date(Date.now() - 1000);
    await db.toolExecution.update({
      where: { id: queued.executionId },
      data: { status: "running", dispatchDeadline: past },
    });
    const command: DeviceCommand = {
      version: 1,
      type: "device.command",
      messageId: queued.executionId,
      commandId: queued.executionId,
      executionId: queued.executionId,
      deviceId: f.paired.device.id,
      issuedAt: new Date(past.getTime() - 1000).toISOString(),
      expiresAt: past.toISOString(),
      action: { kind: "ping" },
    };
    await db.deviceCommand.create({
      data: {
        id: command.commandId,
        executionId: command.executionId,
        deviceId: command.deviceId,
        tenantId,
        status,
        issuedAt: new Date(command.issuedAt),
        expiresAt: past,
        payloadJson: JSON.stringify(command),
      },
    });
    // A fresh repository/registry models process-local state loss; the durable reservation remains authoritative.
    f.commands.store = new DeviceCommandRepository(db);
    f.deps.registry = new ToolRegistry(createDeviceCommandTools(f.commands));
    const result = await reconcileToolExecution(
      queued.executionId,
      f.authentication,
      f.deps,
    );
    expect(result.status).toBe(status === "prepared" ? "failed" : "unknown");
    expect(f.published).toHaveLength(0);
  },
);
it("keeps a publish failure uncertain and does not retry under the same identity", async () => {
  const f = await fixture(),
    { queued } = await f.request();
  f.commands.publisher.publishCommand = async (command) => {
    f.published.push(command);
    throw new Error("synthetic sensitive transport failure");
  };
  const result = await dispatchToolExecution(
    queued.executionId,
    f.authentication,
    f.deps,
  );
  expect(result.status).toBe("unknown");
  expect(JSON.stringify(result)).not.toContain("sensitive");
  await dispatchToolExecution(queued.executionId, f.authentication, f.deps);
  expect(f.published).toHaveLength(1);
});

it("binds the physical action and exact arguments to the authorized execution", async () => {
  const f = await fixture(),
    { queued } = await f.request();
  await db.toolExecution.update({
    where: { id: queued.executionId },
    data: { status: "running", dispatchDeadline: new Date(Date.now() + 10000) },
  });
  await expect(
    dispatchDeviceCommand(
      {
        deviceId: f.paired.device.id,
        action: { kind: "display.write", text: "Unapproved" },
      },
      {
        tenantId,
        executionId: queued.executionId,
        targetDeviceId: f.paired.device.id,
        idempotencyKey: "test",
        signal: new AbortController().signal,
      },
      f.commands,
    ),
  ).rejects.toThrow("authorized execution arguments");
  expect(f.published).toHaveLength(0);
  expect(
    await db.deviceCommand.count({
      where: { tenantId, executionId: queued.executionId },
    }),
  ).toBe(0);
});

it("retries a rolled-back driver conflict before confirming online command presence", async () => {
  const f = await fixture(),
    credential = f.paired.credentials.find((entry) => entry.purpose === "mqtt");
  if (!credential) throw new Error("credential");
  const conflict = new Error("TransactionWriteConflict", {
    cause: { kind: "TransactionWriteConflict" },
  });
  conflict.name = "DriverAdapterError";
  const transaction = vi
    .spyOn(db, "$transaction")
    .mockRejectedValueOnce(conflict);
  try {
    await expect(
      ingestBrokerMessage(
        {
          identity: deviceMqttIdentity({
            tenantId,
            deviceId: f.paired.device.id,
            credentialId: credential.credentialId,
          }),
          topic: f.paired.mqtt.presence,
          retained: false,
          payload: JSON.stringify({
            version: 1,
            type: "device.presence",
            messageId: randomUUID(),
            deviceId: f.paired.device.id,
            bootId: "boot",
            sequence: 1,
            status: "online",
            sentAt: new Date().toISOString(),
          }),
        },
        f.commands.telemetry,
      ),
    ).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(
      (
        await db.devicePresence.findUnique({
          where: {
            tenantId_deviceId: { tenantId, deviceId: f.paired.device.id },
          },
        })
      )?.presenceSequence,
    ).toBe(1n);
  } finally {
    transaction.mockRestore();
  }
});
it("does not restore a late device receipt after privacy cleanup cleared the command payload", async () => {
  const f = await fixture(),
    { queued } = await f.request(),
    controller = new AbortController();
  const pending = dispatchToolExecution(
    queued.executionId,
    f.authentication,
    f.deps,
    controller.signal,
  );
  await vi.waitFor(() => expect(f.published).toHaveLength(1));
  const command = f.published[0];
  if (!command) throw new Error("Command missing");
  const receipt = { ...f.receipt(command), completedAt: command.issuedAt };
  controller.abort();
  expect((await pending).status).toBe("unknown");
  await db.deviceCommand.update({
    where: { id: command.commandId },
    data: { payloadJson: "{}", resultJson: null },
  });
  expect(await f.acknowledge(receipt)).toBe(false);
  expect(
    (await f.commands.store.get(tenantId, command.commandId))?.resultJson,
  ).toBeNull();
});
