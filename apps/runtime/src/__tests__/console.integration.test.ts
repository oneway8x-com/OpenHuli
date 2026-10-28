import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaService } from "@corely/data";
import { ConsoleSnapshotSchema } from "@corely/contracts";
import {
  IdentityRepository,
  readAuthConfig,
  requestOwnerCode,
  verifyOwnerCode,
} from "@corely/modules-identity";
import {
  DeviceAccessRepository,
  pairOwnerDevice,
} from "@corely/modules-devices";
import { getTestDatabaseUrl } from "../../../../scripts/test-database";
import { createConsoleRuntime } from "../console";
import { createRuntime } from "../runtime";
import { readRuntimeConfig } from "../config";
import { createConsoleFixture } from "./console-fixture";
process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.JWT_SECRET = "synthetic-console-secret-at-least-32-chars";
process.env.OWNER_EMAIL = "console-owner@example.test";
process.env.APP_URL = "http://127.0.0.1:3100";
const db = new PrismaService(),
  identity = new IdentityRepository(db);
let userId = "",
  tenantId = "",
  token = "",
  deviceId = "",
  endpoint = "";
let fixture: ReturnType<typeof createConsoleFixture>,
  host: ReturnType<typeof createRuntime>;
beforeAll(async () => {
  const auth = readAuthConfig({ ...process.env, NODE_ENV: "test" });
  const tenant = await db.tenant.create({
    data: { name: "Console isolated tenant", slug: `console-${randomUUID()}` },
  });
  const user = await db.user.create({
    data: {
      email: auth.ownerEmail,
      name: "Console owner",
      passwordHash: "",
      status: "ACTIVE",
    },
  });
  tenantId = tenant.id;
  userId = user.id;
  const role = await db.role.create({
    data: {
      tenantId,
      name: "Owner",
      systemKey: "OWNER",
      scope: "TENANT",
      isSystem: true,
    },
  });
  await db.membership.create({ data: { tenantId, userId, roleId: role.id } });
  const owner = { tenantId, userId, email: user.email };
  await db.portalOtpCode.deleteMany({
    where: { tenantId, emailNormalized: owner.email },
  });
  let code = "";
  await requestOwnerCode(owner.email, auth, identity, async (_email, value) => {
    code = value;
  });
  token = (await verifyOwnerCode(owner.email, code, auth, identity))
    .accessToken;
  const paired = await pairOwnerDevice(
    {
      name: "Console synthetic device",
      room: "Lab",
      profileId: "weather-station",
      profileVersion: 1,
      capabilities: [
        { kind: "temperature" },
        { kind: "humidity" },
        { kind: "ping" },
      ],
    },
    { tenantId, userId: owner.userId },
    new DeviceAccessRepository(db),
  );
  deviceId = paired.device.id;
  const config = readRuntimeConfig({
    ...process.env,
    NODE_ENV: "test",
    RUNTIME_PORT: "0",
    GEMINI_API_KEY: "synthetic-unused",
    AI_TURN_TIMEOUT_MS: "5000",
  });
  fixture = createConsoleFixture(config);
  host = createRuntime(config, {
    console: createConsoleRuntime(fixture.composition, true),
  });
  const address = await host.start();
  endpoint = `http://127.0.0.1:${address.port}/console`;
});
afterAll(async () => {
  await host?.stop();
  await fixture?.composition.close();
  if (tenantId) {
    await db.agentRun.deleteMany({ where: { tenantId } });
    await db.device.deleteMany({ where: { tenantId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });
  }
  await db.disconnect();
});
async function post(command: unknown, bearer = token) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });
}
async function snapshot(id: string) {
  const response = await fetch(`${endpoint}?id=${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return ConsoleSnapshotSchema.parse(await response.json());
}
async function start(mode = "success") {
  const created = await post({ action: "create", deviceId });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { id: string };
  const turnId = randomUUID(),
    command = { action: "text", conversationId: body.id, turnId, text: mode };
  expect((await post(command)).status).toBe(202);
  let execution:
    | Awaited<ReturnType<typeof snapshot>>["executions"][number]
    | undefined;
  await vi.waitFor(async () => {
    execution = (await snapshot(body.id)).executions[0];
    expect(execution?.status).toBe("awaiting_approval");
  });
  if (!execution) throw new Error("Execution missing");
  const approval = {
    action: "approval",
    conversationId: body.id,
    executionId: execution.executionId,
    approvalId: execution.approvalId,
    requestHash: execution.requestHash,
    targetDeviceId: execution.targetDeviceId,
    decision: "approve",
  };
  return { id: body.id, command, approval, execution };
}
it("binds approval to exact execution/arguments and never repeats a submitted turn or approved write", async () => {
  const f = await start(),
    before = fixture.effects();
  expect(f.execution.arguments).toEqual({ deviceId, mode: "success" });
  expect(
    (await post({ ...f.approval, requestHash: "0".repeat(64) })).status,
  ).toBe(400);
  expect(
    (await post({ ...f.approval, targetDeviceId: "another-device" })).status,
  ).toBe(400);
  expect(fixture.effects()).toBe(before);
  expect((await post(f.approval)).status).toBe(200);
  await vi.waitFor(async () =>
    expect((await snapshot(f.id)).executions[0]?.status).toBe("succeeded"),
  );
  expect((await post(f.command)).status).toBe(202);
  expect((await post({ ...f.command, text: "different" })).status).toBe(409);
  await post(f.approval);
  expect(fixture.effects()).toBe(before + 1);
  const restored = await snapshot(f.id);
  expect(restored.messages.every((m) => m.text === null)).toBe(true);
  expect(restored.executions[0]?.output?.privateToken).toBe("[redacted]");
  expect(JSON.stringify(restored)).not.toContain("must-not-appear");
});
it("denial and cancellation prevent dispatch; unknown and partial remain explicit", async () => {
  const denied = await start(),
    before = fixture.effects();
  expect((await post({ ...denied.approval, decision: "reject" })).status).toBe(
    200,
  );
  await vi.waitFor(async () =>
    expect((await snapshot(denied.id)).executions[0]?.status).toBe("cancelled"),
  );
  expect(fixture.effects()).toBe(before);
  const cancelled = await start();
  await post({ action: "cancel", conversationId: cancelled.id });
  await vi.waitFor(async () =>
    expect((await snapshot(cancelled.id)).executions[0]?.status).toBe(
      "cancelled",
    ),
  );
  expect(fixture.effects()).toBe(before);
  for (const mode of ["unknown", "partial"]) {
    const f = await start(mode);
    await post(f.approval);
    await vi.waitFor(async () => {
      const result = (await snapshot(f.id)).executions[0];
      expect(mode === "unknown" ? result?.status : result?.outcome).toBe(mode);
    });
  }
});
it("rejects anonymous, browser-origin and cross-Tenant requests without opening provider sessions", async () => {
  expect((await post({ action: "create", deviceId }, "invalid")).status).toBe(
    401,
  );
  expect(
    (
      await fetch(endpoint, {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "http://attacker.invalid",
        },
      })
    ).status,
  ).toBe(401);
  expect(
    (await post({ action: "create", deviceId: "another-tenant-device" }))
      .status,
  ).toBe(400);
  const foreign = await db.tenant.create({
    data: { name: "Other", slug: randomUUID() },
  });
  const run = await db.agentRun.create({
    data: { tenantId: foreign.id, status: "active" },
  });
  try {
    expect(
      (
        await fetch(`${endpoint}?id=${run.id}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(400);
  } finally {
    await db.agentRun.delete({ where: { id: run.id } });
    await db.tenant.delete({ where: { id: foreign.id } });
  }
});
it("closes a timed-out approval session without dispatch or a false Ready state", async () => {
  const f = await start(),
    before = fixture.effects();
  await vi.waitFor(
    async () => {
      const view = await snapshot(f.id);
      expect(view.live).toBe(false);
      expect(view.turns[0]?.status).toBe("cancelled");
      expect(view.executions[0]?.status).toBe("cancelled");
    },
    { timeout: 7000 },
  );
  expect(fixture.effects()).toBe(before);
});
it("expires approval without dispatch and restores read-only metadata after runtime replacement", async () => {
  const f = await start(),
    before = fixture.effects();
  await db.toolExecution.update({
    where: { id: f.execution.executionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await post(f.approval);
  await vi.waitFor(async () =>
    expect((await snapshot(f.id)).executions[0]?.status).toBe("expired"),
  );
  expect(fixture.effects()).toBe(before);
  await host.stop();
  const config = readRuntimeConfig({
    ...process.env,
    NODE_ENV: "test",
    RUNTIME_PORT: "0",
  });
  host = createRuntime(config, {
    console: createConsoleRuntime(fixture.composition, false),
  });
  const address = await host.start();
  endpoint = `http://127.0.0.1:${address.port}/console`;
  expect((await snapshot(f.id)).live).toBe(false);
  expect(
    (
      await post({
        action: "text",
        conversationId: f.id,
        turnId: randomUUID(),
        text: "Do not replay",
      })
    ).status,
  ).toBe(409);
  expect((await post({ action: "create", deviceId })).status).toBe(503);
  expect(fixture.effects()).toBe(before);
});
