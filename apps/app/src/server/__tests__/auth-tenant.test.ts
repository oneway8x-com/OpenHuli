import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { issueAccessToken } from "@corely/modules-identity";
import { GET as list, POST as create } from "../../../app/api/todos/route";
import {
  GET as detail,
  PATCH as update,
  DELETE as remove,
} from "../../../app/api/todos/[id]/route";
import { POST as complete } from "../../../app/api/todos/[id]/complete/route";
import { POST as reopen } from "../../../app/api/todos/[id]/reopen/route";
import { POST as upload } from "../../../app/api/storage/blob/upload/route";
import {
  handleGetMe,
  handleRequestCode,
  handleVerifyCode,
  handleRefresh,
  handleLogout,
} from "../auth";

const db = vi.hoisted(() => ({
  findOwner: vi.fn(),
  getSession: vi.fn(),
  reserveCode: vi.fn(),
  consumeCode: vi.fn(),
  createSession: vi.fn(),
  findRefreshSession: vi.fn(),
  rotateSession: vi.fn(),
  revokeSession: vi.fn(),
}));
const storage = vi.hoisted(() => ({ getObjectStorage: vi.fn() }));
const runtime = vi.hoisted(() => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  getTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  completeTodo: vi.fn(),
  reopenTodo: vi.fn(),
}));
vi.mock("../identity-runtime", () => ({ getIdentityStore: () => db }));
vi.mock("../todos-runtime", () => ({ createTodoRuntime: () => runtime }));
vi.mock("../object-storage", () => ({
  getObjectStorage: storage.getObjectStorage,
  getStorageKeyPrefix: () => "",
  getUploadTtlSeconds: () => 600,
}));
const owner = {
  userId: "user-1",
  email: "owner@example.test",
  name: "Owner",
  tenantId: "tenant-1",
  tenantName: "Home",
};
const secret = "synthetic-unit-secret-at-least-32-characters";
const session = {
  id: "session-1",
  userId: owner.userId,
  tenantId: owner.tenantId,
  tokenHash: "hash",
  expiresAt: new Date(Date.now() + 60_000),
};
const token = issueAccessToken(owner, session.id, secret);
const params = {
  params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
};
function request(
  path = "/api/todos",
  method = "GET",
  headers: Record<string, string> = {},
  body?: unknown,
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  storage.getObjectStorage.mockImplementation(() => {
    throw new Error("Unauthenticated storage must not be reached");
  });
  db.findOwner.mockResolvedValue(owner);
  db.getSession.mockResolvedValue(session);
  db.reserveCode.mockResolvedValue(false);
  db.consumeCode.mockResolvedValue(true);
  db.createSession.mockResolvedValue(session);
  db.findRefreshSession.mockResolvedValue(session);
  db.rotateSession.mockResolvedValue(true);
  runtime.listTodos.mockResolvedValue({ items: [] });
  runtime.createTodo.mockResolvedValue({ id: "new" });
});

