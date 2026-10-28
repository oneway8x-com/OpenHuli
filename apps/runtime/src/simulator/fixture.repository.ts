/** Disposable simulator persistence setup. Never composed by production startup. */
import { randomUUID } from "node:crypto";
import { PrismaService } from "@corely/data";
import { OPENHULI_PCM_FORMAT } from "@corely/contracts";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
  assignOwnerDeviceGrant,
} from "@corely/modules-devices";
import {
  IdentityRepository,
  issueAccessToken,
  type AuthConfig,
} from "@corely/modules-identity";

export class SimulatorFixtureRepository {
  readonly db = new PrismaService();
  readonly owner = { tenantId: randomUUID(), userId: randomUUID() };
  async create(auth: AuthConfig) {
    const { tenantId, userId } = this.owner;
    await this.db.tenant.create({
      data: { id: tenantId, name: "Disposable simulator", slug: tenantId },
    });
    await this.db.user.create({
      data: { id: userId, email: auth.ownerEmail, passwordHash: "" },
    });
    const role = await this.db.role.create({
      data: { tenantId, name: "Owner", systemKey: "OWNER", scope: "TENANT" },
    });
    await this.db.membership.create({
      data: { tenantId, userId, roleId: role.id },
    });
    const owner = {
      ...this.owner,
      email: auth.ownerEmail,
      name: "Synthetic owner",
      tenantName: "Disposable simulator",
    };
    const identity = new IdentityRepository(this.db);
    const session = await identity.createSession(
      owner,
      randomUUID(),
      new Date(Date.now() + 3600000),
    );
    const devices = new DeviceAccessRepository(this.db);
    const paired = await pairOwnerDevice(
      {
        name: "Synthetic simulator microphone",
        room: "Simulator",
        profileId: "esp32-voice",
        profileVersion: 1,
        capabilities: [
          { kind: "microphone", format: OPENHULI_PCM_FORMAT },
          { kind: "speaker", format: OPENHULI_PCM_FORMAT },
          { kind: "ping" },
          { kind: "temperature" },
          { kind: "humidity" },
        ],
      },
      this.owner,
      devices,
    );
    for (const toolId of ["weather.forecast", "notes.create"])
      await assignOwnerDeviceGrant(
        paired.device.id,
        {
          toolId,
          targetDeviceIds: [],
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        this.owner,
        devices,
      );
    return {
      paired,
      ownerToken: issueAccessToken(owner, session.id, auth.secret),
    };
  }
  executions() {
    return this.db.toolExecution.findMany({
      where: { tenantId: this.owner.tenantId },
      orderBy: { id: "asc" },
    });
  }
  async close() {
    const { tenantId, userId } = this.owner;
    await this.db.auditLog.deleteMany({ where: { tenantId } });
    await this.db.toolPreauthorization.deleteMany({ where: { tenantId } });
    await this.db.deviceCommand.deleteMany({ where: { tenantId } });
    await this.db.toolExecution.deleteMany({ where: { tenantId } });
    await this.db.agentRun.deleteMany({ where: { tenantId } });
    await this.db.device.deleteMany({ where: { tenantId } });
    await this.db.refreshToken.deleteMany({ where: { userId } });
    await this.db.membership.deleteMany({ where: { tenantId } });
    await this.db.role.deleteMany({ where: { tenantId } });
    await this.db.tenant.deleteMany({ where: { id: tenantId } });
    await this.db.user.deleteMany({ where: { id: userId } });
    await this.db.disconnect();
  }
}
