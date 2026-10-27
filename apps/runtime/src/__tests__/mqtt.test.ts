import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { readRuntimeConfig } from "../config";
import {
  createMqttDependency,
  type MqttConnector,
  type MqttConnection,
} from "../mqtt";

class FakeBroker extends EventEmitter implements MqttConnection {
  connected = false;
  endAsync = vi.fn(async () => {
    this.connected = false;
    this.emit("end");
  });
  connect() {
    this.connected = true;
    this.emit("connect");
  }
}

describe("MQTT connection adapter", () => {
  it("tracks connection, outage, recovery, and closes without reconnecting on shutdown", async () => {
    const broker = new FakeBroker();
    const connector = vi.fn(() => broker);
    const dependency = createMqttDependency(
      readRuntimeConfig({ RUNTIME_MQTT_URL: "mqtt://localhost:1883" }),
      connector,
    );
    const controller = new AbortController();
    const startup = dependency.start(controller.signal);
    expect(dependency.isReady()).toBe(false);
    broker.connect();
    await startup;
    expect(dependency.isReady()).toBe(true);
    for (const event of ["offline", "error", "reconnect", "close"]) {
      broker.emit(event);
      expect(dependency.isReady()).toBe(false);
      broker.connect();
      expect(dependency.isReady()).toBe(true);
    }
    const options = connector.mock.calls[0];
    expect(options).toBeDefined();
    await dependency.stop();
    await dependency.stop();
    expect(broker.endAsync).toHaveBeenCalledTimes(1);
    expect(broker.endAsync).toHaveBeenCalledWith(true);
    expect(dependency.isReady()).toBe(false);
    broker.connect();
    expect(dependency.isReady()).toBe(false);
  });
  it("uses TLS verification and bounds incoming packets", async () => {
    const broker = new FakeBroker();
    const connector = vi.fn<MqttConnector>(() => broker);
    const config = readRuntimeConfig({
      NODE_ENV: "production",
      RUNTIME_MQTT_URL: "mqtts://broker.example.com",
      RUNTIME_MQTT_USERNAME: "runtime",
      RUNTIME_MQTT_PASSWORD: "synthetic-only",
    });
    const dependency = createMqttDependency(config, connector);
    const started = dependency.start(new AbortController().signal);
    broker.connect();
    await started;
    expect(connector).toHaveBeenCalledWith(
      config.RUNTIME_MQTT_URL,
      expect.objectContaining({
        rejectUnauthorized: true,
        clean: true,
        protocolVersion: 5,
        username: "runtime",
        password: "synthetic-only",
        properties: { maximumPacketSize: 16_384 },
      }),
    );
    await dependency.stop();
  });
  it("cancels pending startup and releases the broker connection", async () => {
    const broker = new FakeBroker();
    const dependency = createMqttDependency(
      readRuntimeConfig({ RUNTIME_MQTT_URL: "mqtt://localhost:1883" }),
      () => broker,
    );
    const controller = new AbortController();
    const startup = dependency.start(controller.signal);
    controller.abort();
    await expect(startup).rejects.toThrow(/cancelled/);
    await dependency.stop();
    expect(broker.endAsync).toHaveBeenCalledTimes(1);
    expect(dependency.isReady()).toBe(false);
  });
});
