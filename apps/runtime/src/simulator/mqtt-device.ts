import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { connectAsync } from "mqtt";
import { z } from "zod";
import {
  OpenHuliCommandReceiver,
  DevicePresenceSchema,
  DeviceTelemetrySchema,
} from "@corely/contracts";
import { simulatorEndpoint, type simulatorDevice } from "./device";

/** One broker connection, new boot, bounded work. No automatic reconnect or replay. */
export async function startMqttSimulator(input: {
  endpoint: string;
  signal?: AbortSignal;
  device: ReturnType<typeof simulatorDevice>;
  intervalSeconds?: number;
  stale?: boolean;
  duplicate?: boolean;
  acknowledgementDelayMs?: number;
  onCommand?(event: {
    commandId: string;
    status: string;
    reason: string | null;
  }): void;
}) {
  if (input.signal?.aborted) throw new Error("Simulator startup cancelled");
  const endpoint = simulatorEndpoint(input.endpoint, "mqtt");
  const interval = z
    .number()
    .int()
    .min(1)
    .max(3600)
    .parse(input.intervalSeconds ?? 30);
  const delay = z
    .number()
    .int()
    .min(0)
    .max(30000)
    .parse(input.acknowledgementDelayMs ?? 0);
  const provided = input.device.mqtt;
  if (!provided)
    throw new Error(
      "Save a current MQTT pairing response or rotate the credential",
    );
  const configuration = provided;
  const deviceId = input.device.manifest.deviceId,
    bootId = randomUUID();
  const control = new AbortController(),
    pending = new Set<Promise<void>>();
  let stopped = false,
    sequence = 0,
    timer: NodeJS.Timeout | undefined,
    publishing: Promise<void> | undefined;
  const presence = (status: "online" | "offline") =>
    JSON.stringify(
      DevicePresenceSchema.parse({
        version: 1,
        messageId: randomUUID(),
        type: "device.presence",
        deviceId,
        bootId,
        sequence: status === "online" ? 0 : 1,
        status,
        sentAt: new Date().toISOString(),
      }),
    );
  const client = await connectAsync(endpoint, {
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 5000,
    rejectUnauthorized: true,
    username: configuration.username,
    password: configuration.password,
    clientId: configuration.clientId,
    will: {
      topic: configuration.topics.presence,
      payload: Buffer.from(presence("offline")),
      qos: 1,
      retain: true,
    },
    properties: { maximumPacketSize: 18000 },
  });
  function publish(
    topic: string,
    payload: string,
    options: { qos: 1; retain?: boolean },
  ) {
    return new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Simulator publish acknowledgement timed out")),
        3000,
      );
      client.publish(topic, payload, options, (error) => {
        clearTimeout(deadline);
        if (error) reject(new Error("Simulator publish failed"));
        else resolve();
      });
    });
  }
  // The transport may close after startup; handle errors without printing broker details or secrets.
  client.on("error", () => {
    stopped = true;
    clearInterval(timer);
    control.abort();
  });
  client.on("close", () => {
    stopped = true;
    clearInterval(timer);
    control.abort();
  });
  const receiver = new OpenHuliCommandReceiver(
    input.device.manifest,
    Date.now,
    () => true,
  );
  client.on("message", (topic, payload) => {
    if (
      stopped ||
      topic !== configuration.topics.commands ||
      payload.length > 16384 ||
      pending.size >= 16
    )
      return;
    const task = (async () => {
      const result = await receiver.receive(
        payload.toString("utf8"),
        async () => "succeeded",
      );
      if (delay) await pause(delay, undefined, { signal: control.signal });
      if (stopped) return;
      const wire = JSON.stringify(result);
      await publish(configuration.topics.commandResults, wire, {
        qos: 1,
      });
      if (input.duplicate)
        await publish(configuration.topics.commandResults, wire, {
          qos: 1,
        });
      input.onCommand?.({
        commandId: result.commandId,
        status: result.status,
        reason: result.status === "succeeded" ? null : result.error.code,
      });
    })()
      .catch(() => {})
      .finally(() => {
        pending.delete(task);
      });
    pending.add(task);
  });
  async function publishSample() {
    if (stopped || publishing) return publishing;
    publishing = (async () => {
      const readings = input.device.manifest.capabilities.flatMap((cap) =>
        cap.kind === "temperature"
          ? [
              {
                metric: "temperature" as const,
                value: 22,
                unit: "degC" as const,
              },
            ]
          : [],
      );
      const humidity = input.device.manifest.capabilities.some(
        (cap) => cap.kind === "humidity",
      )
        ? [{ metric: "humidity" as const, value: 55, unit: "percent" as const }]
        : [];
      if (!readings.length && !humidity.length) return;
      if (sequence >= 0xffffffff)
        throw new Error("Simulator sequence exhausted");
      const wire = JSON.stringify(
        DeviceTelemetrySchema.parse({
          version: 1,
          messageId: randomUUID(),
          type: "device.telemetry",
          deviceId,
          bootId,
          sequence: sequence++,
          sampledAt: new Date(
            Date.now() - (input.stale ? interval * 4000 : 0),
          ).toISOString(),
          readings: [...readings, ...humidity],
        }),
      );
      await publish(configuration.topics.telemetry, wire, {
        qos: 1,
      });
      if (input.duplicate)
        await publish(configuration.topics.telemetry, wire, {
          qos: 1,
        });
    })().finally(() => {
      publishing = undefined;
    });
    return publishing;
  }
  let stopping: Promise<void> | undefined;
  function stop() {
    stopping ??= (async () => {
      input.signal?.removeEventListener("abort", onAbort);
      clearInterval(timer);
      control.abort();
      const connected = !stopped && client.connected;
      stopped = true;
      if (connected)
        await publish(configuration.topics.presence, presence("offline"), {
          qos: 1,
        }).catch(() => {});
      await client.endAsync(true);
      await Promise.allSettled([
        ...pending,
        ...(publishing ? [publishing] : []),
      ]);
    })();
    return stopping;
  }
  const onAbort = () => {
    void stop().catch(() => {});
  };
  if (input.signal?.aborted) {
    await stop();
    throw new Error("Simulator startup cancelled");
  }
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const grants = await new Promise<
      Awaited<ReturnType<typeof client.subscribeAsync>>
    >((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Simulator subscription timed out")),
        3000,
      );
      client.subscribe(
        configuration.topics.commands,
        { qos: 1 },
        (error, grants) => {
          clearTimeout(deadline);
          if (error || !grants)
            reject(new Error("Simulator subscription denied"));
          else resolve(grants);
        },
      );
    });
    if (grants.some((grant) => grant.qos > 2))
      throw new Error("Simulator command subscription denied");
    if (stopped) throw new Error("Simulator stopped before subscription");
    await publish(
      configuration.topics.manifest,
      JSON.stringify(input.device.manifest),
      { qos: 1 },
    );
    await publish(configuration.topics.presence, presence("online"), {
      qos: 1,
      retain: true,
    });
    await publishSample();
    timer = setInterval(() => {
      void publishSample()?.catch(() => {
        void stop().catch(() => {});
      });
    }, interval * 1000);
    return { bootId, publishSample, stop };
  } catch {
    await stop();
    throw new Error("MQTT simulator startup failed");
  }
}
