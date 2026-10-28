import { SerialPort } from "serialport";
import { connectAsync } from "mqtt";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  DeviceCapabilityManifestSchema,
  DevicePresenceSchema,
  DeviceTelemetrySchema,
  type DeviceTelemetry,
} from "@corely/contracts";
import { bridgeDevice, brokerEndpoint, privateFile } from "./config";
import { openFence } from "./fence";
import { SerialLink, type LocalSample } from "./link";
import { BridgeCommands } from "./commands";
async function bounded<T>(task: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Transport timeout")),
          3000,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
export async function runBridge(options: {
  port: string;
  config: string;
  mqtt: string;
  state: string;
  ca?: string;
  baud: number;
  signal?: AbortSignal;
}) {
  if (
    !Number.isInteger(options.baud) ||
    options.baud < 1200 ||
    options.baud > 115200
  )
    throw new Error("Invalid baud");
  const device = bridgeDevice(JSON.parse(await privateFile(options.config))),
    endpoint = brokerEndpoint(options.mqtt);
  const fence = await openFence(options.state, device.deviceId);
  const serial = new SerialPort({
    path: options.port,
    baudRate: options.baud,
    autoOpen: false,
    lock: true,
    highWaterMark: 4096,
  });
  const boot = randomUUID(),
    manifest = DeviceCapabilityManifestSchema.parse({
      version: 1,
      type: "device.manifest",
      messageId: randomUUID(),
      deviceId: device.deviceId,
      firmwareVersion: "serial-bridge-v1",
      capabilities: device.capabilities,
    });
  let closing = false,
    outputPending = false,
    online = false,
    floor = Math.max(Date.now(), fence.until),
    sampleBusy = false;
  let mqtt: Awaited<ReturnType<typeof connectAsync>> | undefined;
  let timer: NodeJS.Timeout | undefined;
  const inFlight = new Set<Promise<unknown>>();
  let presenceSequence = 0,
    presenceAt = 0;
  let fatal: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    fatal = resolve;
  });
  let failure = false;
  const fail = () => {
    if (!closing) {
      failure = true;
      stop();
    }
  };
  const stop = () => {
    closing = true;
    fatal?.();
  };
  const presence = (isOnline: boolean) =>
    JSON.stringify(
      DevicePresenceSchema.parse({
        version: 1,
        type: "device.presence",
        messageId: `${boot}-${isOnline ? ++presenceSequence : 0xffffffff}`,
        deviceId: device.deviceId,
        bootId: boot,
        sequence: isOnline ? presenceSequence : 0xffffffff,
        status: isOnline ? "online" : "offline",
        sentAt: new Date().toISOString(),
      }),
    );
  async function publish(topic: string, wire: string, retain = false) {
    const client = mqtt;
    if (!client?.connected || closing) throw new Error("Broker unavailable");
    await bounded(client.publishAsync(topic, wire, { qos: 0, retain }));
  }
  const link = new SerialLink({
    now: Date.now,
    monotonic: () => performance.now(),
    sensors: device.sensors,
    display: device.display,
    write(bytes) {
      if (closing || !serial.isOpen || outputPending) return false;
      outputPending = true;
      serial.write(bytes, (error) => {
        if (error) {
          outputPending = false;
          stop();
          return;
        }
        serial.drain((error) => {
          outputPending = false;
          if (error) stop();
        });
      });
      return true;
    },
    state(connected) {
      if (!connected) {
        if (online) stop();
        return;
      }
      floor = Math.max(Date.now(), fence.until);
      void publish(device.topics.manifest, JSON.stringify(manifest))
        .then(() => publish(device.topics.presence, presence(true), true))
        .then(() => {
          if (!closing && link.connected()) online = true;
        })
        .catch(fail);
    },
    sample(value: LocalSample) {
      if (!online || sampleBusy || closing) return;
      const readings: DeviceTelemetry["readings"] = [],
        sensorErrors: NonNullable<DeviceTelemetry["sensorErrors"]> = [];
      for (const [metric, measured] of [
        ["temperature", value.temperature],
        ["humidity", value.humidity],
      ] as const) {
        const declared = device.capabilities.some((c) => c.kind === metric);
        if (!declared && measured.state !== 0) {
          stop();
          return;
        }
        if (!measured.state) continue;
        if (measured.state === 1)
          readings.push(
            metric === "temperature"
              ? { metric, value: measured.value, unit: "degC" }
              : { metric, value: measured.value, unit: "percent" },
          );
        else if (measured.state === 2 || measured.state === 3)
          sensorErrors.push({
            metric,
            code: measured.state === 2 ? "read_failed" : "unavailable",
          });
        else {
          stop();
          return;
        }
      }
      const parsed = DeviceTelemetrySchema.safeParse({
        version: 1,
        type: "device.telemetry",
        messageId: `${boot}-t${value.sequence}`,
        deviceId: device.deviceId,
        bootId: boot,
        sequence: value.sequence,
        sampledAt: new Date(value.sampledAt).toISOString(),
        readings,
        sensorErrors,
      });
      if (!parsed.success) {
        stop();
        return;
      }
      sampleBusy = true;
      void publish(device.topics.telemetry, JSON.stringify(parsed.data))
        .catch(fail)
        .finally(() => {
          sampleBusy = false;
        });
    },
  });
  const commands = new BridgeCommands({
    manifest,
    link,
    now: Date.now,
    floor: () => floor,
    reserve: fence.reserve,
  });
  serial.on("error", fail);
  serial.on("close", fail);
  serial.on("data", (bytes: Buffer) => {
    if (!closing) link.receive(bytes);
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    mqtt = await connectAsync(endpoint, {
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 5000,
      rejectUnauthorized: true,
      ...(options.ca ? { ca: await readFile(options.ca) } : {}),
      username: device.username,
      password: device.token,
      clientId: device.clientId,
      queueQoSZero: false,
      properties: { maximumPacketSize: 2048 },
      will: {
        topic: device.topics.presence,
        payload: Buffer.from(presence(false)),
        qos: 0,
        retain: true,
      },
    });
    mqtt.on("error", fail);
    mqtt.on("close", fail);
    const grants = await mqtt.subscribeAsync(device.topics.commands, {
      qos: 0,
    });
    if (grants.some((g) => g.qos > 2)) throw new Error("Subscription denied");
    mqtt.on("message", (topic, payload, packet) => {
      if (
        !online ||
        closing ||
        topic !== device.topics.commands ||
        packet.retain ||
        payload.length > 1024 ||
        inFlight.size >= 16
      )
        return;
      const task = commands
        .receive(payload.toString("utf8"))
        .then((receipt) => {
          if (online && !closing)
            return publish(
              device.topics.commandResults,
              JSON.stringify(receipt),
            );
        })
        .catch(() => {})
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    });
    await new Promise<void>((resolve, reject) =>
      serial.open((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      serial.flush((error) => (error ? reject(error) : resolve())),
    );
    const started = performance.now();
    timer = setInterval(() => {
      if (!closing) {
        link.poll();
        if (online && performance.now() - presenceAt >= 30000) {
          presenceAt = performance.now();
          if (presenceSequence >= 0xfffffffe) stop();
          else
            void publish(device.topics.presence, presence(true), true).catch(
              fail,
            );
        }
        if (!online && performance.now() - started > 15000) fail();
      }
    }, 10);
    if (options.signal?.aborted) stop();
    options.signal?.addEventListener("abort", stop, { once: true });
    await stopped;
  } finally {
    closing = true;
    options.signal?.removeEventListener("abort", stop);
    clearInterval(timer);
    link.reset();
    await Promise.allSettled([...inFlight]);
    if (mqtt?.connected)
      await bounded(
        mqtt.publishAsync(device.topics.presence, presence(false), {
          qos: 0,
          retain: true,
        }),
      ).catch(() => {});
    if (mqtt) await bounded(mqtt.endAsync(true)).catch(() => {});
    if (serial.isOpen)
      await new Promise<void>((resolve) => serial.close(() => resolve()));
    await fence.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  if (failure)
    throw new Error(
      "Physical link stopped; restart explicitly for a fresh session",
    );
}
