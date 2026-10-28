import type { PrismaClient } from "@prisma/client";
import type { DeviceCommand, DeviceCommandResult } from "@corely/contracts";

export class DeviceCommandRepository {
  constructor(private readonly db: PrismaClient) {}
  execution(
    tenantId: string,
    executionId: string,
    deviceId: string,
    now: Date,
  ) {
    return this.db.toolExecution.findFirst({
      where: {
        tenantId,
        id: executionId,
        targetDeviceId: deviceId,
        status: "running",
        effect: "write",
        requestHash: { not: null },
        expiresAt: { gt: now },
        dispatchDeadline: { gt: now },
        run: {
          tenantId,
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        turn: { status: { in: ["committed", "responding"] } },
      },
    });
  }
  get(tenantId: string, commandId: string) {
    return this.db.deviceCommand.findUnique({
      where: { tenantId_id: { tenantId, id: commandId } },
    });
  }
  async reserve(tenantId: string, command: DeviceCommand) {
    const created = await this.db.deviceCommand.createMany({
      data: [
        {
          id: command.commandId,
          tenantId,
          deviceId: command.deviceId,
          executionId: command.executionId,
          payloadJson: JSON.stringify(command),
          status: "prepared",
          issuedAt: new Date(command.issuedAt),
          expiresAt: new Date(command.expiresAt),
        },
      ],
      skipDuplicates: true,
    });
    const record = await this.get(tenantId, command.commandId);
    if (
      !record ||
      record.deviceId !== command.deviceId ||
      record.executionId !== command.executionId
    )
      throw new Error("Command identity conflict");
    return { created: created.count === 1, record };
  }
  async claim(
    tenantId: string,
    commandId: string,
    deviceId: string,
    now: Date,
  ) {
    const changed = await this.db.deviceCommand.updateMany({
      where: {
        tenantId,
        id: commandId,
        status: "prepared",
        expiresAt: { gt: now },
        execution: {
          status: "running",
          targetDeviceId: deviceId,
          expiresAt: { gt: now },
          dispatchDeadline: { gt: now },
        },
      },
      data: { status: "pending" },
    });
    return changed.count === 1;
  }
  async finish(
    tenantId: string,
    commandId: string,
    from: "prepared" | "pending",
    status: "failed" | "expired" | "cancelled" | "unknown",
    reason: string,
    now: Date,
  ) {
    await this.db.deviceCommand.updateMany({
      where: { tenantId, id: commandId, status: from },
      data: {
        status,
        resultJson: JSON.stringify({ source: "backend", reason }),
        completedAt: now,
      },
    });
  }
  async acknowledge(tenantId: string, result: DeviceCommandResult, now: Date) {
    const changed = await this.db.deviceCommand.updateMany({
      where: {
        tenantId,
        id: result.commandId,
        deviceId: result.deviceId,
        executionId: result.executionId,
        status: "pending",
        payloadJson: { not: "{}" },
        expiresAt: { gt: now },
        issuedAt: { lte: new Date(result.completedAt) },
      },
      data: {
        status: result.status,
        resultJson: JSON.stringify({
          source: "device",
          reason: "device_result",
          acknowledgement: result,
        }),
        completedAt: now,
      },
    });
    if (changed.count) return true;
    // Keep late evidence without changing an unknown/expired outcome or overwriting the first receipt.
    const record = await this.get(tenantId, result.commandId);
    if (
      record &&
      record.payloadJson !== "{}" &&
      ["pending", "unknown", "expired", "cancelled"].includes(record.status)
    ) {
      const prior: unknown = record.resultJson
        ? JSON.parse(record.resultJson)
        : null;
      if (prior && typeof prior === "object" && "lateAcknowledgement" in prior)
        return false;
      await this.db.deviceCommand.updateMany({
        where: {
          tenantId,
          id: result.commandId,
          status: record.status,
          payloadJson: { not: "{}" },
          resultJson: record.resultJson,
        },
        data: {
          ...(record.status === "pending" && record.expiresAt <= now
            ? { status: "unknown", completedAt: now }
            : {}),
          resultJson: JSON.stringify({
            ...(prior !== null &&
            typeof prior === "object" &&
            !Array.isArray(prior)
              ? prior
              : { source: "backend", reason: "ack_timeout" }),
            lateAcknowledgement: result,
          }),
        },
      });
    }
    return false;
  }
}
