import { randomUUID } from "node:crypto";
import {
  AssignDeviceGrantSchema,
  DevicePurposeSchema,
  OpenHuliIdSchema,
  PairDeviceSchema,
  RotateDeviceSecretSchema,
  type DevicePurpose,
} from "@corely/contracts";
import { z } from "zod";
import { DeviceAccessError } from "./device-access.errors";
import {
  validateDeviceAdvertisement,
  validateDeviceProfile,
} from "./device-profiles";
import {
  createDeviceSecret,
  matchesDeviceSecret,
  parseDeviceSecret,
} from "./device-secrets";
import type {
  DeviceAccessStore,
  DeviceSession,
  StoredAccessDevice,
} from "./device-access.types";

export const DEVICE_CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export type OwnerDeviceContext = { tenantId: string; userId: string };
const notFound = () => new DeviceAccessError(404, "Device not found");
async function requireActive(
  tenantId: string,
  deviceId: string,
  store: DeviceAccessStore,
) {
  const device = await store.findDevice(
    tenantId,
    OpenHuliIdSchema.parse(deviceId),
  );
  if (!device || device.status !== "active" || !device.configurationJson)
    throw notFound();
  return device;
}
function configuration(device: StoredAccessDevice) {
  if (!device.configurationJson) throw notFound();
  return PairDeviceSchema.parse(JSON.parse(device.configurationJson));
}
function deviceDto(device: StoredAccessDevice) {
  const config = configuration(device);
  return { ...config, id: device.id, status: device.status };
}
function newCredential(
  tenantId: string,
  deviceId: string,
  purpose: DevicePurpose,
  now: Date,
) {
  const generated = createDeviceSecret(tenantId, deviceId);
  return {
    stored: {
      id: generated.credentialId,
      purpose,
      secretHash: generated.secretHash,
      expiresAt: new Date(now.getTime() + DEVICE_CREDENTIAL_LIFETIME_MS),
    },
    issued: {
      credentialId: generated.credentialId,
      purpose,
      token: generated.token,
      expiresAt: new Date(
        now.getTime() + DEVICE_CREDENTIAL_LIFETIME_MS,
      ).toISOString(),
    },
  };
}
export function deviceMqttTopics(tenantId: string, deviceId: string) {
  OpenHuliIdSchema.parse(tenantId);
  OpenHuliIdSchema.parse(deviceId);
  const root = `openhuli/v1/devices/${deviceId}`;
  return {
    manifest: `${root}/manifest`,
    telemetry: `${root}/telemetry`,
    commandResults: `${root}/results`,
    commands: `${root}/commands`,
  };
}
export async function pairOwnerDevice(
  value: unknown,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
  now = new Date(),
) {
  const config = validateDeviceProfile(value);
  const deviceId = randomUUID();
  const purposes: DevicePurpose[] = config.capabilities.some(
    (cap) => cap.kind === "microphone",
  )
    ? ["voice", "mqtt"]
    : ["mqtt"];
  const credentials = purposes.map((purpose) =>
    newCredential(context.tenantId, deviceId, purpose, now),
  );
  const device = await store.pair(
    context.tenantId,
    deviceId,
    config,
    credentials.map((item) => item.stored),
  );
  return {
    device: deviceDto(device),
    credentials: credentials.map((item) => item.issued),
    mqtt: deviceMqttTopics(context.tenantId, deviceId),
  };
}
export async function listOwnerDevices(
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
) {
  // Legacy persistence-only records have no validated owner configuration and cannot be provisioned.
  return (await store.listDevices(context.tenantId))
    .filter((device) => device.configurationJson)
    .map(deviceDto);
}
export async function getOwnerDevice(
  deviceId: string,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
) {
  const device = await store.findDevice(
    context.tenantId,
    OpenHuliIdSchema.parse(deviceId),
  );
  if (!device || !device.configurationJson) throw notFound();
  return {
    device: deviceDto(device),
    credentials: await store.credentials(context.tenantId, deviceId),
    grants: (await store.grants(context.tenantId, deviceId)).map((grant) => ({
      toolId: grant.toolId,
      targetDeviceIds: z
        .array(OpenHuliIdSchema)
        .parse(JSON.parse(grant.targetDeviceIdsJson)),
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
    })),
    mqtt: deviceMqttTopics(context.tenantId, deviceId),
  };
}
export async function rotateOwnerDeviceSecret(
  deviceId: string,
  value: unknown,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
  now = new Date(),
) {
  const input = RotateDeviceSecretSchema.parse(value);
  const device = await requireActive(context.tenantId, deviceId, store);
  if (
    input.purpose === "voice" &&
    !configuration(device).capabilities.some((cap) => cap.kind === "microphone")
  )
    throw new DeviceAccessError(
      403,
      "Device has no owner-configured microphone",
    );
  const replacement = newCredential(
    context.tenantId,
    deviceId,
    input.purpose,
    now,
  );
  if (
    !(await store.rotateCredential(
      context.tenantId,
      deviceId,
      input.credentialId,
      replacement.stored,
      now,
    ))
  )
    throw new DeviceAccessError(409, "Credential is no longer current");
  return replacement.issued;
}
export async function revokeOwnerDeviceSecret(
  deviceId: string,
  credentialId: string,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
  now = new Date(),
) {
  await requireActive(context.tenantId, deviceId, store);
  if (
    !(await store.revokeCredential(
      context.tenantId,
      deviceId,
      OpenHuliIdSchema.parse(credentialId),
      now,
    ))
  )
    throw new DeviceAccessError(404, "Credential not found");
}
export async function deactivateOwnerDevice(
  deviceId: string,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
  now = new Date(),
) {
  if (
    !(await store.deactivateDevice(
      context.tenantId,
      OpenHuliIdSchema.parse(deviceId),
      now,
    ))
  )
    throw notFound();
}
export async function revalidateDeviceSession(
  session: DeviceSession,
  store: DeviceAccessStore,
  now = new Date(),
): Promise<DeviceSession> {
  const credential = await store.findCredential(
    session.tenantId,
    session.credentialId,
  );
  if (
    !credential ||
    credential.tenantId !== session.tenantId ||
    credential.deviceId !== session.deviceId ||
    credential.purpose !== session.purpose ||
    credential.revokedAt ||
    credential.expiresAt <= now
  )
    throw new DeviceAccessError(401, "Device credential is expired or revoked");
  await requireActive(session.tenantId, session.deviceId, store);
  return session;
}
export async function authenticateScopedDevice(
  token: string,
  purpose: DevicePurpose,
  store: DeviceAccessStore,
  now = new Date(),
): Promise<DeviceSession> {
  DevicePurposeSchema.parse(purpose);
  const claimed = parseDeviceSecret(token);
  const credential = await store.findCredential(
    claimed.tenantId,
    claimed.credentialId,
  );
  if (
    !credential ||
    credential.deviceId !== claimed.deviceId ||
    !matchesDeviceSecret(credential.secretHash, claimed.secretHash)
  )
    throw new DeviceAccessError(401, "Invalid device credential");
  const session = {
    tenantId: claimed.tenantId,
    deviceId: claimed.deviceId,
    credentialId: claimed.credentialId,
    purpose,
  };
  return revalidateDeviceSession(session, store, now);
}
export async function registerPairedManifest(
  value: unknown,
  token: string,
  store: DeviceAccessStore,
  now = new Date(),
) {
  const session = await authenticateScopedDevice(token, "mqtt", store, now);
  const device = await requireActive(session.tenantId, session.deviceId, store);
  const manifest = validateDeviceAdvertisement(
    value,
    session.deviceId,
    configuration(device),
  );
  if (!(await store.saveManifest(session.tenantId, session.deviceId, manifest)))
    throw notFound();
  return { deviceId: session.deviceId, capabilities: manifest.capabilities };
}
export async function authorizeDeviceMqtt(
  session: DeviceSession,
  action: "publish" | "subscribe",
  topic: string,
  store: DeviceAccessStore,
  now = new Date(),
) {
  await revalidateDeviceSession(session, store, now);
  if (session.purpose !== "mqtt")
    throw new DeviceAccessError(403, "MQTT credential required");
  const allowed = deviceMqttTopics(session.tenantId, session.deviceId);
  z.enum(["publish", "subscribe"]).parse(action);
  const valid =
    action === "subscribe"
      ? topic === allowed.commands
      : topic === allowed.telemetry ||
        topic === allowed.commandResults ||
        topic === allowed.manifest;
  if (!valid) throw new DeviceAccessError(403, "MQTT topic is not permitted");
  return session;
}
export async function assignOwnerDeviceGrant(
  deviceId: string,
  value: unknown,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
  now = new Date(),
) {
  const grant = AssignDeviceGrantSchema.parse(value);
  await requireActive(context.tenantId, deviceId, store);
  const expiresAt = new Date(grant.expiresAt);
  if (
    expiresAt <= now ||
    expiresAt.getTime() - now.getTime() > 365 * 24 * 60 * 60 * 1000
  )
    throw new DeviceAccessError(400, "Grant expiry must be within one year");
  for (const target of grant.targetDeviceIds)
    await requireActive(context.tenantId, target, store);
  await store.assignGrant(
    context.tenantId,
    deviceId,
    grant.toolId,
    grant.targetDeviceIds,
    expiresAt,
  );
}
export async function revokeOwnerDeviceGrant(
  deviceId: string,
  toolId: string,
  context: OwnerDeviceContext,
  store: DeviceAccessStore,
  now = new Date(),
) {
  await requireActive(context.tenantId, deviceId, store);
  await store.revokeGrant(
    context.tenantId,
    deviceId,
    OpenHuliIdSchema.parse(toolId),
    now,
  );
}
export async function authorizePairedDeviceTool(
  session: DeviceSession,
  toolId: string,
  targetDeviceId: string | null,
  store: DeviceAccessStore,
  now = new Date(),
) {
  await revalidateDeviceSession(session, store, now);
  const grant = await store.findGrant(
    session.tenantId,
    session.deviceId,
    OpenHuliIdSchema.parse(toolId),
    now,
  );
  if (!grant) throw new DeviceAccessError(403, "Device tool grant required");
  const targets = z
    .array(OpenHuliIdSchema)
    .parse(JSON.parse(grant.targetDeviceIdsJson));
  if (targetDeviceId === null && targets.length > 0)
    throw new DeviceAccessError(403, "Target device is required");
  if (targetDeviceId !== null) {
    if (!targets.includes(targetDeviceId))
      throw new DeviceAccessError(403, "Target device is not granted");
    await requireActive(session.tenantId, targetDeviceId, store);
  }
  return session;
}
