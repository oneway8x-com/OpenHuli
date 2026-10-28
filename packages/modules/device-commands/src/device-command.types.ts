import type { DeviceCommand } from "@corely/contracts";
import type { DeviceAccessStore } from "@corely/modules-devices";
import type { TelemetryDependencies } from "@corely/modules-telemetry";
import type { DeviceCommandRepository } from "./device-command.repository";

/** Must settle on abort. not_sent guarantees no bytes were offered; later rejection is uncertain. */
export interface DeviceCommandPublisher {
  isReady(): boolean;
  publishCommand(
    command: DeviceCommand,
    signal: AbortSignal,
  ): Promise<"accepted" | "not_sent">;
}
export interface DeviceCommandDependencies {
  store: DeviceCommandRepository;
  devices: DeviceAccessStore;
  telemetry: TelemetryDependencies;
  publisher: DeviceCommandPublisher;
  acknowledgementTimeoutMs: number;
  signal?: AbortSignal;
  inflight?: Set<Promise<unknown>>;
}
