import { randomUUID } from "node:crypto";
import { connect, type IClientOptions } from "mqtt";
import { OPENHULI_MAX_JSON_BYTES } from "@corely/contracts";
import type { RuntimeConfig } from "./config";
import type { RuntimeDependency } from "./ports";

export interface MqttConnection {
  readonly connected: boolean;
  on(
    event: "connect" | "close" | "offline" | "reconnect" | "error" | "end",
    listener: () => void,
  ): this;
  endAsync(force: boolean): Promise<void>;
}
export type MqttConnector = (
  url: string,
  options: IClientOptions,
) => MqttConnection;

export function createMqttDependency(
  config: RuntimeConfig,
  connector: MqttConnector = connect,
): RuntimeDependency {
  if (!config.RUNTIME_MQTT_URL) throw new Error("MQTT is not configured");
  const url = config.RUNTIME_MQTT_URL;
  let client: MqttConnection | undefined;
  let ready = false;
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopped = true;
    ready = false;
    stopping ??= client?.endAsync(true) ?? Promise.resolve();
    return stopping;
  };
  return {
    name: "mqtt",
    isReady: () => !stopped && ready && Boolean(client?.connected),
    start: (signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted || stopped || client) {
          reject(new Error("MQTT startup cancelled or repeated"));
          return;
        }
        client = connector(url, {
          clientId: `openhuli-${randomUUID()}`,
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 1000,
          connectTimeout: config.RUNTIME_STARTUP_TIMEOUT_MS,
          rejectUnauthorized: true,
          properties: { maximumPacketSize: OPENHULI_MAX_JSON_BYTES },
          ...(config.RUNTIME_MQTT_USERNAME && config.RUNTIME_MQTT_PASSWORD
            ? {
                username: config.RUNTIME_MQTT_USERNAME,
                password: config.RUNTIME_MQTT_PASSWORD,
              }
            : {}),
        });
        const abort = () => {
          signal.removeEventListener("abort", abort);
          reject(new Error("MQTT startup cancelled"));
          void stop().catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        client.on("connect", () => {
          if (stopped || signal.aborted) return;
          ready = true;
          resolve();
        });
        for (const event of [
          "close",
          "offline",
          "reconnect",
          "error",
          "end",
        ] as const) {
          client.on(event, () => {
            ready = false;
          });
        }
      }),
    stop,
  };
}
