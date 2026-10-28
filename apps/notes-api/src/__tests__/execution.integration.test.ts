import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "@corely/data";
import {
  IdentityRepository,
  issueAccessToken,
  readAuthConfig,
} from "@corely/modules-identity";
import { DeviceAccessRepository } from "@corely/modules-devices";
import { NotesRepository, createNote, findNote } from "@corely/modules-notes";
import {
  createHttpToolRegistry,
  JsonHttpClient,
  type JsonRequest,
} from "@corely/modules-http-tools";
import {
  ToolExecutionRepository,
  submitToolCall,
  dispatchToolExecution,
  reconcileToolExecution,
  preauthorizeTool,
  type ToolAuthentication,
  type ToolDependencies,
} from "@corely/modules-tool-execution";
import { createNotesServer } from "../server";
import { readNotesApiConfig } from "../config";
const db = new PrismaService(),
  identity = new IdentityRepository(db),
  devices = new DeviceAccessRepository(db);
const tenantId = randomUUID(),
  userId = randomUUID();
const auth = readAuthConfig({
  NODE_ENV: "development",
  OWNER_EMAIL: `http-tools-${randomUUID()}@example.test`,
});
let authentication: ToolAuthentication;
const directory = mkdtempSync(join(tmpdir(), "openhuli-http-integration-"));
let notes = new NotesRepository(join(directory, "notes.sqlite"));
const token = "synthetic-notes-api-token-at-least-32-characters";
const servers: Server[] = [];
beforeAll(async () => {
  await db.connect();
  await db.user.create({
    data: { id: userId, email: auth.ownerEmail, passwordHash: "" },
  });
  await db.tenant.create({
    data: { id: tenantId, name: "Synthetic HTTP test", slug: tenantId },
  });
  const role = await db.role.create({
    data: { tenantId, name: "Owner", systemKey: "OWNER", scope: "TENANT" },
  });
  await db.membership.create({ data: { tenantId, userId, roleId: role.id } });
  const owner = {
    tenantId,
    userId,
    tenantName: "Synthetic HTTP test",
    email: auth.ownerEmail,
    name: "Owner",
  };
  const session = await identity.createSession(
    owner,
    randomUUID(),
    new Date(Date.now() + 3600000),
  );
  authentication = {
    kind: "owner",
    token: issueAccessToken(owner, session.id, auth.secret),
  };
});
afterAll(async () => {
  for (const server of servers)
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  notes.close();
  rmSync(directory, { recursive: true, force: true });
  await db.toolPreauthorization.deleteMany({ where: { tenantId } });
  await db.toolExecution.deleteMany({ where: { tenantId } });
  await db.conversationTurn.deleteMany({ where: { tenantId } });
  await db.agentRun.deleteMany({ where: { tenantId } });
  await db.refreshToken.deleteMany({ where: { tenantId } });
  await db.membership.deleteMany({ where: { tenantId } });
  await db.role.deleteMany({ where: { tenantId } });
  await db.tenant.delete({ where: { id: tenantId } });
  await db.user.delete({ where: { id: userId } });
  await db.disconnect();
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  return `http://127.0.0.1:${address.port}/notes`;
}
async function fixture(url: string, client?: JsonHttpClient) {
  const registry = createHttpToolRegistry(
    {
      notes: {
        destination: { url, privateDemo: true },
        secretReference: "demo",
      },
    },
    { get: async () => token },
    client,
  );
  const deps: ToolDependencies = {
    store: new ToolExecutionRepository(db),
    registry,
    identity,
    devices,
    auth,
  };
  const runId = randomUUID(),
    turnId = randomUUID();
  await db.agentRun.create({ data: { id: runId, tenantId, status: "active" } });
  await db.conversationTurn.create({
    data: {
      id: turnId,
      tenantId,
      runId,
      sequence: 1n,
      source: "text",
      status: "committed",
      correlationId: "test",
    },
  });
  await preauthorizeTool(
    {
      toolId: "notes.create",
      sourceDeviceId: null,
      targetDeviceId: null,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    authentication,
    deps,
  );
  const input = {
    correlationId: "test",
    toolCall: {
      version: 1,
      conversationId: runId,
      turnId,
      toolCallId: randomUUID(),
      toolId: "notes.create",
      arguments: { text: `Synthetic note ${randomUUID()}` },
    },
  };
  return { deps, input };
}
describe("shared executor with an actual persisted HTTP provider", () => {
  it("concurrent/repeated provider delivery creates one durable note across restart", async () => {
    const server = createNotesServer(
      readNotesApiConfig({ NOTES_API_TOKEN: token }),
      {
        create: (...args) => notes.create(...args),
        find: (...args) => notes.find(...args),
      },
    );
    let posts = 0;
    server.on("request", (request) => {
      if (request.method === "POST") posts++;
    });
    const url = await listen(server),
      f = await fixture(url);
    const views = await Promise.all(
      Array.from({ length: 6 }, () =>
        submitToolCall(f.input, authentication, f.deps),
      ),
    );
    expect(new Set(views.map((view) => view.executionId)).size).toBe(1);
    const id = views[0]!.executionId;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        dispatchToolExecution(id, authentication, f.deps),
      ),
    );
    const completed = await dispatchToolExecution(id, authentication, f.deps);
    expect(completed.status).toBe("succeeded");
    expect(posts).toBe(1);
    notes.close();
    notes = new NotesRepository(join(directory, "notes.sqlite"));
    const restarted = { ...f.deps, store: new ToolExecutionRepository(db) };
    expect(
      (await submitToolCall(f.input, authentication, restarted)).output,
    ).toEqual(completed.output);
    expect(
      (await dispatchToolExecution(id, authentication, restarted)).status,
    ).toBe("succeeded");
    expect(posts).toBe(1);
    expect(notes.find(tenantId, `openhuli:${tenantId}:${id}`)?.id).toBe(
      completed.output?.id,
    );
  });
  it("keeps HTTP 202 unknown instead of claiming a completed note", async () => {
    let posts = 0;
    const url = await listen(
      createServer((request, response) => {
        if (request.method === "POST") posts++;
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end('{"pending":true}');
      }),
    );
    const f = await fixture(url),
      reserved = await submitToolCall(f.input, authentication, f.deps);
    expect(
      (
        await dispatchToolExecution(
          reserved.executionId,
          authentication,
          f.deps,
        )
      ).status,
    ).toBe("unknown");
    expect(
      (
        await reconcileToolExecution(
          reserved.executionId,
          authentication,
          f.deps,
        )
      ).status,
    ).toBe("unknown");
    expect(posts).toBe(1);
  });
  it("reconciles remote acceptance after timeout without repeating the POST", async () => {
    let posts = 0;
    const url = await listen(
      createServer(async (request, response) => {
        const context = {
          tenantId: request.headers["x-tenant-id"],
          idempotencyKey: request.headers["idempotency-key"],
        };
        if (request.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const note = createNote(
            JSON.parse(Buffer.concat(chunks).toString()),
            context,
            notes,
          );
          posts++;
          setTimeout(() => {
            response.writeHead(201, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ note }));
          }, 100).unref();
        } else {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ note: findNote(context, notes) }));
        }
      }),
    );
    class FastClient extends JsonHttpClient {
      override send(input: JsonRequest) {
        return super.send({ ...input, timeoutMs: 20 });
      }
    }
    const f = await fixture(url, new FastClient());
    const reserved = await submitToolCall(f.input, authentication, f.deps);
    expect(
      (
        await dispatchToolExecution(
          reserved.executionId,
          authentication,
          f.deps,
        )
      ).status,
    ).toBe("unknown");
    expect(
      (
        await dispatchToolExecution(
          reserved.executionId,
          authentication,
          f.deps,
        )
      ).status,
    ).toBe("unknown");
    expect(posts).toBe(1);
    const result = await reconcileToolExecution(
      reserved.executionId,
      authentication,
      f.deps,
    );
    expect(result.status).toBe("succeeded");
    expect(result.output?.text).toBe(f.input.toolCall.arguments.text);
    expect(posts).toBe(1);
  });
});
