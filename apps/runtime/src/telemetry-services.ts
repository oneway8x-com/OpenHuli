import { randomUUID } from "node:crypto";
import { PrismaService } from "@corely/data";
import { DeviceAccessRepository } from "@corely/modules-devices";
import { TelemetryRepository } from "@corely/modules-telemetry";
import type { RuntimeConfig } from "./config";

/** Runtime composition only; feature repositories own all queries. */
export function createTelemetryServices(config: RuntimeConfig) {
  const db = new PrismaService();
  return {
    telemetry: {
      store: new TelemetryRepository(db),
      devices: new DeviceAccessRepository(db),
      epoch: randomUUID(),
      policy: {
        intervalSeconds: config.RUNTIME_TELEMETRY_INTERVAL_SECONDS,
        retentionDays: config.RUNTIME_TELEMETRY_RETENTION_DAYS,
      },
    },
    close: () => db.disconnect(),
  };
}
