import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NotesRepository } from "@corely/modules-notes";
import { createNotesServer } from "../server";
import { readNotesApiConfig } from "../config";
const token = "synthetic-demo-token-at-least-32-characters";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const work of cleanup.splice(0)) await work();
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openhuli-notes-api-"));
  let store = new NotesRepository(join(dir, "notes.sqlite"));
  const server = createNotesServer(
    readNotesApiConfig({ NOTES_API_TOKEN: token }),
    {
      create: (...args) => store.create(...args),
      find: (...args) => store.find(...args),
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  cleanup.push(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const req = (
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${address.port}/notes`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-tenant-id": "tenant-a",
        "idempotency-key": "key",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    req,
    restart: () => {
      store.close();
      store = new NotesRepository(join(dir, "notes.sqlite"));
    },
  };
}
describe("separate notes HTTP API", () => {
  it("persists an actual POST, returns exact idempotent receipts across restart and isolates tenants", async () => {
    const f = await fixture();
    const response = await f.req("POST", { text: "Real persisted note" });
    expect(response.status).toBe(201);
    const receipt = await response.json();
    f.restart();
    expect(
      await (await f.req("POST", { text: "Real persisted note" })).json(),
    ).toEqual(receipt);
    expect(await (await f.req("GET")).json()).toEqual(receipt);
    expect(
      (await f.req("GET", undefined, { "x-tenant-id": "tenant-b" })).status,
    ).toBe(404);
    expect((await f.req("POST", { text: "Changed content" })).status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects missing authentication, spoofed body scope, missing identities, large/malformed input", async () => {
    const f = await fixture();
    expect(
      (await f.req("POST", { text: "Denied" }, { authorization: "" })).status,
    ).toBe(401);
    expect(
      (await f.req("POST", { text: "Denied", tenantId: "other" })).status,
    ).toBe(400);
    expect(
      (await f.req("POST", { text: "Denied" }, { "idempotency-key": "" }))
        .status,
    ).toBe(400);
    expect((await f.req("POST", { text: "x".repeat(17000) })).status).toBe(400);
    expect(
      (
        await f.req(
          "POST",
          { text: "Denied" },
          { "content-type": "text/plain" },
        )
      ).status,
    ).toBe(400);
    expect((await f.req("GET")).status).toBe(404);
  });
  it("requires a server-only token and loopback binding with redacted configuration errors", () => {
    expect(() => readNotesApiConfig({})).toThrow(
      "Invalid notes API configuration",
    );
    expect(() =>
      readNotesApiConfig({ NOTES_API_TOKEN: token, NOTES_API_HOST: "0.0.0.0" }),
    ).toThrow("Invalid notes API configuration");
  });
});
