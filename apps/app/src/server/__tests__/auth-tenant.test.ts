import { createHmac } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const database = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock("../prisma", () => ({ getPrisma: () => database }));
const secret = "synthetic-test-signing-key";
let auth: typeof import("../auth");

function token(payload: Record<string, unknown>, key = secret) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", secret);
  auth = await import("../auth");
});
beforeEach(() => vi.clearAllMocks());
afterAll(() => vi.unstubAllEnvs());

describe("current authentication handlers", () => {
  it.each([
    undefined,
    "Bearer broken",
    `Bearer ${token({ sub: "user-1", exp: 1 })}`,
    `Bearer ${token({ sub: "user-1", exp: 4_000_000_000 }, "wrong-key")}`,
  ])(
    "rejects absent, malformed, expired, and incorrectly signed access tokens: %s",
    async (authorization) => {
      const response = await auth.handleGetMe(
        new Request("http://localhost/api/auth/me", {
          headers: authorization ? { authorization } : {},
        }),
      );
      expect(response.status).toBe(401);
      expect(database.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it("returns stored memberships for a signed-in user", async () => {
    database.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "maker@example.test",
      name: "Maker",
      memberships: [
        { tenantId: "tenant-1", tenant: { name: "Home" }, roleId: "owner" },
      ],
    });
    const response = await auth.handleGetMe(
      new Request("http://localhost/api/auth/me", {
        headers: {
          authorization: `Bearer ${token({ sub: "user-1", tenantId: "tenant-1", exp: 4_000_000_000 })}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(database.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      include: { memberships: { include: { tenant: true, role: true } } },
    });
    expect(await response.json()).toMatchObject({
      userId: "user-1",
      activeTenantId: "tenant-1",
      memberships: [
        { tenantId: "tenant-1", tenantName: "Home", roleId: "owner" },
      ],
    });
  });

  it("rejects a signed token whose user no longer exists", async () => {
    database.user.findUnique.mockResolvedValue(null);
    const response = await auth.handleGetMe(
      new Request("http://localhost/api/auth/me", {
        headers: {
          authorization: `Bearer ${token({ sub: "deleted-user", exp: 4_000_000_000 })}`,
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects missing OTP input before accessing persistence", async () => {
    for (const handler of [auth.handleRequestCode, auth.handleVerifyCode]) {
      const response = await handler(
        new Request("http://localhost/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(400);
    }
  });
});
