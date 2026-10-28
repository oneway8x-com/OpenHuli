import { parseOpenHuliJson } from "./common";
import {
  DeviceCapabilityManifestSchema,
  DeviceCommandSchema,
  parseDeviceCommand,
  type DeviceCapabilityManifest,
  type DeviceCommand,
  type DeviceCommandResult,
} from "./device";

/** Reference simulator algorithm. Firmware must implement the same expiry/dedup rules. */
export class OpenHuliCommandReceiver {
  private readonly commands = new Map<
    string,
    { wire: string; expires: number; result: Promise<DeviceCommandResult> }
  >();
  private lastClock = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly manifest: DeviceCapabilityManifest,
    private readonly clock: () => number,
    private readonly clockReady: () => boolean,
    private readonly capacity = 256,
  ) {
    this.manifest = DeviceCapabilityManifestSchema.parse(manifest);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024)
      throw new Error("Invalid dedupe capacity");
  }
  receive(
    text: string,
    execute: (
      action: DeviceCommand["action"],
    ) => Promise<"succeeded" | "failed">,
  ): Promise<DeviceCommandResult> {
    const parsed = parseOpenHuliJson(text, DeviceCommandSchema);
    if (parsed.deviceId !== this.manifest.deviceId)
      throw new Error("Command target mismatch");
    const now = this.clock(),
      wire = JSON.stringify(parsed);
    const clockMovedBack = !Number.isFinite(now) || now < this.lastClock;
    if (Number.isFinite(now)) this.lastClock = Math.max(now, this.lastClock);
    for (const [id, record] of this.commands)
      if (record.expires <= now) this.commands.delete(id);
    const prior = this.commands.get(parsed.commandId);
    if (prior) {
      if (prior.wire !== wire) throw new Error("Command identity conflict");
      return prior.result;
    }
    const result = (
      status: DeviceCommandResult["status"],
      code:
        | "expired"
        | "unsupported_capability"
        | "execution_failed"
        | "outcome_unknown"
        | "limit_exceeded",
    ) => ({
      version: 1 as const,
      type: "device.command.result" as const,
      messageId: parsed.commandId,
      commandId: parsed.commandId,
      executionId: parsed.executionId,
      deviceId: parsed.deviceId,
      completedAt: new Date(this.clock()).toISOString(),
      ...(status === "succeeded"
        ? { status }
        : {
            status,
            error: {
              code,
              message: "Device command did not confirm success",
              correlationId: parsed.commandId,
              retryable: false,
            },
          }),
    });
    if (
      clockMovedBack ||
      !this.clockReady() ||
      Date.parse(parsed.issuedAt) > now ||
      Date.parse(parsed.expiresAt) <= now ||
      Date.parse(parsed.expiresAt) - Date.parse(parsed.issuedAt) > 30000
    )
      return Promise.resolve(result("expired", "expired"));
    try {
      parseDeviceCommand(text, this.manifest);
    } catch {
      return Promise.resolve(result("failed", "unsupported_capability"));
    }
    if (this.commands.size >= this.capacity)
      return Promise.resolve(result("failed", "limit_exceeded"));
    // Reserve before starting the effect. Concurrent duplicates share this same promise and receipt.
    const work = Promise.resolve().then(async () => {
      const executionTime = this.clock();
      if (
        !this.clockReady() ||
        !Number.isFinite(executionTime) ||
        executionTime < now ||
        executionTime >= Date.parse(parsed.expiresAt)
      )
        return result("expired", "expired");
      try {
        const status = await execute(parsed.action);
        return result(status, "execution_failed");
      } catch {
        return result("unknown", "outcome_unknown");
      }
    });
    this.commands.set(parsed.commandId, {
      wire,
      expires: Date.parse(parsed.expiresAt),
      result: work,
    });
    return work;
  }
}
