import type { PrismaClient } from "@prisma/client";
import type {
  DeviceCapabilityManifest,
  PairDeviceInput,
} from "@corely/contracts";
import type {
  DeviceAccessStore,
  NewAccessCredential,
} from "./device-access.types";

/** Pairing persistence; every key is scoped by the owner or credential-derived Tenant. */
export class DeviceAccessRepository implements DeviceAccessStore {
  constructor(private readonly db: PrismaClient) {}
  pair(
    tenantId: string,
    deviceId: string,
    configuration: PairDeviceInput,
    credentials: NewAccessCredential[],
  ) {
    return this.db.$transaction(async (tx) => {
      const device = await tx.device.create({
        data: {
          id: deviceId,
          tenantId,
          name: configuration.name,
          configurationJson: JSON.stringify(configuration),
          manifestJson: JSON.stringify({
            version: 1,
            messageId: deviceId,
            type: "device.manifest",
            deviceId,
            firmwareVersion: "unregistered",
            capabilities: configuration.capabilities,
          }),
        },
      });
      await tx.deviceCredential.createMany({
        data: credentials.map((credential) => ({
          ...credential,
          tenantId,
          deviceId,
        })),
      });
      return device;
    });
  }
  findDevice(tenantId: string, deviceId: string) {
    return this.db.device.findFirst({
      where: { tenantId, id: deviceId, tenant: { status: "ACTIVE" } },
    });
  }
  listDevices(tenantId: string) {
    return this.db.device.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  credentials(tenantId: string, deviceId: string) {
    return this.db.deviceCredential.findMany({
      where: { tenantId, deviceId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        tenantId: true,
        deviceId: true,
        purpose: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }
  findCredential(tenantId: string, credentialId: string) {
    return this.db.deviceCredential.findUnique({
      where: { tenantId_id: { tenantId, id: credentialId } },
    });
  }
  async saveManifest(
    tenantId: string,
    deviceId: string,
    manifest: DeviceCapabilityManifest,
  ) {
    return (
      (
        await this.db.device.updateMany({
          where: { tenantId, id: deviceId, status: "active" },
          data: { manifestJson: JSON.stringify(manifest) },
        })
      ).count === 1
    );
  }
  rotateCredential(
    tenantId: string,
    deviceId: string,
    oldId: string,
    replacement: NewAccessCredential,
    now: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      // Consume the old credential once; competing rotations cannot leave two replacements.
      const consumed = await tx.deviceCredential.updateMany({
        where: {
          tenantId,
          deviceId,
          id: oldId,
          purpose: replacement.purpose,
          revokedAt: null,
          device: { status: "active" },
        },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.deviceCredential.create({
        data: { ...replacement, tenantId, deviceId },
      });
      return true;
    });
  }
  async revokeCredential(
    tenantId: string,
    deviceId: string,
    credentialId: string,
    now: Date,
  ) {
    return (
      (
        await this.db.deviceCredential.updateMany({
          where: { tenantId, deviceId, id: credentialId },
          data: { revokedAt: now },
        })
      ).count === 1
    );
  }
  deactivateDevice(tenantId: string, deviceId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.device.updateMany({
        where: { tenantId, id: deviceId },
        data: { status: "revoked" },
      });
      if (result.count !== 1) return false;
      await tx.deviceCredential.updateMany({
        where: { tenantId, deviceId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.deviceToolGrant.updateMany({
        where: { tenantId, deviceId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
  }
  async assignGrant(
    tenantId: string,
    deviceId: string,
    toolId: string,
    targets: string[],
    expiresAt: Date,
  ) {
    const targetDeviceIdsJson = JSON.stringify(targets);
    await this.db.deviceToolGrant.upsert({
      where: { tenantId_deviceId_toolId: { tenantId, deviceId, toolId } },
      create: { tenantId, deviceId, toolId, targetDeviceIdsJson, expiresAt },
      update: { targetDeviceIdsJson, expiresAt, revokedAt: null },
    });
  }
  async revokeGrant(
    tenantId: string,
    deviceId: string,
    toolId: string,
    now: Date,
  ) {
    await this.db.deviceToolGrant.updateMany({
      where: { tenantId, deviceId, toolId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  grants(tenantId: string, deviceId: string) {
    return this.db.deviceToolGrant.findMany({
      where: { tenantId, deviceId },
      take: 100,
      select: {
        toolId: true,
        targetDeviceIdsJson: true,
        expiresAt: true,
        revokedAt: true,
      },
      orderBy: { toolId: "asc" },
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
}
