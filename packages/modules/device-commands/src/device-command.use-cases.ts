import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  DeviceCommandActionSchema,
  DeviceCommandSchema,
  DeviceCommandResultSchema,
  OpenHuliIdSchema,
  PairDeviceSchema,
  parseDeviceCommand,
  parseOpenHuliJson,
} from "@corely/contracts";
import {
  authorizeDeviceMqtt,
  parseDeviceMqttIdentity,
  revalidateDeviceSession,
  validateDeviceAdvertisement,
} from "@corely/modules-devices";
import { getTelemetryLatest } from "@corely/modules-telemetry";
import type { ToolContext } from "@corely/modules-tool-execution";
import type { DeviceCommandDependencies } from "./device-command.types";

const Input = z
  .object({ deviceId: OpenHuliIdSchema, action: DeviceCommandActionSchema })
  .strict();
export async function getCommandOutcome(
  commandId: string,
  context: { tenantId: string },
  deps: DeviceCommandDependencies,
  now = new Date(),
) {
  let record = await deps.store.get(
    context.tenantId,
    OpenHuliIdSchema.parse(commandId),
  );
  if (!record) throw new Error("Command not found");
  if (
    record.expiresAt <= now &&
    ["prepared", "pending"].includes(record.status)
  ) {
    await deps.store.finish(
      context.tenantId,
      record.id,
      record.status === "prepared" ? "prepared" : "pending",
      record.status === "prepared" ? "expired" : "unknown",
      record.status === "prepared" ? "expired" : "ack_timeout",
      now,
    );
    record = await deps.store.get(context.tenantId, record.id);
    if (!record) throw new Error("Command not found");
  }
  return {
    commandId: record.id,
    executionId: record.executionId,
    deviceId: record.deviceId,
    status: record.status,
    expiresAt: record.expiresAt.toISOString(),
    result: record.resultJson
      ? z.record(z.unknown()).parse(JSON.parse(record.resultJson))
      : null,
  };
}
/** Track command settlement so host shutdown records conservative outcomes before closing persistence. */
export function dispatchDeviceCommand(
  value: unknown,
  context: ToolContext,
  deps: DeviceCommandDependencies,
) {
  const task = runDeviceCommand(
    value,
    {
      ...context,
      signal: deps.signal
        ? AbortSignal.any([context.signal, deps.signal])
        : context.signal,
    },
    deps,
  );
  deps.inflight?.add(task);
  void task.then(
    () => deps.inflight?.delete(task),
    () => deps.inflight?.delete(task),
  );
  return task;
}
/** Called by a registered write callback after executor authorization, never directly from model/UI input. */
async function runDeviceCommand(
  value: unknown,
  context: ToolContext,
  deps: DeviceCommandDependencies,
) {
  const input = Input.parse(value),
    now = new Date();
  if (context.targetDeviceId !== input.deviceId)
    throw new Error("Exact command target required");
  const execution = await deps.store.execution(
    context.tenantId,
    context.executionId,
    input.deviceId,
    now,
  );
  if (!execution)
    throw new Error("Running authorized device execution required");
  const expectedTool =
    input.action.kind === "ping" ? "device.ping" : "display.message";
  const expected =
    input.action.kind === "ping"
      ? z.object({ deviceId: z.literal(input.deviceId) }).strict()
      : z
          .object({
            deviceId: z.literal(input.deviceId),
            text: z.literal(input.action.text),
          })
          .strict();
  if (
    execution.toolName !== expectedTool ||
    !expected.safeParse(JSON.parse(execution.inputJson)).success
  )
    throw new Error(
      "Command does not match the authorized execution arguments",
    );
  const device = await deps.devices.findDevice(
    context.tenantId,
    input.deviceId,
  );
  if (!device || device.status !== "active" || !device.configurationJson)
    throw new Error("Active device not found");
  const timeout = z
    .number()
    .int()
    .min(100)
    .max(15000)
    .parse(deps.acknowledgementTimeoutMs);
  const command = DeviceCommandSchema.parse({
    version: 1,
    type: "device.command",
    messageId: context.executionId,
    commandId: context.executionId,
    executionId: context.executionId,
    deviceId: input.deviceId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(
      Math.min(
        now.getTime() + timeout,
        execution.expiresAt?.getTime() ?? 0,
        execution.dispatchDeadline?.getTime() ?? 0,
      ),
    ).toISOString(),
    action: input.action,
  });
  const reserved = await deps.store.reserve(context.tenantId, command);
  const stored = DeviceCommandSchema.parse(
    JSON.parse(reserved.record.payloadJson),
  );
  if (JSON.stringify(stored.action) !== JSON.stringify(command.action))
    throw new Error("Command arguments changed");
  const finishBefore = async (
    status: "failed" | "cancelled" | "expired",
    reason: string,
  ) => {
    await deps.store.finish(
      context.tenantId,
      command.commandId,
      "prepared",
      status,
      reason,
      new Date(),
    );
  };
  if (reserved.created) {
    let supported = true;
    try {
      const manifest = validateDeviceAdvertisement(
        DeviceCapabilityManifestSchema.parse(JSON.parse(device.manifestJson)),
        input.deviceId,
        PairDeviceSchema.parse(JSON.parse(device.configurationJson)),
      );
      parseDeviceCommand(JSON.stringify(command), manifest);
    } catch {
      supported = false;
    }
    if (!supported) await finishBefore("failed", "unsupported");
    else if (context.signal.aborted)
      await finishBefore("cancelled", "cancelled_before_dispatch");
    else {
      const latest = await getTelemetryLatest(
        { deviceId: input.deviceId },
        context,
        deps.telemetry,
      );
      if (latest.connectivity !== "online" || !deps.publisher.isReady())
        await finishBefore("failed", "offline");
      else if (context.signal.aborted)
        await finishBefore("cancelled", "cancelled_before_dispatch");
      else if (
        await deps.store.claim(
          context.tenantId,
          command.commandId,
          input.deviceId,
          new Date(),
        )
      ) {
        try {
          const accepted = await deps.publisher.publishCommand(
            command,
            context.signal,
          );
          if (accepted === "not_sent")
            await deps.store.finish(
              context.tenantId,
              command.commandId,
              "pending",
              "failed",
              "not_sent",
              new Date(),
            );
        } catch {
          await deps.store.finish(
            context.tenantId,
            command.commandId,
            "pending",
            "unknown",
            "dispatch_unknown",
            new Date(),
          );
        }
      }
    }
  }
  while (true) {
    const outcome = await getCommandOutcome(command.commandId, context, deps);
    if (!["prepared", "pending"].includes(outcome.status)) return outcome;
    if (context.signal.aborted) {
      await deps.store.finish(
        context.tenantId,
        command.commandId,
        outcome.status === "pending" ? "pending" : "prepared",
        outcome.status === "pending" ? "unknown" : "cancelled",
        outcome.status === "pending"
          ? "dispatch_unknown"
          : "cancelled_before_dispatch",
        new Date(),
      );
      return getCommandOutcome(command.commandId, context, deps);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
/** Only broker-attested source identity can acknowledge an exact command/execution pair. */
export async function ingestDeviceCommandResult(
  input: {
    identity: string;
    topic: string;
    payload: string;
    retained: boolean;
  },
  deps: DeviceCommandDependencies,
  now = new Date(),
) {
  if (input.retained)
    throw new Error("Retained command results are not accepted");
  const session = parseDeviceMqttIdentity(input.identity);
  await revalidateDeviceSession(session, deps.devices, now);
  await authorizeDeviceMqtt(session, "publish", input.topic, deps.devices, now);
  if (!input.topic.endsWith("/results"))
    throw new Error("Result topic required");
  const result = parseOpenHuliJson(input.payload, DeviceCommandResultSchema);
  const record = await deps.store.get(session.tenantId, result.commandId);
  if (
    !record ||
    record.deviceId !== session.deviceId ||
    result.deviceId !== session.deviceId ||
    record.executionId !== result.executionId
  )
    throw new Error("Command acknowledgement identity mismatch");
  const completed = Date.parse(result.completedAt);
  if (
    completed < record.issuedAt.getTime() ||
    completed > now.getTime() + 5000 ||
    completed > record.expiresAt.getTime()
  )
    throw new Error("Invalid acknowledgement time");
  return deps.store.acknowledge(session.tenantId, result, now);
}
