import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  OpenHuliIdSchema,
} from "@corely/contracts";

export const RegisterDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    manifest: DeviceCapabilityManifestSchema,
  })
  .strict();
export const DeviceCredentialSchema = z
  .object({
    deviceId: OpenHuliIdSchema,
    // Only a server-produced SHA-256 digest may enter persistence.
    secretHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.date(),
  })
  .strict();
export const DeviceGrantSchema = z
  .object({
    deviceId: OpenHuliIdSchema,
    toolId: OpenHuliIdSchema,
    expiresAt: z.date(),
  })
  .strict();
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;
export type DeviceCredentialInput = z.infer<typeof DeviceCredentialSchema>;
export type DeviceGrantInput = z.infer<typeof DeviceGrantSchema>;
