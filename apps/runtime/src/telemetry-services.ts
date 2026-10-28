import { randomUUID } from "node:crypto";
import { PrismaService } from "@corely/data";
import { DeviceAccessRepository } from "@corely/modules-devices";
import {
  DeviceCommandRepository,
  type DeviceCommandDependencies,
} from "@corely/modules-device-commands";
import { TelemetryRepository } from "@corely/modules-telemetry";
import type { RuntimeConfig } from "./config";

/** Runtime composition only; feature repositories own all queries. */
export function createTelemetryServices(config: RuntimeConfig) {
  const db = new PrismaService();
  const telemetry = {
    store: new TelemetryRepository(db),
    devices: new DeviceAccessRepository(db),
    epoch: randomUUID(),
    policy: {
      intervalSeconds: config.RUNTIME_TELEMETRY_INTERVAL_SECONDS,
      retentionDays: config.RUNTIME_TELEMETRY_RETENTION_DAYS,
    },
  };
  const lifetime = new AbortController();
  const inflight = new Set<Promise<unknown>>();
  const commands: DeviceCommandDependencies = {
    signal: lifetime.signal,
    inflight,
    store: new DeviceCommandRepository(db),
    devices: telemetry.devices,
    telemetry,
    acknowledgementTimeoutMs: config.RUNTIME_COMMAND_ACK_TIMEOUT_MS,
    publisher: { isReady: () => false, publishCommand: async () => "not_sent" },
  };
  return {
    telemetry,
    commands,
    async close() {
      lifetime.abort();
      await Promise.allSettled([...inflight]);
      await db.disconnect();
    },
  };
}
