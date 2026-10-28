import {
  deviceMqttIdentity,
  deviceMqttClientId,
  parseDeviceMqttIdentity,
} from "./device-mqtt-identity";
import {
  authenticateScopedDevice,
  authorizeDeviceMqtt,
  revalidateDeviceSession,
} from "./device-access.use-cases";
import type { DeviceAccessStore } from "./device-access.types";

export async function authenticateDeviceMqtt(
  input: { username: string; password: string; clientId: string },
  store: DeviceAccessStore,
) {
  const session = await authenticateScopedDevice(input.password, "mqtt", store);
  if (
    deviceMqttIdentity({
      tenantId: session.tenantId,
      deviceId: session.deviceId,
      credentialId: session.credentialId,
    }) !== input.username ||
    deviceMqttClientId(session.credentialId) !== input.clientId
  )
    throw new Error("MQTT identity mismatch");
  return session;
}
/** Called only by the authenticated private broker bridge, after broker CONNECT authentication. */
export async function authorizeDeviceMqttClient(
  input: { username: string; clientId: string; topic: string; access: number },
  store: DeviceAccessStore,
) {
  const session = parseDeviceMqttIdentity(input.username);
  if (input.clientId !== deviceMqttClientId(session.credentialId))
    throw new Error("MQTT client mismatch");
  if (![1, 2, 4, 8].includes(input.access))
    throw new Error("Unsupported MQTT access");
  await revalidateDeviceSession(session, store);
  return authorizeDeviceMqtt(
    session,
    input.access === 2 ? "publish" : "subscribe",
    input.topic,
    store,
  );
}

export * from "./device-mqtt-identity";
