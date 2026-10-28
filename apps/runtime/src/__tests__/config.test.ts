import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../config";

const secret = "synthetic_test_token_12345678901234567890";

describe("runtime configuration", () => {
  it("defaults to loopback without broker, provider, or probe authorization", () => {
    const config = readRuntimeConfig({});
    expect(config.RUNTIME_HOST).toBe("127.0.0.1");
    expect(config.RUNTIME_PORT).toBe(3200);
    expect(config.RUNTIME_MQTT_URL).toBeUndefined();
    expect(config.RUNTIME_PROBE_TOKEN).toBeUndefined();
    expect(
      readRuntimeConfig({ RUNTIME_PROBE_TOKEN: "", RUNTIME_MQTT_URL: "" })
        .RUNTIME_MQTT_URL,
    ).toBeUndefined();
  });
  it("accepts bounded settings and explicit secure broker credentials", () => {
    expect(
      readRuntimeConfig({
        NODE_ENV: "production",
        RUNTIME_HOST: "0.0.0.0",
        RUNTIME_PORT: "3201",
        RUNTIME_PROBE_TOKEN: secret,
        RUNTIME_MQTT_URL: "mqtts://broker.example.com:8883",
        RUNTIME_MQTT_USERNAME: "runtime",
        RUNTIME_MQTT_PASSWORD: secret,
      }).RUNTIME_PORT,
    ).toBe(3201);
    expect(
      readRuntimeConfig({ RUNTIME_MQTT_URL: "mqtt://127.0.0.1:1883" })
        .RUNTIME_MQTT_URL,
    ).toBeDefined();
  });
  it.each([
    { RUNTIME_VOICE_ENABLED: "yes" },
    { RUNTIME_MQTT_TELEMETRY_ENABLED: "true" },
    { RUNTIME_MQTT_AUTH_TOKEN: "short" },
    { RUNTIME_TELEMETRY_INTERVAL_SECONDS: "0" },
    { RUNTIME_TELEMETRY_RETENTION_DAYS: "31" },
    { RUNTIME_MQTT_AUTH_HOST: "broker.example.com" },
    { RUNTIME_VOICE_QUEUE_BYTES: "663" },
    { RUNTIME_VOICE_QUEUE_MESSAGES: "0" },
    { RUNTIME_VOICE_BUFFERED_BYTES: "0" },
    { RUNTIME_VOICE_TURN_TIMEOUT_MS: "30001" },
    { RUNTIME_VOICE_SESSION_TIMEOUT_MS: "0" },
    { RUNTIME_VOICE_ENABLED: "true", DATABASE_URL: "not-a-database" },
    { RUNTIME_PORT: "NaN" },
    { RUNTIME_PORT: "65536" },
    { RUNTIME_PORT: "-1" },
    { RUNTIME_HOST: "broker.example.com" },
    { RUNTIME_PROBE_TOKEN: "short" },
    { RUNTIME_STARTUP_TIMEOUT_MS: "0" },
    { RUNTIME_SHUTDOWN_TIMEOUT_MS: "31000" },
    { RUNTIME_IDLE_TIMEOUT_MS: "0" },
    { RUNTIME_MAX_CONNECTIONS: "0" },
    { RUNTIME_MQTT_URL: "https://broker.example.com" },
    { RUNTIME_MQTT_URL: "mqtt://broker.example.com:1883" },
    { NODE_ENV: "production", RUNTIME_MQTT_URL: "mqtt://localhost:1883" },
    { RUNTIME_MQTT_URL: `mqtts://user:${secret}@broker.example.com` },
    { RUNTIME_MQTT_URL: `mqtts://broker.example.com?password=${secret}` },
    { RUNTIME_MQTT_USERNAME: "runtime" },
    { RUNTIME_MQTT_PASSWORD: secret },
    {
      RUNTIME_MQTT_URL: "mqtts://broker.example.com",
      RUNTIME_MQTT_USERNAME: "runtime",
    },
  ])("rejects invalid configuration without echoing its values: %j", (env) => {
    let error: unknown;
    try {
      readRuntimeConfig(env);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Invalid runtime configuration");
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain("broker.example.com");
  });
});
