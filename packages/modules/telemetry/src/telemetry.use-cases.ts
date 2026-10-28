import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  DevicePresenceSchema,
  DeviceReadingSchema,
  DeviceSensorErrorSchema,
  OpenHuliIdSchema,
  PairDeviceSchema,
  parseDeviceManifest,
  parseDeviceTelemetry,
  parseOpenHuliJson,
} from "@corely/contracts";
import {
  authorizeDeviceMqtt,
  parseDeviceMqttIdentity,
  revalidateDeviceSession,
  validateDeviceAdvertisement,
  type DeviceAccessStore,
} from "@corely/modules-devices";
import type { TelemetryRepository } from "./telemetry.repository";

export const TelemetryPolicySchema = z
  .object({
    intervalSeconds: z.number().int().min(1).max(3600).default(30),
    retentionDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();
export type TelemetryPolicy = z.infer<typeof TelemetryPolicySchema>;
export interface TelemetryDependencies {
  store: TelemetryRepository;
  devices: DeviceAccessStore;
  epoch: string;
  policy: TelemetryPolicy;
}
export type TelemetryContext = { tenantId: string };
async function requireDevice(
  deviceId: string,
  context: TelemetryContext,
  deps: TelemetryDependencies,
) {
  const device = await deps.devices.findDevice(context.tenantId, deviceId);
  if (!device || device.status !== "active" || !device.configurationJson)
    throw new Error("Device not found");
  return device;
}
/** The private configured broker plugin, not a device payload, must attest the identity. */
export async function ingestBrokerMessage(
  input: {
    identity: string;
    topic: string;
    payload: string;
    retained: boolean;
  },
  deps: TelemetryDependencies,
  now = new Date(),
) {
  const session = parseDeviceMqttIdentity(input.identity);
  await revalidateDeviceSession(session, deps.devices, now);
  await authorizeDeviceMqtt(session, "publish", input.topic, deps.devices, now);
  const device = await requireDevice(session.deviceId, session, deps);
  const suffix = input.topic.split("/").at(-1);
  if (suffix === "manifest") {
    const parsed = parseDeviceManifest(input.payload);
    const manifest = validateDeviceAdvertisement(
      parsed,
      session.deviceId,
      PairDeviceSchema.parse(JSON.parse(device.configurationJson ?? "null")),
    );
    return deps.devices.saveManifest(
      session.tenantId,
      session.deviceId,
      manifest,
    );
  }
  if (suffix === "presence") {
    const parsed = parseOpenHuliJson(input.payload, DevicePresenceSchema);
    if (
      parsed.deviceId !== session.deviceId ||
      Date.parse(parsed.sentAt) > now.getTime() + 5000
    )
      throw new Error("Invalid device presence");
    await deps.store.presence(session, parsed, deps.epoch, input.retained, now);
    return true;
  }
  if (suffix !== "telemetry") throw new Error("Unsupported ingestion topic");
  const manifest = DeviceCapabilityManifestSchema.parse(
    JSON.parse(device.manifestJson),
  );
  const parsed = parseDeviceTelemetry(input.payload, manifest);
  const age = now.getTime() - Date.parse(parsed.sampledAt);
  if (age < -5000 || age > deps.policy.retentionDays * 86400_000)
    throw new Error("Telemetry timestamp is outside retention/skew limits");
  return deps.store.sample(session, parsed, deps.epoch, input.retained, now);
}
export async function getTelemetryLatest(
  input: unknown,
  context: TelemetryContext,
  deps: TelemetryDependencies,
  now = new Date(),
) {
  const { deviceId } = z
    .object({ deviceId: OpenHuliIdSchema })
    .strict()
    .parse(input);
  const device = await requireDevice(deviceId, context, deps);
  const [presence, sample] = await Promise.all([
    deps.store.snapshot(context.tenantId, deviceId),
    deps.store.latest(
      context.tenantId,
      deviceId,
      new Date(now.getTime() - deps.policy.retentionDays * 86400_000),
    ),
  ]);
  const ttl = deps.policy.intervalSeconds * 3000;
  const connectivity =
    presence?.status === "offline"
      ? "offline"
      : presence?.status === "online" &&
          presence.backendEpoch === deps.epoch &&
          now.getTime() - presence.lastSeenAt.getTime() <= ttl
        ? "online"
        : "unknown";
  const readings = sample
    ? z.array(DeviceReadingSchema).parse(JSON.parse(sample.readingsJson))
    : [];
  const errors = sample
    ? z
        .array(DeviceSensorErrorSchema)
        .parse(JSON.parse(sample.sensorErrorsJson))
    : [];
  const age = sample
    ? Math.max(0, now.getTime() - sample.sampledAt.getTime())
    : null;
  return {
    deviceId,
    name: device.name,
    connectivity,
    freshness:
      !sample || !readings.length
        ? "unavailable"
        : age !== null && age <= ttl
          ? "fresh"
          : "stale",
    source: "measured_sensor",
    sampledAt: sample?.sampledAt.toISOString() ?? null,
    receivedAt: sample?.receivedAt.toISOString() ?? null,
    lastSeenAt:
      presence && presence.lastSeenAt.getTime() > 0
        ? presence.lastSeenAt.toISOString()
        : null,
    ageMs: age,
    readings,
    sensorErrors: errors,
  };
}
export async function getTelemetryHistory(
  input: unknown,
  context: TelemetryContext,
  deps: TelemetryDependencies,
  now = new Date(),
) {
  const parsed = z
    .object({
      deviceId: OpenHuliIdSchema,
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      take: z.number().int().min(1).max(100).default(50),
    })
    .strict()
    .parse(input);
  await requireDevice(parsed.deviceId, context, deps);
  const lower = now.getTime() - deps.policy.retentionDays * 86400_000;
  const from = new Date(parsed.from ?? lower),
    to = new Date(parsed.to ?? now);
  if (from.getTime() < lower || from > to || to > now)
    throw new Error("History range exceeds retention");
  const samples = await deps.store.history(
    context.tenantId,
    parsed.deviceId,
    from,
    to,
    parsed.take,
  );
  return {
    deviceId: parsed.deviceId,
    source: "measured_sensor",
    items: samples.map((sample) => ({
      id: sample.id,
      bootId: sample.bootId,
      sequence: Number(sample.sequence),
      sampledAt: sample.sampledAt.toISOString(),
      receivedAt: sample.receivedAt.toISOString(),
      readings: z
        .array(DeviceReadingSchema)
        .parse(JSON.parse(sample.readingsJson)),
      sensorErrors: z
        .array(DeviceSensorErrorSchema)
        .parse(JSON.parse(sample.sensorErrorsJson)),
    })),
  };
}
export async function listTelemetryDevices(
  context: TelemetryContext,
  deps: TelemetryDependencies,
  now = new Date(),
) {
  const devices = (await deps.devices.listDevices(context.tenantId))
    .filter((device) => device.status === "active" && device.configurationJson)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    truncated: devices.length > 10,
    devices: await Promise.all(
      devices
        .slice(0, 10)
        .map((device) =>
          getTelemetryLatest({ deviceId: device.id }, context, deps, now),
        ),
    ),
  };
}
export function cleanupTelemetry(
  context: TelemetryContext,
  deps: TelemetryDependencies,
  now = new Date(),
) {
  return deps.store.cleanup(
    context.tenantId,
    new Date(now.getTime() - deps.policy.retentionDays * 86400_000),
  );
}
export async function cleanupAllTelemetry(
  deps: TelemetryDependencies,
  signal: AbortSignal,
  now = new Date(),
) {
  let after: string | undefined;
  while (!signal.aborted) {
    const tenants = await deps.store.tenantsForCleanup(after);
    if (!tenants.length) return;
    for (const tenant of tenants) {
      if (signal.aborted) return;
      await cleanupTelemetry({ tenantId: tenant.id }, deps, now);
    }
    after = tenants.at(-1)?.id;
  }
}
