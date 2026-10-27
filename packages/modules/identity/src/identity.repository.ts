import { Prisma, type PrismaClient } from "@prisma/client";
import type { OwnerSession } from "@corely/contracts";
import { IdentityError } from "./identity.errors";

export interface SessionRecord {
  id: string;
  userId: string;
  tenantId: string | null;
  tokenHash: string;
  expiresAt: Date;
}
export class IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2034" ||
          attempt >= 2
        )
          throw error;
      }
    }
  }

  async findOwner(
    email: string,
    tenantId?: string,
  ): Promise<OwnerSession | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        ...(tenantId ? { tenantId } : {}),
        user: { email, status: "ACTIVE" },
        tenant: { status: "ACTIVE" },
        role: { systemKey: "OWNER", scope: "TENANT" },
      },
      include: { user: true, tenant: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    if (!membership?.tenant || membership.role.tenantId !== membership.tenantId)
      return null;
    return {
      userId: membership.userId,
      email: membership.user.email,
      name: membership.user.name,
      tenantId: membership.tenant.id,
      tenantName: membership.tenant.name,
    };
  }

  async reserveCode(
    owner: OwnerSession,
    codeHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.transaction(async (tx) => {
      const latest = await tx.portalOtpCode.findFirst({
        where: { tenantId: owner.tenantId, emailNormalized: owner.email },
        orderBy: { createdAt: "desc" },
      });
      if (latest && now.getTime() - latest.lastSentAt.getTime() < 60_000)
        return false;
      await tx.portalOtpCode.updateMany({
        where: {
          tenantId: owner.tenantId,
          emailNormalized: owner.email,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
      await tx.portalOtpCode.create({
        data: {
          tenantId: owner.tenantId,
          emailNormalized: owner.email,
          codeHash,
          expiresAt: new Date(now.getTime() + 15 * 60_000),
          lastSentAt: now,
        },
      });
      return true;
    });
  }

  async consumeCode(
    owner: OwnerSession,
    codeHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.transaction(async (tx) => {
      const record = await tx.portalOtpCode.findFirst({
        where: {
          tenantId: owner.tenantId,
          emailNormalized: owner.email,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!record) return false;
      const attempt = await tx.portalOtpCode.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          attemptCount: { lt: record.maxAttempts },
          expiresAt: { gt: now },
        },
        data: { attemptCount: { increment: 1 } },
      });
      if (attempt.count !== 1 || record.codeHash !== codeHash) return false;
      const consumed = await tx.portalOtpCode.updateMany({
        where: { id: record.id, consumedAt: null, codeHash },
        data: { consumedAt: now },
      });
      return consumed.count === 1;
    });
  }

  async createSession(
    owner: OwnerSession,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<SessionRecord> {
    return this.prisma.refreshToken.create({
      data: {
        userId: owner.userId,
        tenantId: owner.tenantId,
        tokenHash,
        expiresAt,
      },
    });
  }
  async getSession(id: string): Promise<SessionRecord | null> {
    return this.prisma.refreshToken.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }
  async findRefreshSession(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }
  async rotateSession(
    id: string,
    oldHash: string,
    newHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id,
        tokenHash: oldHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { tokenHash: newHash },
    });
    return result.count === 1;
  }
  async revokeSession(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async bootstrapOwner(email: string): Promise<OwnerSession> {
    return this.transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        update: {},
        create: { email, name: "Owner", passwordHash: "", status: "ACTIVE" },
      });
      const tenant = await tx.tenant.upsert({
        where: { slug: "openhuli-home" },
        update: {},
        create: { name: "Home", slug: "openhuli-home" },
      });
      if (user.status !== "ACTIVE" || tenant.status !== "ACTIVE")
        throw new IdentityError(403, "Owner or tenant is disabled");
      const role = await tx.role.upsert({
        where: {
          tenantId_systemKey: { tenantId: tenant.id, systemKey: "OWNER" },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          name: "Owner",
          systemKey: "OWNER",
          scope: "TENANT",
          isSystem: true,
        },
      });
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: { roleId: role.id },
        create: { tenantId: tenant.id, userId: user.id, roleId: role.id },
      });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        tenantId: tenant.id,
        tenantName: tenant.name,
      };
    });
  }
}
