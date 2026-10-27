import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  bootstrapOwner,
  hashOwnerCode,
  hashRefreshToken,
  IdentityRepository,
  issueAccessToken,
  newRefreshToken,
  readAuthConfig,
  refreshOwnerSession,
  requestOwnerCode,
  verifyOwnerCode,
} from "@corely/modules-identity";
import { GET as list, POST as create } from "../../../app/api/todos/route";
import {
  GET as detail,
  PATCH as update,
  DELETE as remove,
} from "../../../app/api/todos/[id]/route";
import { POST as complete } from "../../../app/api/todos/[id]/complete/route";
import { POST as reopen } from "../../../app/api/todos/[id]/reopen/route";
import { getPrisma } from "../prisma";
import { getTestDatabaseUrl } from "../../../../../scripts/test-database";
import type { OwnerSession } from "@corely/contracts";

process.env.DATABASE_URL = getTestDatabaseUrl();
const prisma = getPrisma(),
  repository = new IdentityRepository(prisma),
  config = readAuthConfig();
let owner: OwnerSession, otherTenant: string, otherTodo: string;
async function access(tenantId = owner.tenantId) {
  const refresh = newRefreshToken();
  const session = await prisma.refreshToken.create({
    data: {
      userId: owner.userId,
      tenantId,
      tokenHash: hashRefreshToken(refresh),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return issueAccessToken({ ...owner, tenantId }, session.id, config.secret);
}
function req(
  method = "GET",
  token?: string,
  body?: unknown,
  tenantId?: string,
) {
  return new NextRequest("http://localhost:3000/api/todos", {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function params() {
  return { params: Promise.resolve({ id: otherTodo }) };
}

beforeAll(async () => {
  owner = await bootstrapOwner(config, repository);
  const other = await prisma.tenant.create({
    data: { name: "Other synthetic tenant", slug: `auth-other-${Date.now()}` },
  });
  otherTenant = other.id;
  const role = await prisma.role.create({
    data: { tenantId: other.id, name: "Member", systemKey: "MEMBER" },
  });
  await prisma.membership.create({
    data: { userId: owner.userId, tenantId: other.id, roleId: role.id },
  });
  const todo = await prisma.todo.create({
    data: { tenantId: other.id, title: "Private other tenant" },
  });
  otherTodo = todo.id;
});
beforeEach(async () => {
  await prisma.portalOtpCode.deleteMany({
    where: { tenantId: owner.tenantId, emailNormalized: owner.email },
  });
});
afterAll(async () => {
  if (owner) {
    await prisma.portalOtpCode.deleteMany({
      where: { tenantId: owner.tenantId, emailNormalized: owner.email },
    });
    await prisma.user.deleteMany({ where: { id: owner.userId } });
    await prisma.tenant.deleteMany({
      where: { id: { in: [owner.tenantId, otherTenant] } },
    });
  }
  await prisma.$disconnect();
  await globalThis.__corelyPrismaPool?.end();
  globalThis.__corelyPrisma = undefined;
  globalThis.__corelyPrismaPool = undefined;
});

describe("real PostgreSQL owner authorization", () => {
  it("bootstraps one owner and a usable tenant idempotently", async () => {
    expect(await bootstrapOwner(config, repository)).toEqual(owner);
    expect(
      await prisma.membership.count({
        where: { userId: owner.userId, tenantId: owner.tenantId },
      }),
    ).toBe(1);
  });
  it("rejects anonymous access even with a known tenant header", async () => {
    expect(
      (await list(req("GET", undefined, undefined, owner.tenantId))).status,
    ).toBe(401);
    expect(
      (
        await create(
          req("POST", undefined, { title: "unauthorized" }, owner.tenantId),
        )
      ).status,
    ).toBe(401);
  });
  it("never reads or mutates another tenant through any todo handler", async () => {
    const token = await access();
    const listed = await list(req("GET", token));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ items: [] });
    const responses = await Promise.all([
      detail(req("GET", token), params()),
      update(req("PATCH", token, { title: "hacked" }), params()),
      remove(req("DELETE", token), params()),
      complete(req("POST", token, {}), params()),
      reopen(req("POST", token, {}), params()),
    ]);
    expect(responses.map((response) => response.status)).toEqual(
      Array(5).fill(404),
    );
    expect(
      (await create(req("POST", token, { title: "bad" }, otherTenant))).status,
    ).toBe(403);
    expect(
      await prisma.todo.findUnique({ where: { id: otherTodo } }),
    ).toMatchObject({ title: "Private other tenant", status: "open" });
  });
  it("rejects signed claims for a tenant without an OWNER membership", async () => {
    expect((await list(req("GET", await access(otherTenant)))).status).toBe(
      403,
    );
  });
  it("rechecks role revocation and session revocation on every request", async () => {
    const token = await access();
    await prisma.refreshToken.updateMany({
      where: { userId: owner.userId },
      data: { revokedAt: new Date() },
    });
    expect((await list(req("GET", token))).status).toBe(401);
    const token2 = await access();
    const membership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: owner.tenantId, userId: owner.userId },
    });
    await prisma.membership.delete({ where: { id: membership.id } });
    expect((await list(req("GET", token2))).status).toBe(403);
    await bootstrapOwner(config, repository);
  });
  it("allows only one concurrent verification of an OTP", async () => {
    let code = "";
    await requestOwnerCode(
      owner.email,
      config,
      repository,
      async (_email, value) => {
        code = value;
      },
    );
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        verifyOwnerCode(owner.email, code, config, repository),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  });
  it("enforces five attempts and rejects expired OTP records", async () => {
    let code = "";
    await requestOwnerCode(
      owner.email,
      config,
      repository,
      async (_email, value) => {
        code = value;
      },
    );
    const wrong = code === "000000" ? "999999" : "000000";
    for (let i = 0; i < 5; i++)
      await expect(
        verifyOwnerCode(owner.email, wrong, config, repository),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyOwnerCode(owner.email, code, config, repository),
    ).rejects.toMatchObject({ status: 400 });
    await prisma.portalOtpCode.updateMany({
      where: { tenantId: owner.tenantId, emailNormalized: owner.email },
      data: {
        attemptCount: 0,
        expiresAt: new Date(1),
        codeHash: hashOwnerCode(owner.email, code, config.secret),
      },
    });
    await expect(
      verifyOwnerCode(owner.email, code, config, repository),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rotates the refresh token atomically and rejects replay", async () => {
    const raw = newRefreshToken();
    await repository.createSession(
      owner,
      hashRefreshToken(raw),
      new Date(Date.now() + 60_000),
    );
    const results = await Promise.allSettled([
      refreshOwnerSession(raw, config, repository),
      refreshOwnerSession(raw, config, repository),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  });
});
