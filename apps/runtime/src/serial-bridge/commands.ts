import {
  parseDeviceCommand,
  DeviceCommandResultSchema,
  type DeviceCapabilityManifest,
  type DeviceCommandResult,
} from "@corely/contracts";
import type { SerialLink } from "./link";
export class BridgeCommands {
  private records = new Map<
    string,
    { expires: number; wire: string; result: Promise<DeviceCommandResult> }
  >();
  private busy = false;
  constructor(
    private readonly deps: {
      manifest: DeviceCapabilityManifest;
      link: SerialLink;
      now(): number;
      floor(): number;
      reserve(expires: number): Promise<void>;
    },
  ) {}
  async receive(wire: string): Promise<DeviceCommandResult> {
    const c = parseDeviceCommand(wire, this.deps.manifest),
      now = this.deps.now();
    for (const [id, r] of this.records)
      if (r.expires <= now) this.records.delete(id);
    const canonical = JSON.stringify(c),
      prior = this.records.get(c.commandId);
    if (prior) {
      if (prior.wire !== canonical)
        throw new Error("Command identity conflict");
      return prior.result;
    }
    const receipt = (
      status: DeviceCommandResult["status"],
      code = "execution_failed",
      completedAt = this.deps.now(),
    ) =>
      DeviceCommandResultSchema.parse({
        version: 1,
        messageId: c.commandId,
        type: "device.command.result",
        deviceId: c.deviceId,
        commandId: c.commandId,
        executionId: c.executionId,
        completedAt: new Date(completedAt).toISOString(),
        status,
        ...(status === "succeeded"
          ? {}
          : {
              error: {
                code,
                message: "Device command did not confirm success",
                correlationId: c.commandId,
                retryable: false,
              },
            }),
      });
    if (
      c.issuedAt &&
      (Date.parse(c.issuedAt) < this.deps.floor() ||
        Date.parse(c.issuedAt) > now ||
        Date.parse(c.expiresAt) <= now ||
        Date.parse(c.expiresAt) - Date.parse(c.issuedAt) > 30000)
    )
      return receipt("expired", "expired");
    if (this.busy || this.records.size >= 16)
      return receipt("failed", "limit_exceeded");
    if (
      c.action.kind === "display.write" &&
      !/^[\x20-\x7e]{1,32}$/.test(c.action.text)
    )
      return receipt("failed", "unsupported_capability");
    this.busy = true;
    const generation = this.deps.link.generation();
    const result = Promise.resolve().then(async () => {
      try {
        if (!this.deps.link.connected()) return receipt("failed");
        await this.deps.reserve(Date.parse(c.expiresAt));
        if (
          !this.deps.link.connected() ||
          generation !== this.deps.link.generation()
        )
          return receipt("unknown", "outcome_unknown");
        if (this.deps.now() >= Date.parse(c.expiresAt))
          return receipt("expired", "expired");
        const local = await this.deps.link.command(
          c.action,
          Date.parse(c.expiresAt),
        );
        return receipt(
          local.status,
          local.reason ??
            (local.status === "unknown"
              ? "outcome_unknown"
              : local.status === "expired"
                ? "expired"
                : "execution_failed"),
          local.completedAt,
        );
      } catch {
        return receipt("unknown", "outcome_unknown");
      } finally {
        this.busy = false;
      }
    });
    this.records.set(c.commandId, {
      wire: canonical,
      expires: Date.parse(c.expiresAt),
      result,
    });
    return result;
  }
}
