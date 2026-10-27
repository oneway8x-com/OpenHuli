import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "@corely/data";
import { DeviceRepository } from "../device.repository";
import * as device from "../device.use-cases";

const db = new PrismaService();
const repository = new DeviceRepository(db);
const a = { tenantId: randomUUID() };
const b = { tenantId: randomUUID() };
const deviceId = randomUUID();
const bound = { ...a, deviceId };
const now = new Date("2026-10-27T12:00:00Z");
const later = new Date(now.getTime() + 60_000);
const manifest = {
  version: 1,
  messageId: "manifest-1",
  type: "device.manifest",
  deviceId,
  firmwareVersion: "1",
  capabilities: [{ kind: "ping" }, { kind: "temperature" }],
};

beforeAll(async () => {
  await db.connect();
  for (const context of [a, b])
    await db.tenant.create({
      data: { id: context.tenantId, name: "Test", slug: context.tenantId },
    });
  await device.registerDevice({ name: "Test device", manifest }, a, repository);
});
afterAll(async () => {
  const tenantId = { in: [a.tenantId, b.tenantId] };
  await db.deviceCommand.deleteMany({ where: { tenantId } });
  await db.toolExecution.deleteMany({ where: { tenantId } });
  await db.agentRun.deleteMany({ where: { tenantId } });
  await db.device.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.disconnect();
});

