import { z } from "zod";
import {
  OpenHuliErrorSchema,
  OpenHuliIdSchema,
  OpenHuliPcmFormatSchema,
  OpenHuliProtocolError,
  OpenHuliSequenceSchema,
  OpenHuliTimestampSchema,
  openHuliEnvelope,
  parseOpenHuliJson,
} from "./common";

export const DeviceCapabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("temperature") }).strict(),
  z.object({ kind: z.literal("humidity") }).strict(),
  z
    .object({ kind: z.literal("microphone"), format: OpenHuliPcmFormatSchema })
    .strict(),
  z
    .object({ kind: z.literal("speaker"), format: OpenHuliPcmFormatSchema })
    .strict(),
  z
    .object({
      kind: z.literal("display"),
      maxTextLength: z.number().int().min(1).max(512),
    })
    .strict(),
  z.object({ kind: z.literal("ping") }).strict(),
]);
export const DeviceCapabilityManifestSchema = z
  .object({
    ...openHuliEnvelope,
    type: z.literal("device.manifest"),
    deviceId: OpenHuliIdSchema,
    firmwareVersion: z.string().min(1).max(64),
    capabilities: z
      .array(DeviceCapabilitySchema)
      .min(1)
      .max(6)
      .refine(
        (items) =>
          new Set(items.map((item) => item.kind)).size === items.length,
        "Duplicate capability kind",
      ),
  })
  .strict();
export type DeviceCapabilityManifest = z.infer<
  typeof DeviceCapabilityManifestSchema
>;

export const DeviceReadingSchema = z.discriminatedUnion("metric", [
  z
    .object({
      metric: z.literal("temperature"),
      value: z.number().finite().min(-40).max(125),
      unit: z.literal("degC"),
    })
    .strict(),
  z
    .object({
      metric: z.literal("humidity"),
      value: z.number().finite().min(0).max(100),
      unit: z.literal("percent"),
    })
    .strict(),
]);
export const DeviceSensorErrorSchema = z
  .object({
    metric: z.enum(["temperature", "humidity"]),
    code: z.enum(["read_failed", "unavailable"]),
  })
  .strict();
export const DevicePresenceSchema = z
  .object({
    ...openHuliEnvelope,
    type: z.literal("device.presence"),
    deviceId: OpenHuliIdSchema,
    bootId: OpenHuliIdSchema,
    sequence: OpenHuliSequenceSchema,
    status: z.enum(["online", "offline"]),
    sentAt: OpenHuliTimestampSchema,
  })
  .strict();
export type DevicePresence = z.infer<typeof DevicePresenceSchema>;
export const DeviceTelemetrySchema = z
  .object({
    ...openHuliEnvelope,
    type: z.literal("device.telemetry"),
    deviceId: OpenHuliIdSchema,
    bootId: OpenHuliIdSchema,
    sequence: OpenHuliSequenceSchema,
    sampledAt: OpenHuliTimestampSchema,
    readings: z
      .array(DeviceReadingSchema)
      .min(0)
      .max(2)
      .refine(
        (items) =>
          new Set(items.map((item) => item.metric)).size === items.length,
        "Duplicate metric",
      ),
    sensorErrors: z.array(DeviceSensorErrorSchema).max(2).optional(),
  })
  .strict()
  .refine((data) => {
    const metrics = [...data.readings, ...(data.sensorErrors ?? [])].map(
      (item) => item.metric,
    );
    return metrics.length > 0 && new Set(metrics).size === metrics.length;
  }, "Each metric must have one reading or sensor error");
export type DeviceTelemetry = z.infer<typeof DeviceTelemetrySchema>;

export const DeviceCommandActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ping") }).strict(),
  z
    .object({
      kind: z.literal("display.write"),
      text: z.string().min(1).max(512),
    })
    .strict(),
]);
export const DeviceCommandSchema = z
  .object({
    ...openHuliEnvelope,
    type: z.literal("device.command"),
    deviceId: OpenHuliIdSchema,
    commandId: OpenHuliIdSchema,
    executionId: OpenHuliIdSchema,
    issuedAt: OpenHuliTimestampSchema,
    expiresAt: OpenHuliTimestampSchema,
    action: DeviceCommandActionSchema,
  })
  .strict()
  .refine(
    (command) => Date.parse(command.expiresAt) > Date.parse(command.issuedAt),
    "Expiry must follow issuance",
  );
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>;

const resultBase = {
  ...openHuliEnvelope,
  type: z.literal("device.command.result"),
  deviceId: OpenHuliIdSchema,
  commandId: OpenHuliIdSchema,
  executionId: OpenHuliIdSchema,
  completedAt: OpenHuliTimestampSchema,
};
export const DeviceCommandResultSchema = z.discriminatedUnion("status", [
  z.object({ ...resultBase, status: z.literal("succeeded") }).strict(),
  z
    .object({
      ...resultBase,
      status: z.enum(["failed", "expired", "cancelled", "unknown"]),
      error: OpenHuliErrorSchema,
    })
    .strict(),
]);
export type DeviceCommandResult = z.infer<typeof DeviceCommandResultSchema>;

export function parseDeviceManifest(text: string): DeviceCapabilityManifest {
  return parseOpenHuliJson(text, DeviceCapabilityManifestSchema);
}

function requireDevice(deviceId: string, manifest: DeviceCapabilityManifest) {
  if (deviceId !== manifest.deviceId)
    throw new OpenHuliProtocolError("Device does not match bound manifest");
}

export function parseDeviceTelemetry(
  text: string,
  manifest: DeviceCapabilityManifest,
): DeviceTelemetry {
  const telemetry = parseOpenHuliJson(text, DeviceTelemetrySchema);
  requireDevice(telemetry.deviceId, manifest);
  for (const reading of [
    ...telemetry.readings,
    ...(telemetry.sensorErrors ?? []),
  ]) {
    if (
      !manifest.capabilities.some(
        (capability) => capability.kind === reading.metric,
      )
    ) {
      throw new OpenHuliProtocolError("Metric capability is unsupported");
    }
  }
  return telemetry;
}

export function parseDeviceCommand(
  text: string,
  manifest: DeviceCapabilityManifest,
): DeviceCommand {
  const command = parseOpenHuliJson(text, DeviceCommandSchema);
  requireDevice(command.deviceId, manifest);
  const required = command.action.kind === "display.write" ? "display" : "ping";
  const capability = manifest.capabilities.find(
    (item) => item.kind === required,
  );
  if (!capability)
    throw new OpenHuliProtocolError("Command capability is unsupported");
  if (
    command.action.kind === "display.write" &&
    capability.kind === "display" &&
    command.action.text.length > capability.maxTextLength
  ) {
    throw new OpenHuliProtocolError("Display text exceeds device limit");
  }
  return command;
}
