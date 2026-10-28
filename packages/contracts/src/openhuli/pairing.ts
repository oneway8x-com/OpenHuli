import { z } from "zod";
import { DeviceCapabilityManifestSchema } from "./device";
import { OpenHuliIdSchema } from "./common";

export const DevicePurposeSchema = z.enum(["voice", "mqtt"]);
export type DevicePurpose = z.infer<typeof DevicePurposeSchema>;
export const DeviceProfileIdSchema = z.enum([
  "esp32-voice",
  "weather-station",
  "esp32-microphone",
]);
export const DeviceLocationSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const PairDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    room: z.string().trim().min(1).max(120).nullable().default(null),
    location: DeviceLocationSchema.nullable().default(null),
    profileId: DeviceProfileIdSchema,
    profileVersion: z.literal(1),
    capabilities: DeviceCapabilityManifestSchema.shape.capabilities,
  })
  .strict();
export type PairDeviceInput = z.infer<typeof PairDeviceSchema>;
export const RotateDeviceSecretSchema = z
  .object({
    credentialId: OpenHuliIdSchema,
    purpose: DevicePurposeSchema,
  })
  .strict();
export const AssignDeviceGrantSchema = z
  .object({
    toolId: OpenHuliIdSchema,
    targetDeviceIds: z
      .array(OpenHuliIdSchema)
      .max(32)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate target"),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const DeviceAccessReferenceSchema = z
  .object({
    tenantId: OpenHuliIdSchema,
    deviceId: OpenHuliIdSchema,
    credentialId: OpenHuliIdSchema,
  })
  .strict();
