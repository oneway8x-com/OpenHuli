import { z } from "zod";
import {
  PairDeviceSchema,
  IntegrationSettingsSchema,
  DeviceReadingSchema,
  DeviceSensorErrorSchema,
} from "@corely/contracts";
export async function deviceFetch(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Sign in again."
        : "Request failed. Check your device, permissions and runtime configuration.",
    );
  return response.status === 204 ? null : response.json();
}
export const DeviceSchema = PairDeviceSchema.extend({
  id: z.string(),
  status: z.string(),
});
const CredentialSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
});
export const DetailSchema = z.object({
  device: DeviceSchema,
  credentials: z.array(CredentialSchema),
  grants: z.array(
    z.object({
      toolId: z.string(),
      targetDeviceIds: z.array(z.string()),
      expiresAt: z.string(),
      revokedAt: z.string().nullable(),
    }),
  ),
  mqtt: z.record(z.string()),
});
export const IssuedSchema = z.object({
  credentialId: z.string(),
  purpose: z.enum(["voice", "mqtt"]),
  token: z.string(),
  expiresAt: z.string(),
  mqttUsername: z.string().optional(),
  mqttClientId: z.string().optional(),
});
export const PairResultSchema = z.object({
  device: DeviceSchema,
  credentials: z.array(IssuedSchema),
  mqtt: z.record(z.string()),
});
export const IntegrationViewSchema = z.object({
  settings: IntegrationSettingsSchema,
  notesConfigured: z.boolean(),
  telemetryAvailable: z.boolean(),
});
export const TelemetryViewSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    latest: z.object({
      connectivity: z.string(),
      freshness: z.string(),
      sampledAt: z.string().nullable(),
      lastSeenAt: z.string().nullable(),
      readings: z.array(DeviceReadingSchema),
      sensorErrors: z.array(DeviceSensorErrorSchema),
    }),
    history: z.object({
      items: z.array(
        z.object({
          sampledAt: z.string(),
          readings: z.array(DeviceReadingSchema),
        }),
      ),
    }),
  }),
]);
export const ExecutionSchema = z.object({
  executionId: z.string(),
  toolId: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  arguments: z.record(z.unknown()),
  requestHash: z.string(),
  targetDeviceId: z.string().nullable(),
  approvalId: z.string().nullable(),
  expiresAt: z.string(),
});
export type Device = z.infer<typeof DeviceSchema>;