describe("device persistence and isolation", () => {
  it("isolates profiles and rejects foreign tenant parent references in PostgreSQL", async () => {
    expect(await device.getDevice(deviceId, b, repository)).toBeNull();
    await expect(
      repository.addCredential(b.tenantId, {
        deviceId,
        secretHash: "a".repeat(64),
        expiresAt: later,
      }),
    ).rejects.toThrow();
    await expect(
      repository.grant(b.tenantId, {
        deviceId,
        toolId: "ping",
        expiresAt: later,
      }),
    ).rejects.toThrow();
    await expect(
      device.registerDevice(
        { name: "Bad", manifest, tenantId: b.tenantId },
        a,
        repository,
      ),
    ).rejects.toThrow();
  });
  it("persists only hashed credentials and enforces expiry, revocation and tenant scope", async () => {
    const input = { deviceId, secretHash: "a".repeat(64), expiresAt: later };
    const credential = await device.issueDeviceCredential(
      input,
      a,
      repository,
      now,
    );
    const proof = { id: credential.id, secretHash: input.secretHash };
    expect(
      await device.authenticateDeviceCredential(proof, a, repository, now),
    ).toEqual({ deviceId });
    await expect(
      device.authenticateDeviceCredential(proof, b, repository, now),
    ).rejects.toThrow("Invalid device credential");
    await expect(
      device.authenticateDeviceCredential(
        { ...proof, secretHash: "b".repeat(64) },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow();
    expect(
      (await device.revokeDeviceCredential(credential.id, b, repository, now))
        .count,
    ).toBe(0);
    await expect(
      device.authenticateDeviceCredential(proof, a, repository, later),
    ).rejects.toThrow();
    await device.revokeDeviceCredential(credential.id, a, repository, now);
    await expect(
      device.authenticateDeviceCredential(proof, a, repository, now),
    ).rejects.toThrow();
    await expect(
      device.issueDeviceCredential(
        { ...input, secretHash: "raw-secret" },
        a,
        repository,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      device.issueDeviceCredential(input, b, repository, now),
    ).rejects.toThrow("Device not found");
  });
  it("persists scoped grants and allows only explicit renewed grants", async () => {
    const input = { deviceId, toolId: "ping", expiresAt: later };
    const key = { deviceId, toolId: "ping" };
    await device.grantDeviceTool(input, a, repository, now);
    expect(
      await device.getDeviceToolGrant(key, a, repository, now),
    ).toBeTruthy();
    expect(await device.getDeviceToolGrant(key, b, repository, now)).toBeNull();
    expect(
      (await device.revokeDeviceToolGrant(key, b, repository, now)).count,
    ).toBe(0);
    expect(
      await device.getDeviceToolGrant(key, a, repository, later),
    ).toBeNull();
    await device.revokeDeviceToolGrant(key, a, repository, now);
    expect(await device.getDeviceToolGrant(key, a, repository, now)).toBeNull();
    await expect(
      device.grantDeviceTool(input, b, repository, now),
    ).rejects.toThrow();
  });
  it("deduplicates concurrent telemetry, supports uint32 sequence and rejects device impersonation", async () => {
    const telemetry = {
      version: 1,
      messageId: randomUUID(),
      type: "device.telemetry",
      deviceId,
      bootId: "boot-1",
      sequence: 4294967295,
      sampledAt: now.toISOString(),
      readings: [{ metric: "temperature", value: 22, unit: "degC" }],
    };
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        device.recordDeviceTelemetry(telemetry, bound, repository),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      await device.recordDeviceTelemetry(
        { ...telemetry, messageId: randomUUID() },
        bound,
        new DeviceRepository(db),
      ),
    ).toBe(false);
    expect(
      await device.getDeviceTelemetry({ deviceId }, a, repository),
    ).toHaveLength(1);
    expect(
      await device.getDeviceTelemetry({ deviceId }, b, repository),
    ).toEqual([]);
    await expect(
      device.recordDeviceTelemetry(telemetry, { ...b, deviceId }, repository),
    ).rejects.toThrow();
    await expect(
      device.recordDeviceTelemetry(
        telemetry,
        { ...a, deviceId: "another" },
        repository,
      ),
    ).rejects.toThrow("Device identity mismatch");
    await expect(
      device.recordDeviceTelemetry(
        {
          ...telemetry,
          readings: [{ metric: "humidity", value: 50, unit: "percent" }],
        },
        bound,
        repository,
      ),
    ).rejects.toThrow("unsupported");
  });
  it("persists command expiry/results without reviving expired or completed commands", async () => {
    const runId = randomUUID();
    const executionId = randomUUID();
    await db.agentRun.create({
      data: { id: runId, tenantId: a.tenantId, deviceId, status: "active" },
    });
    await db.toolExecution.create({
      data: {
        id: executionId,
        tenantId: a.tenantId,
        runId,
        toolCallId: "call-1",
        toolName: "ping",
        inputJson: "{}",
        status: "running",
      },
    });
    const command = {
      version: 1,
      messageId: randomUUID(),
      type: "device.command",
      deviceId,
      commandId: randomUUID(),
      executionId,
      issuedAt: now.toISOString(),
      expiresAt: later.toISOString(),
      action: { kind: "ping" },
    };
    await expect(
      device.queueDeviceCommand(command, b, repository, now),
    ).rejects.toThrow();
    await expect(
      repository.queueCommand(b.tenantId, {
        ...command,
        version: 1,
        type: "device.command",
        action: { kind: "ping" },
      }),
    ).rejects.toThrow();
    await device.queueDeviceCommand(command, a, repository, now);
    await expect(
      device.queueDeviceCommand(command, a, repository, now),
    ).rejects.toThrow();
    expect(
      await device.getDeviceCommand(command.commandId, b, repository),
    ).toBeNull();
    const result = {
      version: 1,
      messageId: randomUUID(),
      type: "device.command.result",
      deviceId,
      commandId: command.commandId,
      executionId,
      completedAt: now.toISOString(),
      status: "succeeded",
    };
    await expect(
      device.recordDeviceCommandResult(
        result,
        { ...b, deviceId },
        repository,
        now,
      ),
    ).rejects.toThrow();
    expect(
      (await device.recordDeviceCommandResult(result, bound, repository, now))
        .count,
    ).toBe(1);
    expect(
      (await device.recordDeviceCommandResult(result, bound, repository, now))
        .count,
    ).toBe(0);
    const secondExecution = await db.toolExecution.create({
      data: {
        tenantId: a.tenantId,
        runId,
        toolCallId: "call-2",
        toolName: "ping",
        inputJson: "{}",
        status: "running",
      },
    });
    const second = {
      ...command,
      commandId: randomUUID(),
      executionId: secondExecution.id,
    };
    await device.queueDeviceCommand(second, a, repository, now);
    expect(
      (await device.expireDeviceCommands(b, repository, later)).count,
    ).toBe(0);
    expect(
      (
        await device.recordDeviceCommandResult(
          {
            ...result,
            commandId: second.commandId,
            executionId: second.executionId,
          },
          bound,
          repository,
          later,
        )
      ).count,
    ).toBe(0);
    expect(
      (await device.getDeviceCommand(second.commandId, a, repository))?.status,
    ).toBe("expired");
    await expect(
      device.queueDeviceCommand(
        { ...command, commandId: randomUUID() },
        a,
        repository,
        later,
      ),
    ).rejects.toThrow("valid");
  });
});
