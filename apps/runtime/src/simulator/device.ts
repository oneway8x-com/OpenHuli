import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  OpenHuliIdSchema,
} from "@corely/contracts";
import {
  deviceMqttClientId,
  deviceMqttIdentity,
  deviceMqttTopics,
  parseDeviceMqttIdentity,
} from "@corely/modules-devices";

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
/** Read a locally saved one-time pairing response. This is client configuration, never server authority. */
export function simulatorDevice(value: unknown, withoutDisplay = false) {
  const paired = Provisioning.parse(value);
  const manifest = DeviceCapabilityManifestSchema.parse({
    version: 1,
    messageId: randomUUID(),
    type: "device.manifest",
    deviceId: paired.device.id,
    firmwareVersion: "openhuli-simulator-v1",
    capabilities: paired.device.capabilities.filter(
      (cap) => !withoutDisplay || cap.kind !== "display",
    ),
  });
  const mqtt = paired.credentials.find(
    (credential) => credential.purpose === "mqtt",
  );
  let transport;
  if (mqtt?.mqttUsername) {
    const identity = parseDeviceMqttIdentity(mqtt.mqttUsername);
    if (
      identity.deviceId !== paired.device.id ||
      identity.credentialId !== mqtt.credentialId ||
      deviceMqttIdentity(identity) !== mqtt.mqttUsername ||
      mqtt.mqttClientId !== deviceMqttClientId(identity.credentialId)
    )
      throw new Error("Mismatched simulator MQTT identity");
    transport = {
      username: mqtt.mqttUsername,
      clientId: mqtt.mqttClientId,
      password: mqtt.token,
      topics: deviceMqttTopics(identity.tenantId, identity.deviceId),
    };
  }
  return {
    manifest,
    voiceToken: paired.credentials.find(
      (credential) => credential.purpose === "voice",
    )?.token,
    mqtt: transport,
  };
}
export function simulatorEndpoint(value: string, kind: "voice" | "mqtt") {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (kind === "voice"
      ? url.pathname !== "/voice" ||
        !(url.protocol === "wss:" || (url.protocol === "ws:" && local))
      : (url.pathname !== "" && url.pathname !== "/") ||
        !(url.protocol === "mqtts:" || (url.protocol === "mqtt:" && local)))
  )
    throw new Error("Use verified TLS or a loopback simulator endpoint");
  return url.href;
}
