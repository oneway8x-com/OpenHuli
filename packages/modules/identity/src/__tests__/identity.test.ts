import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readAuthConfig, DEVELOPMENT_SECRET } from "../identity.config";
import { issueAccessToken, verifyAccessToken } from "../identity.tokens";
import {
  authorizeOwnerUpload,
  resolveOwnerSession,
  requestOwnerCode,
  verifyOwnerCode,
  refreshOwnerSession,
  type IdentityStore,
} from "../use-cases/owner-auth";

const secret = "synthetic-unit-secret-at-least-32-characters";
const owner = {
  userId: "user-1",
  email: "owner@example.test",
  name: "Owner",
  tenantId: "tenant-1",
  tenantName: "Home",
};
const env = {
  NODE_ENV: "test",
  JWT_SECRET: secret,
  OWNER_EMAIL: owner.email,
  APP_URL: "http://localhost:3000",
};
const config = readAuthConfig(env);
const now = Math.floor(Date.now() / 1000);
const session = {
  id: "session-1",
  userId: owner.userId,
  tenantId: owner.tenantId,
  tokenHash: "hash",
  expiresAt: new Date(Date.now() + 100_000),
};
function store(): IdentityStore {
  return {
    findOwner: vi.fn().mockResolvedValue(owner),
    reserveCode: vi.fn().mockResolvedValue(true),
    consumeCode: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue(session),
    getSession: vi.fn().mockResolvedValue(session),
    findRefreshSession: vi.fn().mockResolvedValue(session),
    rotateSession: vi.fn().mockResolvedValue(true),
    revokeSession: vi.fn(),
    bootstrapOwner: vi.fn().mockResolvedValue(owner),
  };
}
function signed(
  payload: Record<string, unknown>,
  header = { alg: "HS256", typ: "JWT" },
) {
  const a = Buffer.from(JSON.stringify(header)).toString("base64url");
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${a}.${b}.${createHmac("sha256", secret).update(`${a}.${b}`).digest("base64url")}`;
}
const claims = {
  iss: "openhuli",
  aud: "openhuli-console",
  sub: owner.userId,
  email: owner.email,
  tenantId: owner.tenantId,
  sid: session.id,
  iat: now,
  exp: now + 3600,
} as const;

describe("auth configuration", () => {
  it("permits secret fallback only in explicit development", () => {
    expect(
      readAuthConfig({ NODE_ENV: "development", OWNER_EMAIL: owner.email })
        .secret,
    ).toBe(DEVELOPMENT_SECRET);
    expect(() =>
      readAuthConfig({ NODE_ENV: "test", OWNER_EMAIL: owner.email }),
    ).toThrow("JWT_SECRET");
  });
  it.each(["", DEVELOPMENT_SECRET, "dev-secret-change-in-prod", "short"])(
    "rejects unsafe production secret %s",
    (JWT_SECRET) => {
      expect(() =>
        readAuthConfig({ ...env, NODE_ENV: "production", JWT_SECRET }),
      ).toThrow("JWT_SECRET");
    },
  );
  it("requires owner, app origin, HTTPS, and production mail configuration", () => {
    expect(() => readAuthConfig({ ...env, OWNER_EMAIL: "" })).toThrow(
      "OWNER_EMAIL",
    );
    expect(() =>
      readAuthConfig({ ...env, APP_URL: "https://example.test/path" }),
    ).toThrow("APP_URL");
    expect(() =>
      readAuthConfig({ ...env, APP_URL: "http://example.test" }),
    ).toThrow("HTTPS");
    expect(() => readAuthConfig({ ...env, NODE_ENV: "production" })).toThrow(
      "RESEND_API_KEY",
    );
  });
});
describe("access token contract", () => {
  it("round-trips signed tokens and checks the signature", () => {
    const token = issueAccessToken(owner, session.id, secret, now);
    expect(verifyAccessToken(token, secret, now)).toMatchObject(claims);
    expect(verifyAccessToken(token, "wrong-key", now)).toBeNull();
    expect(verifyAccessToken("broken", secret, now)).toBeNull();
  });
  it.each([
    { ...claims, exp: now },
    { ...claims, exp: undefined },
    { ...claims, exp: "future" },
    { ...claims, iat: now + 31 },
    { ...claims, exp: now + 3601 },
    { ...claims, iss: "other" },
    { ...claims, aud: "other" },
    { ...claims, sub: "" },
    { ...claims, tenantId: "" },
    { ...claims, sid: "" },
  ])("rejects invalid/expired claims %#", (payload) =>
    expect(verifyAccessToken(signed(payload), secret, now)).toBeNull(),
  );
  it("rejects algorithm confusion", () =>
    expect(
      verifyAccessToken(
        signed(claims, { alg: "none", typ: "JWT" }),
        secret,
        now,
      ),
    ).toBeNull());
});
describe("owner use cases", () => {
  it("requires a live matching session and active OWNER membership", async () => {
    const db = store();
    await expect(resolveOwnerSession(claims, config, db)).resolves.toEqual(
      owner,
    );
    expect(db.findOwner).toHaveBeenCalledWith(owner.email, owner.tenantId);
    vi.mocked(db.getSession).mockResolvedValue(null);
    await expect(resolveOwnerSession(claims, config, db)).rejects.toMatchObject(
      { status: 401 },
    );
    vi.mocked(db.getSession).mockResolvedValue(session);
    vi.mocked(db.findOwner).mockResolvedValue(null);
    await expect(resolveOwnerSession(claims, config, db)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it("does not send codes or create users for unconfigured emails or absent memberships", async () => {
    const db = store(),
      deliver = vi.fn();
    await requestOwnerCode("visitor@example.test", config, db, deliver);
    expect(db.findOwner).not.toHaveBeenCalled();
    vi.mocked(db.findOwner).mockResolvedValue(null);
    await requestOwnerCode(owner.email, config, db, deliver);
    expect(deliver).not.toHaveBeenCalled();
  });
  it("sends a six-digit code only when cooldown reservation succeeds", async () => {
    const db = store(),
      deliver = vi.fn();
    await requestOwnerCode(owner.email, config, db, deliver);
    expect(deliver).toHaveBeenCalledWith(
      owner.email,
      expect.stringMatching(/^\d{6}$/),
    );
    vi.mocked(db.reserveCode).mockResolvedValue(false);
    await requestOwnerCode(owner.email, config, db, deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("requires atomic OTP consumption before creating a session", async () => {
    const db = store();
    vi.mocked(db.consumeCode).mockResolvedValue(false);
    await expect(
      verifyOwnerCode(owner.email, "123456", config, db),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.createSession).not.toHaveBeenCalled();
  });
  it("creates signed sessions after correct OTP and rejects reused refresh tokens", async () => {
    const db = store();
    const result = await verifyOwnerCode(owner.email, "123456", config, db);
    expect(verifyAccessToken(result.accessToken, secret)?.sid).toBe(session.id);
    expect(result.refreshToken).toHaveLength(80);
    vi.mocked(db.rotateSession).mockResolvedValue(false);
    await expect(
      refreshOwnerSession(result.refreshToken, config, db),
    ).rejects.toMatchObject({ status: 401 });
  });
});

it("restricts uploads to the authenticated tenant and configured prefix", () => {
  expect(
    authorizeOwnerUpload("tenant-1", "tenant-1/uploads/file.txt", "uploads"),
  ).toBe("tenant-1/uploads/file.txt");
  for (const path of [
    "tenant-2/uploads/file.txt",
    "tenant-1/uploads/../file",
    "tenant-1/uploads/%2e%2e/file",
  ])
    expect(() => authorizeOwnerUpload("tenant-1", path, "uploads")).toThrow();
});
