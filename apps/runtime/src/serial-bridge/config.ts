import { open } from "node:fs/promises";
import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  OpenHuliIdSchema,
} from "@corely/contracts";
import {
  parseDeviceMqttIdentity,
  deviceMqttClientId,
  deviceMqttTopics,
} from "@corely/modules-devices";
export async function privateFile(path: string, maximum = 16384) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > maximum ||
      (process.platform !== "win32" && info.mode & 0o077)
    )
      throw new Error("Private configuration permissions or size invalid");
    const bytes = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximum) throw new Error("Private configuration too large");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
const Provisioning = z.object({
  device: z.object({
    id: OpenHuliIdSchema,
    capabilities: DeviceCapabilityManifestSchema.shape.capabilities,
  }),
  credentials: z
    .array(
      z.object({
        purpose: z.enum(["voice", "mqtt"]),
        credentialId: OpenHuliIdSchema,
        token: z.string().min(1).max(2048),
        mqttUsername: z.string().max(512).optional(),
        mqttClientId: z.string().max(128).optional(),
      }),
    )
    .min(1)
    .max(2),
});
export function bridgeDevice(value: unknown) {
  const paired = Provisioning.parse(value),
    credential = paired.credentials.find((c) => c.purpose === "mqtt");
  if (!credential?.mqttUsername || !credential.mqttClientId)
    throw new Error("Provisioned MQTT identity required");
  const identity = parseDeviceMqttIdentity(credential.mqttUsername);
  if (
    identity.deviceId !== paired.device.id ||
    identity.credentialId !== credential.credentialId ||
    credential.mqttClientId !== deviceMqttClientId(identity.credentialId)
  )
    throw new Error("Device identity mismatch");
  const caps = paired.device.capabilities;
  if (
    !caps.some((c) => c.kind === "ping") ||
    caps.some(
      (c) =>
        !["ping", "temperature", "humidity", "display"].includes(c.kind) ||
        (c.kind === "display" && c.maxTextLength > 32),
    )
  )
    throw new Error("Unsupported serial capabilities");
  const display = caps.find((c) => c.kind === "display");
  return {
    deviceId: identity.deviceId,
    username: credential.mqttUsername,
    clientId: credential.mqttClientId,
    token: credential.token,
    topics: deviceMqttTopics(identity.tenantId, identity.deviceId),
    capabilities: caps,
    sensors:
      (caps.some((c) => c.kind === "temperature") ? 1 : 0) |
      (caps.some((c) => c.kind === "humidity") ? 2 : 0),
    display: display?.kind === "display" ? display.maxTextLength : 0,
  };
}
export function brokerEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "mqtts:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== "/")
  )
    throw new Error("Verified MQTT TLS endpoint required");
  return url.href;
}
