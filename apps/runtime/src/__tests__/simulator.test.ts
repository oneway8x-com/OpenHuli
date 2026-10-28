import { describe, expect, it } from "vitest";
import { simulatorDevice, simulatorEndpoint } from "../simulator/device";
import {
  deviceMqttIdentity,
  deviceMqttClientId,
} from "@corely/modules-devices";
import { OPENHULI_PCM_FORMAT } from "@corely/contracts";
const reference = {
  tenantId: "tenant",
  deviceId: "device",
  credentialId: "credential",
};
const configuration = {
  device: {
    id: "device",
    capabilities: [
      { kind: "microphone", format: OPENHULI_PCM_FORMAT },
      { kind: "display", maxTextLength: 64 },
      { kind: "ping" },
    ],
  },
  credentials: [
    { purpose: "voice", credentialId: "voice", token: "synthetic-voice" },
    {
      purpose: "mqtt",
      credentialId: "credential",
      token: "synthetic-mqtt",
      mqttUsername: deviceMqttIdentity(reference),
      mqttClientId: deviceMqttClientId("credential"),
    },
  ],
};
describe("simulator boundary", () => {
  it("reads actual pairing fields, keeps purpose-specific tokens and reproduces unsupported display", () => {
    const device = simulatorDevice(configuration, true);
    expect(device.voiceToken).toBe("synthetic-voice");
    expect(device.mqtt?.password).toBe("synthetic-mqtt");
    expect(
      device.manifest.capabilities.some((cap) => cap.kind === "display"),
    ).toBe(false);
    expect(device.mqtt?.topics.commands).toBe(
      "openhuli/v1/devices/device/commands",
    );
    expect(() =>
      simulatorDevice({
        ...configuration,
        device: { ...configuration.device, id: "other" },
      }),
    ).toThrow("identity");
  });
  it.each([
    "ws://example.com/voice",
    "wss://user:secret@example.com/voice",
    "wss://example.com/voice?token=x",
    "https://example.com/voice",
    "wss://example.com/other",
  ])("rejects an unverified voice destination: %s", (url) =>
    expect(() => simulatorEndpoint(url, "voice")).toThrow(),
  );
  it.each([
    "mqtt://example.com",
    "mqtts://user:secret@example.com",
    "mqtts://example.com/topic",
  ])("rejects an unsafe broker destination: %s", (url) =>
    expect(() => simulatorEndpoint(url, "mqtt")).toThrow(),
  );
  it("permits verified TLS and development loopback endpoints", () => {
    expect(simulatorEndpoint("wss://example.com/voice", "voice")).toBe(
      "wss://example.com/voice",
    );
    expect(simulatorEndpoint("mqtt://127.0.0.1:1884", "mqtt")).toBe(
      "mqtt://127.0.0.1:1884",
    );
  });
});
