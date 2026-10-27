import type { PrismaClient } from "@prisma/client";
import type {
  DeviceCommand,
  DeviceCommandResult,
  DeviceTelemetry,
} from "@corely/contracts";
import type {
  DeviceCredentialInput,
  DeviceGrantInput,
  RegisterDeviceInput,
} from "./device.schemas";

/** Persistence adapter. All identifiers, including parent references, carry tenant authority. */
export class DeviceRepository {
  constructor(private readonly db: PrismaClient) {}

  register(tenantId: string, input: RegisterDeviceInput) {
    return this.db.device.create({
      data: {
        id: input.manifest.deviceId,
        tenantId,
        name: input.name,
        manifestJson: JSON.stringify(input.manifest),
      },
    });
  }

  find(tenantId: string, id: string) {
    return this.db.device.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
  }

  addCredential(tenantId: string, input: DeviceCredentialInput) {
    return this.db.deviceCredential.create({
      data: {
        tenantId,
        deviceId: input.deviceId,
        secretHash: input.secretHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  findCredential(tenantId: string, id: string, now: Date) {
    return this.db.deviceCredential.findFirst({
      where: {
        tenantId,
        id,
        revokedAt: null,
        expiresAt: { gt: now },
        device: { status: "active" },
      },
    });
  }

  revokeCredential(tenantId: string, id: string, now: Date) {
    return this.db.deviceCredential.updateMany({
      where: { tenantId, id, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  grant(tenantId: string, input: DeviceGrantInput) {
    return this.db.deviceToolGrant.upsert({
      where: {
        tenantId_deviceId_toolId: {
          tenantId,
          deviceId: input.deviceId,
          toolId: input.toolId,
        },
      },
      create: {
        tenantId,
        deviceId: input.deviceId,
        toolId: input.toolId,
        expiresAt: input.expiresAt,
      },
      update: { expiresAt: input.expiresAt, revokedAt: null },
    });
  }

  findGrant(tenantId: string, deviceId: string, toolId: string, now: Date) {
    return this.db.deviceToolGrant.findFirst({
      where: {
        tenantId,
        deviceId,
        toolId,
        revokedAt: null,
        expiresAt: { gt: now },
        device: { status: "active" },
      },
    });
  }

  revokeGrant(tenantId: string, deviceId: string, toolId: string, now: Date) {
    return this.db.deviceToolGrant.updateMany({
      where: { tenantId, deviceId, toolId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async recordTelemetry(tenantId: string, input: DeviceTelemetry) {
    // Duplicate deliveries never replace the original sample.
    const result = await this.db.deviceTelemetry.createMany({
      data: [
        {
          tenantId,
          deviceId: input.deviceId,
          messageId: input.messageId,
          bootId: input.bootId,
          sequence: BigInt(input.sequence),
          sampledAt: new Date(input.sampledAt),
          readingsJson: JSON.stringify(input.readings),
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  history(tenantId: string, deviceId: string, take: number) {
    return this.db.deviceTelemetry.findMany({
      where: { tenantId, deviceId },
      orderBy: [{ sampledAt: "desc" }, { id: "desc" }],
      take,
    });
  }

  findExecution(tenantId: string, id: string, deviceId: string) {
    return this.db.toolExecution.findFirst({
      where: { tenantId, id, run: { tenantId, deviceId } },
    });
  }

  queueCommand(tenantId: string, input: DeviceCommand) {
    return this.db.deviceCommand.create({
      data: {
        id: input.commandId,
        tenantId,
        deviceId: input.deviceId,
        executionId: input.executionId,
        issuedAt: new Date(input.issuedAt),
        expiresAt: new Date(input.expiresAt),
        payloadJson: JSON.stringify(input),
      },
    });
  }

  findCommand(tenantId: string, id: string) {
    return this.db.deviceCommand.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
  }

  async recordResult(tenantId: string, input: DeviceCommandResult, now: Date) {
    // Only the first result may resolve a pending command. Expiry is handled before this write.
    return this.db.deviceCommand.updateMany({
      where: {
        tenantId,
        id: input.commandId,
        deviceId: input.deviceId,
        executionId: input.executionId,
        status: "queued",
        expiresAt: { gt: now },
      },
      data: {
        status: input.status,
        resultJson: JSON.stringify(input),
        completedAt: now,
      },
    });
  }

  expireCommands(tenantId: string, now: Date) {
    return this.db.deviceCommand.updateMany({
      where: { tenantId, status: "queued", expiresAt: { lte: now } },
      data: { status: "expired", completedAt: now },
    });
  }
}
