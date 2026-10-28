import { randomUUID } from "node:crypto";
import { connect, type MqttClient } from "mqtt";
import { OPENHULI_MAX_JSON_BYTES } from "@corely/contracts";
import {
  cleanupAllTelemetry,
  ingestBrokerMessage,
  type TelemetryDependencies,
} from "@corely/modules-telemetry";
import { createMqttAuthBridge } from "./mqtt-auth-bridge";
import type { RuntimeConfig } from "./config";
import type { RuntimeDependency } from "./ports";

export function createTelemetryMqttDependency(
  config: RuntimeConfig,
  services: { telemetry: TelemetryDependencies; close(): Promise<void> },
): RuntimeDependency {
  const url = config.RUNTIME_MQTT_URL,
    username = config.RUNTIME_MQTT_USERNAME,
    password = config.RUNTIME_MQTT_PASSWORD;
  if (!url || !username || !password)
    throw new Error("MQTT backend credentials are required");
  const bridge = createMqttAuthBridge(
    config,
    services.telemetry.devices,
    (input) => ingestBrokerMessage(input, services.telemetry),
  );
  let client: MqttClient | undefined,
    ready = false,
    maintenanceHealthy = true,
    stopped = false,
    started = false;
  let pumping: Promise<void> | undefined,
    maintenance: Promise<void> | undefined,
    stopping: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  const abort = new AbortController();
  const queue: {
    identity: string;
    topic: string;
    payload: string;
    retained: boolean;
    epoch: string;
  }[] = [];
  function pump() {
    if (pumping || stopped) return;
    pumping = (async () => {
      while (queue.length && !stopped) {
        const message = queue.shift();
        if (!message) break;
        try {
          await ingestBrokerMessage(message, {
            ...services.telemetry,
            epoch: message.epoch,
          });
        } catch {
          console.warn(JSON.stringify({ event: "mqtt.message.rejected" }));
        }
      }
    })().finally(() => {
      pumping = undefined;
    });
  }
  function cleanup() {
    if (maintenance || stopped) return;
    maintenance = cleanupAllTelemetry(services.telemetry, abort.signal)
      .then(() => {
        maintenanceHealthy = true;
      })
      .catch(() => {
        maintenanceHealthy = false;
        console.warn(JSON.stringify({ event: "mqtt.retention.failed" }));
      })
      .finally(() => {
        maintenance = undefined;
      });
  }
  async function stop() {
    stopping ??= (async () => {
      stopped = true;
      ready = false;
      abort.abort();
      clearInterval(timer);
      queue.length = 0;
      await client?.endAsync(true);
      await Promise.all([pumping, maintenance]);
      if (started) await bridge.stop();
      await services.close();
    })();
    return stopping;
  }
  return {
    name: "mqtt",
    isReady: () =>
      ready && maintenanceHealthy && !stopped && Boolean(client?.connected),
    stop,
    async start(signal) {
      if (stopped || started || signal.aborted)
        throw new Error("Telemetry startup cancelled or repeated");
      await bridge.start();
      started = true;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          reject(new Error("Telemetry startup cancelled"));
          void stop().catch(() => {});
        };
        signal.addEventListener("abort", onAbort, { once: true });
        client = connect(url, {
          clientId: `openhuli-${randomUUID()}`,
          username,
          password,
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 1000,
          rejectUnauthorized: true,
          connectTimeout: config.RUNTIME_STARTUP_TIMEOUT_MS,
          properties: { maximumPacketSize: 18000 },
        });
        client.on("connect", () => {
          if (stopped) return;
          void client
            ?.subscribeAsync(
              ["telemetry", "manifest"].map(
                (kind) => `openhuli/v1/devices/+/${kind}`,
              ),
              { qos: 1 },
            )
            .then((grants) => {
              if (!grants || grants.some((grant) => grant.qos > 2))
                throw new Error("MQTT subscription denied");
              if (!stopped) {
                ready = true;
                resolve();
              }
            })
            .catch(() => {
              ready = false;
              reject(new Error("MQTT subscription failed"));
            });
        });
        for (const event of ["error", "offline", "close", "reconnect"] as const)
          client.on(event, () => {
            ready = false;
            services.telemetry.epoch = randomUUID();
          });
        client.on("message", (topic, payload, packet) => {
          const identity =
            packet.properties?.userProperties?.["openhuli-identity"];
          if (
            stopped ||
            typeof identity !== "string" ||
            payload.length > OPENHULI_MAX_JSON_BYTES ||
            queue.length >= 64
          ) {
            console.warn(JSON.stringify({ event: "mqtt.message.rejected" }));
            return;
          }
          queue.push({
            identity,
            topic,
            payload: payload.toString("utf8"),
            retained: packet.retain,
            epoch: services.telemetry.epoch,
          });
          pump();
        });
        if (signal.aborted) onAbort();
      });
      cleanup();
      timer = setInterval(cleanup, 3600_000);
      timer.unref();
    },
  };
}
