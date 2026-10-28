import {
  startConversation,
  startConversationTurn,
  transitionConversationTurn,
} from "@corely/modules-conversations";
import { submitToolCall } from "@corely/modules-tool-execution";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaService } from "@corely/data";
import { z } from "zod";
import { IntegrationSettingsSchema } from "@corely/contracts";
import { createDeviceManagement } from "../management";
import { createTelemetryServices } from "../telemetry-services";
import { createConsoleHttpFixture } from "./console-http-fixture";
import { ingestBrokerMessage } from "@corely/modules-telemetry";
import { ingestDeviceCommandResult } from "@corely/modules-device-commands";
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
import { createRuntime } from "../runtime";
import { readRuntimeConfig } from "../config";
process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.JWT_SECRET = "synthetic-management-secret-at-least-32-chars";
process.env.OWNER_EMAIL = `management-${randomUUID()}@example.test`;
process.env.APP_URL = "http://127.0.0.1:3100";
const db = new PrismaService(),
  identity = new IdentityRepository(db);
let userId = "",
  tenantId = "",
  token = "",
  deviceId = "",
  endpoint = "";
let fixture: Awaited<ReturnType<typeof createConsoleHttpFixture>>,
  services: ReturnType<typeof createTelemetryServices>,
  published = 0,
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
  services = createTelemetryServices(config);
  services.commands.publisher = {
    isReady: () => true,
    async publishCommand(command) {
      published++;
      await ingestDeviceCommandResult(
        {
          identity:
            paired.credentials.find((c) => c.purpose === "mqtt")
              ?.mqttUsername ?? "",
          topic: paired.mqtt.commandResults,
          retained: false,
          payload: JSON.stringify({
            version: 1,
            type: "device.command.result",
            messageId: randomUUID(),
            deviceId,
            commandId: command.commandId,
            executionId: command.executionId,
            status: "succeeded",
            completedAt: new Date().toISOString(),
          }),
        },
        services.commands,
      );
      return "accepted";
    },
  };
  await ingestBrokerMessage(
    {
      identity:
        paired.credentials.find((c) => c.purpose === "mqtt")?.mqttUsername ??
        "",
      topic: paired.mqtt.presence,
      retained: false,
      payload: JSON.stringify({
        version: 1,
        type: "device.presence",
        messageId: randomUUID(),
        deviceId,
        bootId: "management-test",
        sequence: 0,
        status: "online",
        sentAt: new Date().toISOString(),
      }),
    },
    services.telemetry,
  );
  fixture = await createConsoleHttpFixture(config, services.commands);
  host = createRuntime(config, {
    management: createDeviceManagement(fixture.composition, services.telemetry),
  });
  const address = await host.start();
  endpoint = `http://127.0.0.1:${address.port}/management`;
});
afterAll(async () => {
  await host?.stop();
  await fixture?.close();
  await services?.close();
  if (tenantId) {
    await db.deviceCommand.deleteMany({ where: { tenantId } });
    await db.agentRun.deleteMany({ where: { tenantId } });
    await db.device.deleteMany({ where: { tenantId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });
  }
  await db.disconnect();
});
async function post(body: unknown, bearer = token) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function read(executionId: string, targetId = deviceId) {
  const response = await fetch(
    `${endpoint}?execution=${executionId}&device=${targetId}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  expect(response.status).toBe(200);
  return z
    .object({
      executionId: z.string(),
      status: z.string(),
      approvalId: z.string().nullable(),
      requestHash: z.string(),
    })
    .parse(await response.json());
}
it("requires authentication, rejects browser Origin, foreign devices and forged Tenant", async () => {
  expect((await fetch(endpoint)).status).toBe(401);
  expect(
    (
      await fetch(endpoint, {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://evil.example",
        },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await post({
        action: "settings",
        tenantId: "other",
        settings: { weather: null, weatherEnabled: false, notesEnabled: false },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post({
        action: "command",
        deviceId: "foreign",
        toolId: "device.ping",
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post({
        action: "command",
        deviceId,
        toolId: "display.message",
        text: "unsupported",
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  const foreign = await db.tenant.create({
    data: { name: "Foreign", slug: randomUUID() },
  });
  const record = await db.device.create({
    data: { tenantId: foreign.id, name: "Foreign", manifestJson: "{}" },
  });
  try {
    expect(
      (
        await fetch(`${endpoint}?device=${record.id}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(400);
  } finally {
    await db.device.delete({ where: { id: record.id } });
    await db.tenant.delete({ where: { id: foreign.id } });
  }
  expect(published).toBe(0);
});
it("deduplicates command requests and approval delivery, exact arguments bind approval", async () => {
  const command = {
    action: "command",
    deviceId,
    toolId: "device.ping",
    requestId: randomUUID(),
  };
  const responses = await Promise.all([post(command), post(command)]);
  const bodies = await Promise.all(
    responses.map(async (r) =>
      z.object({ executionId: z.string().optional() }).parse(await r.json()),
    ),
  );
  // A competing initial turn reservation may be rejected; any accepted request refers to one execution.
  const accepted = bodies.filter((v) => typeof v.executionId === "string");
  expect(accepted.length).toBeGreaterThan(0);
  const id = z.string().parse(accepted[0].executionId);
  const repeated = await post(command);
  expect(repeated.status).toBe(202);
  expect(
    z.object({ executionId: z.string() }).parse(await repeated.json())
      .executionId,
  ).toBe(id);
  const recovered = await fetch(
    `${endpoint}?request=${command.requestId}&device=${deviceId}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  expect(recovered.status).toBe(200);
  expect(
    z.object({ executionId: z.string() }).parse(await recovered.json())
      .executionId,
  ).toBe(id);
  expect(
    (
      await fetch(`${endpoint}?execution=${id}&device=other-device`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(400);
  const execution = await read(id);
  expect(execution.status).toBe("awaiting_approval");
  expect(published).toBe(0);
  const approval = {
    action: "approval",
    decision: {
      version: 1,
      executionId: id,
      approvalId: execution.approvalId,
      requestHash: execution.requestHash,
      targetDeviceId: deviceId,
      decision: "approve",
    },
  };
  expect(
    (
      await post({
        ...approval,
        decision: { ...approval.decision, requestHash: "0".repeat(64) },
      })
    ).status,
  ).toBe(400);
  expect((await post(approval)).status).toBe(202);
  await vi.waitFor(async () =>
    expect((await read(id)).status).toBe("succeeded"),
  );
  await post(approval);
  await post(command);
  expect(published).toBe(1);
  expect(await db.deviceCommand.count({ where: { tenantId, deviceId } })).toBe(
    1,
  );
  const foreign = await db.tenant.create({
    data: { name: "Foreign lookup", slug: randomUUID() },
  });
  const foreignRun = await db.agentRun.create({
    data: { tenantId: foreign.id, status: "active" },
  });
  const foreignExecution = await db.toolExecution.create({
    data: {
      tenantId: foreign.id,
      runId: foreignRun.id,
      toolCallId: randomUUID(),
      status: "queued",
      toolName: "device.ping",
      inputJson: "{}",
    },
  });
  try {
    expect(
      (
        await fetch(`${endpoint}?execution=${foreignExecution.id}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(400);
  } finally {
    await db.agentRun.delete({ where: { id: foreignRun.id } });
    await db.tenant.delete({ where: { id: foreign.id } });
  }
});
it("persists Tenant settings, tests actual authenticated notes health without writes, and disables future tools", async () => {
  const context = { tenantId };
  const runId = randomUUID(),
    turnId = randomUUID();
  await startConversation(
    { id: runId, deviceId, correlationId: runId },
    context,
    fixture.composition.repository,
  );
  await startConversationTurn(
    {
      version: 1,
      conversationId: runId,
      turnId,
      turnSequence: 1,
      source: "text",
      status: "collecting",
      correlationId: turnId,
    },
    context,
    fixture.composition.repository,
  );
  await transitionConversationTurn(
    { conversationId: runId, turnId, status: "committed" },
    context,
    fixture.composition.repository,
  );
  const pending = await submitToolCall(
    {
      toolCall: {
        version: 1,
        conversationId: runId,
        turnId,
        toolCallId: randomUUID(),
        toolId: "notes.create",
        arguments: { text: "Must not be created" },
      },
      correlationId: turnId,
    },
    { kind: "owner", token },
    {
      ...fixture.composition.tools,
      registry: await fixture.composition.registryForTenant(tenantId),
    },
  );
  expect(pending.status).toBe("awaiting_approval");
  const before = fixture.posts();
  expect((await post({ action: "test", toolId: "notes.create" })).status).toBe(
    200,
  );
  expect(fixture.posts()).toBe(before);
  const configResponse = await fetch(endpoint, {
    headers: { authorization: `Bearer ${token}` },
  });
  const config = z
    .object({ settings: IntegrationSettingsSchema })
    .parse(await configResponse.json());
  expect(JSON.stringify(config)).not.toMatch(
    /secretReference|console-fixture|synthetic-console-notes-token/,
  );
  expect(
    (
      await post({
        action: "settings",
        settings: {
          ...config.settings,
          notesEnabled: false,
          weatherEnabled: false,
        },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post({
        action: "approval",
        decision: {
          version: 1,
          executionId: pending.executionId,
          approvalId: pending.approvalId,
          requestHash: pending.requestHash,
          targetDeviceId: null,
          decision: "approve",
        },
      })
    ).status,
  ).toBe(400);
  expect(fixture.posts()).toBe(before);
  const registry = await fixture.composition.registryForTenant(tenantId);
  expect(() => registry.get("notes.create")).toThrow();
  expect(() => registry.get("weather.forecast")).toThrow();
  expect((await post({ action: "test", toolId: "notes.create" })).status).toBe(
    400,
  );
  const stored = await db.integrationConnection.findMany({
    where: { tenantId },
  });
  expect(stored).toHaveLength(1);
  expect(stored[0].secretEncrypted).toBeNull();
  expect(JSON.stringify(stored[0].configJson)).not.toContain("secret");
});
it("rejects reuse of a display request identity with changed text and never dispatches a denied command", async () => {
  const paired = await pairOwnerDevice(
    {
      name: "Exact display",
      profileId: "weather-station",
      profileVersion: 1,
      capabilities: [
        { kind: "temperature" },
        { kind: "humidity" },
        { kind: "ping" },
        { kind: "display", maxTextLength: 32 },
      ],
    },
    { tenantId, userId },
    new DeviceAccessRepository(db),
  );
  const body = {
    action: "command",
    deviceId: paired.device.id,
    toolId: "display.message",
    text: "First text",
    requestId: randomUUID(),
  };
  const created = await post(body);
  expect(created.status).toBe(202);
  const id = z
    .object({ executionId: z.string() })
    .parse(await created.json()).executionId;
  expect((await post({ ...body, text: "Changed text" })).status).toBe(400);
  const item = await read(id, paired.device.id),
    before = published;
  expect(
    (
      await post({
        action: "approval",
        decision: {
          version: 1,
          executionId: id,
          approvalId: item.approvalId,
          requestHash: item.requestHash,
          targetDeviceId: paired.device.id,
          decision: "reject",
        },
      })
    ).status,
  ).toBe(202);
  expect((await read(id, paired.device.id)).status).toBe("cancelled");
  expect(published).toBe(before);
});