describe("actual protected route handlers", () => {
  it("rejects anonymous reads and writes, including spoofed tenant headers", async () => {
    const headers = { "x-tenant-id": owner.tenantId };
    const responses = await Promise.all([
      list(request("/api/todos", "GET", headers)),
      create(request("/api/todos", "POST", headers, { title: "bad" })),
      detail(request("/api/todos/id", "GET", headers), params),
      update(request("/api/todos/id", "PATCH", headers, {}), params),
      remove(request("/api/todos/id", "DELETE", headers), params),
      complete(request("/api/todos/id/complete", "POST", headers, {}), params),
      reopen(request("/api/todos/id/reopen", "POST", headers, {}), params),
      upload(request("/api/storage/blob/upload", "POST", headers, {})),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(401));
    expect(db.findOwner).not.toHaveBeenCalled();
    expect(runtime.createTodo).not.toHaveBeenCalled();
  });
  it.each([
    "broken",
    issueAccessToken(owner, session.id, secret, 1),
    issueAccessToken(owner, session.id, "incorrect-key"),
  ])("rejects invalid/expired tokens", async (value) => {
    expect(
      (
        await list(
          request("/api/todos", "GET", { authorization: `Bearer ${value}` }),
        )
      ).status,
    ).toBe(401);
    expect(runtime.listTodos).not.toHaveBeenCalled();
  });
  it("uses only verified session tenant scope", async () => {
    const response = await list(
      request("/api/todos", "GET", { authorization: `Bearer ${token}` }),
    );
    expect(response.status).toBe(200);
    expect(runtime.listTodos).toHaveBeenCalledWith(expect.anything(), {
      tenantId: owner.tenantId,
    });
    expect(
      (
        await list(
          request("/api/todos", "GET", {
            authorization: `Bearer ${token}`,
            "x-tenant-id": "tenant-2",
          }),
        )
      ).status,
    ).toBe(403);
    expect(runtime.listTodos).toHaveBeenCalledTimes(1);
  });
  it("rechecks revoked sessions and absent membership before querying todos", async () => {
    db.getSession.mockResolvedValue(null);
    expect(
      (
        await list(
          request("/api/todos", "GET", { authorization: `Bearer ${token}` }),
        )
      ).status,
    ).toBe(401);
    db.getSession.mockResolvedValue(session);
    db.findOwner.mockResolvedValue(null);
    expect(
      (
        await list(
          request("/api/todos", "GET", { authorization: `Bearer ${token}` }),
        )
      ).status,
    ).toBe(403);
    expect(runtime.listTodos).not.toHaveBeenCalled();
  });
  it("requires the configured Origin for browser-cookie writes", async () => {
    const cookie = `openhuli_access=${token}`;
    for (const origin of [undefined, "https://attacker.example.test"]) {
      const response = await create(
        request(
          "/api/todos",
          "POST",
          { cookie, ...(origin ? { origin } : {}) },
          { title: "test" },
        ),
      );
      expect(response.status).toBe(403);
    }
    expect(runtime.createTodo).not.toHaveBeenCalled();
    expect(
      (
        await create(
          request(
            "/api/todos",
            "POST",
            { cookie, origin: "http://localhost:3000" },
            { title: "test", tenantId: "tenant-2" },
          ),
        )
      ).status,
    ).toBe(201);
    expect(runtime.createTodo).toHaveBeenCalledWith(
      { title: "test", priority: "medium" },
      { tenantId: owner.tenantId },
    );
  });
});
describe("owner session HTTP handlers", () => {
  it("returns no-store owner details without tokens", async () => {
    const response = await handleGetMe(
      request("/api/auth/me", "GET", { cookie: `openhuli_access=${token}` }),
    );
    expect(await response.json()).toEqual(owner);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects unknown input and cross-origin login", async () => {
    expect(
      (
        await handleRequestCode(
          request(
            "/api/auth/request-code",
            "POST",
            { origin: "https://attacker.example.test" },
            { email: owner.email },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRequestCode(
          request(
            "/api/auth/request-code",
            "POST",
            { origin: "http://localhost:3000" },
            { email: owner.email, tenantId: "tenant-2" },
          ),
        )
      ).status,
    ).toBe(400);
    expect(db.reserveCode).not.toHaveBeenCalled();
  });
  it("sets HttpOnly scoped cookies after OTP and never returns access/refresh secrets in JSON", async () => {
    const response = await handleVerifyCode(
      request(
        "/api/auth/verify-code",
        "POST",
        { origin: "http://localhost:3000" },
        { email: owner.email, code: "123456" },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(owner);
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax; Path=/;",
    );
    expect(response.headers.get("set-cookie")).toContain("Path=/api/auth;");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
  it("rotates refresh cookies and rejects replay", async () => {
    const req = () =>
      request(
        "/api/auth/refresh",
        "POST",
        {
          origin: "http://localhost:3000",
          cookie: "openhuli_refresh=synthetic-refresh",
        },
        {},
      );
    expect((await handleRefresh(req())).status).toBe(200);
    db.rotateSession.mockResolvedValue(false);
    expect((await handleRefresh(req())).status).toBe(401);
  });
  it("revokes sessions and clears browser cookies on sign out", async () => {
    const response = await handleLogout(
      request(
        "/api/auth/logout",
        "POST",
        {
          origin: "http://localhost:3000",
          cookie: "openhuli_refresh=synthetic-refresh",
        },
        {},
      ),
    );
    expect(response.status).toBe(204);
    expect(db.revokeSession).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

it("preserves provider signature verification for upload callbacks without an owner cookie", async () => {
  const key = "synthetic-provider-callback-key";
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", key);
  storage.getObjectStorage.mockReturnValue({ provider: () => "vercel_blob" });
  const body = {
    type: "blob.upload-completed",
    payload: {
      blob: {
        url: "https://example.test/file",
        downloadUrl: "https://example.test/file",
        pathname: "tenant-1/file",
        contentType: "text/plain",
        contentDisposition: "inline",
        etag: "test",
      },
      tokenPayload: "synthetic",
    },
  };
  const signature = createHmac("sha256", key)
    .update(JSON.stringify(body))
    .digest("hex");
  try {
    const accepted = await upload(
      request(
        "/api/storage/blob/upload",
        "POST",
        { "x-vercel-signature": signature },
        body,
      ),
    );
    expect(accepted.status).toBe(200);
    const rejected = await upload(
      request(
        "/api/storage/blob/upload",
        "POST",
        { "x-vercel-signature": "0".repeat(64) },
        body,
      ),
    );
    expect(rejected.status).not.toBe(200);
    expect(db.getSession).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
