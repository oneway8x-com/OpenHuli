import {
  DeviceAccessReferenceSchema,
  OpenHuliIdSchema,
} from "@corely/contracts";
import type { DeviceSession } from "./device-access.types";

/** Public reference only, never a bearer credential. The broker attests this on forwarded packets. */
export function deviceMqttIdentity(
  session: Pick<DeviceSession, "tenantId" | "deviceId" | "credentialId">,
) {
  return `ohm1.${Buffer.from(JSON.stringify(DeviceAccessReferenceSchema.parse({ tenantId: session.tenantId, deviceId: session.deviceId, credentialId: session.credentialId }))).toString("base64url")}`;
}
export function parseDeviceMqttIdentity(username: string): DeviceSession {
  if (!username.startsWith("ohm1.") || username.length > 512)
    throw new Error("Invalid MQTT identity");
  const header = username.slice(5),
    bytes = Buffer.from(header, "base64url");
  if (bytes.toString("base64url") !== header)
    throw new Error("Invalid MQTT identity");
  const reference = DeviceAccessReferenceSchema.parse(
    JSON.parse(bytes.toString("utf8")),
  );
  return {
    tenantId: OpenHuliIdSchema.parse(reference.tenantId),
    deviceId: OpenHuliIdSchema.parse(reference.deviceId),
    credentialId: OpenHuliIdSchema.parse(reference.credentialId),
    purpose: "mqtt",
  };
}
export function deviceMqttClientId(credentialId: string) {
  return `openhuli-device-${OpenHuliIdSchema.parse(credentialId)}`;
}
