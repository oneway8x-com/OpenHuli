import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  DeviceCommandSchema,
  DeviceCommandResultSchema,
  DeviceTelemetrySchema,
  OpenHuliIdSchema,
  parseDeviceCommand,
  parseDeviceTelemetry,
} from "@corely/contracts";
import type { DeviceRepository } from "./device.repository";
import {
  DeviceCredentialSchema,
  DeviceGrantSchema,
  RegisterDeviceSchema,
} from "./device.schemas";

// Context must be provided by authenticated server composition, never by a device payload.
export type DeviceContext = { tenantId: string };
const id = (value: unknown) => OpenHuliIdSchema.parse(value);
async function requireDevice(
  context: DeviceContext,
  deviceId: string,
  repository: DeviceRepository,
) {
  const device = await repository.find(context.tenantId, deviceId);
  if (!device || device.status !== "active")
    throw new Error("Device not found");
  return device;
}
export async function registerDevice(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
) {
  return repository.register(
    context.tenantId,
    RegisterDeviceSchema.parse(input),
  );
}
export async function getDevice(
  deviceId: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
) {
  return repository.find(context.tenantId, id(deviceId));
}
export async function issueDeviceCredential(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  const parsed = DeviceCredentialSchema.parse(input);
  if (parsed.expiresAt <= now)
    throw new Error("Credential must expire in the future");
  await requireDevice(context, parsed.deviceId, repository);
  return repository.addCredential(context.tenantId, parsed);
}
export async function authenticateDeviceCredential(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  const parsed = z
    .object({
      id: OpenHuliIdSchema,
      secretHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(input);
  const credential = await repository.findCredential(
    context.tenantId,
    parsed.id,
    now,
  );
  if (
    !credential ||
    !timingSafeEqual(
      Buffer.from(credential.secretHash, "hex"),
      Buffer.from(parsed.secretHash, "hex"),
    )
  )
    throw new Error("Invalid device credential");
  return { deviceId: credential.deviceId };
}
export async function revokeDeviceCredential(
  credentialId: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  return repository.revokeCredential(context.tenantId, id(credentialId), now);
}
export async function grantDeviceTool(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  const parsed = DeviceGrantSchema.parse(input);
  if (parsed.expiresAt <= now)
    throw new Error("Grant must expire in the future");
  await requireDevice(context, parsed.deviceId, repository);
  return repository.grant(context.tenantId, parsed);
}
export async function getDeviceToolGrant(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  const parsed = z
    .object({ deviceId: OpenHuliIdSchema, toolId: OpenHuliIdSchema })
    .strict()
    .parse(input);
  return repository.findGrant(
    context.tenantId,
    parsed.deviceId,
    parsed.toolId,
    now,
  );
}
export async function revokeDeviceToolGrant(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  const parsed = z
    .object({ deviceId: OpenHuliIdSchema, toolId: OpenHuliIdSchema })
    .strict()
    .parse(input);
  return repository.revokeGrant(
    context.tenantId,
    parsed.deviceId,
    parsed.toolId,
    now,
  );
}
export async function recordDeviceTelemetry(
  input: unknown,
  context: DeviceContext & { deviceId: string },
  repository: DeviceRepository,
) {
  const parsed = DeviceTelemetrySchema.parse(input);
  if (parsed.deviceId !== context.deviceId)
    throw new Error("Device identity mismatch");
  const device = await requireDevice(context, context.deviceId, repository);
  const manifest = DeviceCapabilityManifestSchema.parse(
    JSON.parse(device.manifestJson),
  );
  const telemetry = parseDeviceTelemetry(JSON.stringify(parsed), manifest);
  return repository.recordTelemetry(context.tenantId, telemetry);
}
export async function getDeviceTelemetry(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
) {
  const parsed = z
    .object({
      deviceId: OpenHuliIdSchema,
      take: z.number().int().min(1).max(100).default(50),
    })
    .strict()
    .parse(input);
  return repository.history(context.tenantId, parsed.deviceId, parsed.take);
}
export async function queueDeviceCommand(
  input: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  // Parse before looking up the claimed device, then verify against the stored manifest.
  const command = DeviceCommandSchema.parse(input);
  const device = await requireDevice(context, command.deviceId, repository);
  const parsed = parseDeviceCommand(
    JSON.stringify(command),
    DeviceCapabilityManifestSchema.parse(JSON.parse(device.manifestJson)),
  );
  if (new Date(parsed.expiresAt) <= now || new Date(parsed.issuedAt) > now)
    throw new Error("Command is not currently valid");
  const execution = await repository.findExecution(
    context.tenantId,
    parsed.executionId,
    parsed.deviceId,
  );
  if (
    !execution ||
    execution.status !== "running" ||
    (execution.expiresAt &&
      (execution.expiresAt <= now ||
        new Date(parsed.expiresAt) > execution.expiresAt))
  )
    throw new Error("Running device execution not found");
  return repository.queueCommand(context.tenantId, parsed);
}
export async function getDeviceCommand(
  commandId: unknown,
  context: DeviceContext,
  repository: DeviceRepository,
) {
  return repository.findCommand(context.tenantId, id(commandId));
}
export async function recordDeviceCommandResult(
  input: unknown,
  context: DeviceContext & { deviceId: string },
  repository: DeviceRepository,
  now = new Date(),
) {
  const parsed = DeviceCommandResultSchema.parse(input);
  if (parsed.deviceId !== context.deviceId)
    throw new Error("Device identity mismatch");
  await requireDevice(context, context.deviceId, repository);
  const command = await repository.findCommand(
    context.tenantId,
    parsed.commandId,
  );
  if (
    !command ||
    command.deviceId !== context.deviceId ||
    command.executionId !== parsed.executionId
  )
    throw new Error("Command not found");
  // Late success cannot revive an expired command or trigger a repeated physical action.
  await repository.expireCommands(context.tenantId, now);
  return repository.recordResult(context.tenantId, parsed, now);
}
export async function expireDeviceCommands(
  context: DeviceContext,
  repository: DeviceRepository,
  now = new Date(),
) {
  return repository.expireCommands(context.tenantId, now);
}
