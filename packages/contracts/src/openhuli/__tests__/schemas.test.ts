import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DeviceCapabilityManifestSchema,
  DeviceCommandResultSchema,
  DeviceCommandSchema,
  DeviceTelemetrySchema,
  DevicePresenceSchema,
  OpenHuliApprovalDecisionSchema,
  OpenHuliApprovalRequestSchema,
  OpenHuliConversationSchema,
  OpenHuliErrorSchema,
  OpenHuliExecutionSchema,
  OpenHuliExecutionStatusSchema,
  OpenHuliJsonObjectSchema,
  OpenHuliTextTurnInputSchema,
  OpenHuliToolCallSchema,
  OpenHuliToolDefinitionSchema,
  OpenHuliTurnSchema,
  parseDeviceCommand,
  parseDeviceManifest,
  parseDeviceTelemetry,
  parseOpenHuliJson,
} from "../index";

const examples = z
  .record(z.unknown())
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../../docs/protocol/v1.examples.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const manifest = parseDeviceManifest(JSON.stringify(examples.manifest));
const telemetry = DeviceTelemetrySchema.parse(examples.telemetry);
const command = DeviceCommandSchema.parse(examples.command);
const schemaExamples: Record<string, z.ZodType> = {
  manifest: DeviceCapabilityManifestSchema,
  telemetry: DeviceTelemetrySchema,
  command: DeviceCommandSchema,
  commandResult: DeviceCommandResultSchema,
  conversation: OpenHuliConversationSchema,
  textTurn: OpenHuliTextTurnInputSchema,
  turn: OpenHuliTurnSchema,
  toolDefinition: OpenHuliToolDefinitionSchema,
  toolCall: OpenHuliToolCallSchema,
  approvalRequest: OpenHuliApprovalRequestSchema,
  approvalDecision: OpenHuliApprovalDecisionSchema,
  execution: OpenHuliExecutionSchema,
  error: OpenHuliErrorSchema,
};

describe("documented v1 contract examples", () => {
  it.each(Object.entries(schemaExamples))(
    "parses %s through the shared bounded parser",
    (key, schema) => {
      expect(parseOpenHuliJson(JSON.stringify(examples[key]), schema)).toEqual(
        examples[key],
      );
    },
  );
  it.each(Object.entries(schemaExamples).filter(([key]) => key !== "error"))(
    "rejects unknown versions and caller authority in %s",
    (key, schema) => {
      const example = z.record(z.unknown()).parse(examples[key]);
      expect(schema.safeParse({ ...example, version: 2 }).success).toBe(false);
      for (const field of ["tenantId", "ownerId", "permissions"]) {
        expect(
          schema.safeParse({ ...example, [field]: "forged" }).success,
        ).toBe(false);
      }
    },
  );
});

describe("device validation", () => {
  it("accepts readings and commands only for the bound device and capabilities", () => {
    expect(parseDeviceTelemetry(JSON.stringify(telemetry), manifest)).toEqual(
      telemetry,
    );
    expect(parseDeviceCommand(JSON.stringify(command), manifest)).toEqual(
      command,
    );
    const limited = { ...manifest, capabilities: [{ kind: "ping" as const }] };
    expect(() =>
      parseDeviceTelemetry(JSON.stringify(telemetry), limited),
    ).toThrow(/capability/);
    expect(() => parseDeviceCommand(JSON.stringify(command), limited)).toThrow(
      /capability/,
    );
    expect(() =>
      parseDeviceTelemetry(
        JSON.stringify({ ...telemetry, deviceId: "other" }),
        manifest,
      ),
    ).toThrow(/Device/);
    expect(() =>
      parseDeviceCommand(
        JSON.stringify({ ...command, deviceId: "other" }),
        manifest,
      ),
    ).toThrow(/Device/);
  });
  it("rejects unknown and duplicate capabilities, formats, and oversized display text", () => {
    for (const capabilities of [
      [{ kind: "robot.motion" }],
      [{ kind: "ping" }, { kind: "ping" }],
      [{ kind: "microphone", format: { encoding: "opus" } }],
    ]) {
      expect(
        DeviceCapabilityManifestSchema.safeParse({ ...manifest, capabilities })
          .success,
      ).toBe(false);
    }
    expect(() =>
      parseDeviceCommand(
        JSON.stringify({
          ...command,
          action: { kind: "display.write", text: "x".repeat(129) },
        }),
        manifest,
      ),
    ).toThrow(/device limit/);
    expect(
      DeviceCommandSchema.safeParse({
        ...command,
        action: { kind: "robot.motion" },
      }).success,
    ).toBe(false);
    expect(
      DeviceCommandSchema.safeParse({ ...command, expiresAt: command.issuedAt })
        .success,
    ).toBe(false);
  });
  it.each([
    { metric: "temperature", value: -41, unit: "degC" },
    { metric: "temperature", value: 126, unit: "degC" },
    { metric: "temperature", value: NaN, unit: "degC" },
    { metric: "temperature", value: Infinity, unit: "degC" },
    { metric: "temperature", value: 20, unit: "F" },
    { metric: "humidity", value: -1, unit: "percent" },
    { metric: "humidity", value: 101, unit: "percent" },
    { metric: "pressure", value: 1000, unit: "hPa" },
  ])("rejects invalid metric %j", (reading) => {
    expect(
      DeviceTelemetrySchema.safeParse({ ...telemetry, readings: [reading] })
        .success,
    ).toBe(false);
  });
  it("rejects repeated readings, invalid timestamps, and sequence overflow", () => {
    expect(
      DeviceTelemetrySchema.safeParse({
        ...telemetry,
        readings: [telemetry.readings[0], telemetry.readings[0]],
      }).success,
    ).toBe(false);
    expect(
      DeviceTelemetrySchema.safeParse({ ...telemetry, sampledAt: "yesterday" })
        .success,
    ).toBe(false);
    for (const sequence of [-1, 1.5, 0x1_0000_0000]) {
      expect(
        DeviceTelemetrySchema.safeParse({ ...telemetry, sequence }).success,
      ).toBe(false);
    }
  });
});

describe("bounded JSON and execution outcomes", () => {
  it("checks UTF-8 bytes, malformed JSON, depth, and node count before recursive parsing", () => {
    expect(() => parseOpenHuliJson(" ".repeat(16_385), z.unknown())).toThrow(
      /byte limit/,
    );
    expect(() =>
      parseOpenHuliJson(JSON.stringify("界".repeat(6000)), z.unknown()),
    ).toThrow(/byte limit/);
    expect(() => parseOpenHuliJson("{", z.unknown())).toThrow();
    let deep: unknown = {};
    for (let i = 0; i < 10; i++) deep = { child: deep };
    expect(() => parseOpenHuliJson(JSON.stringify(deep), z.unknown())).toThrow(
      /depth/,
    );
    expect(OpenHuliJsonObjectSchema.safeParse(deep).success).toBe(false);
    expect(() =>
      parseOpenHuliJson(JSON.stringify(Array(1025).fill(0)), z.unknown()),
    ).toThrow(/node/);
    const cycle: { child?: unknown } = {};
    cycle.child = cycle;
    expect(OpenHuliJsonObjectSchema.safeParse(cycle).success).toBe(false);
    expect(
      OpenHuliJsonObjectSchema.safeParse({ value: Infinity }).success,
    ).toBe(false);
  });
  it("requires approval IDs and explicit output/error shapes for all execution states", () => {
    const base = {
      version: 1,
      executionId: "e1",
      toolCallId: "tc1",
      updatedAt: "2026-10-27T10:00:00Z",
    };
    for (const status of OpenHuliExecutionStatusSchema.options) {
      const detail =
        status === "awaiting_approval"
          ? { approvalId: "a1" }
          : status === "succeeded"
            ? { output: {} }
            : ["queued", "running"].includes(status)
              ? {}
              : { error: examples.error };
      expect(
        OpenHuliExecutionSchema.safeParse({ ...base, status, ...detail })
          .success,
      ).toBe(true);
    }
    expect(
      OpenHuliExecutionSchema.safeParse({
        ...base,
        status: "awaiting_approval",
      }).success,
    ).toBe(false);
    expect(
      OpenHuliExecutionSchema.safeParse({
        ...base,
        status: "succeeded",
        error: examples.error,
      }).success,
    ).toBe(false);
    expect(
      OpenHuliExecutionSchema.safeParse({ ...base, status: "unknown" }).success,
    ).toBe(false);
    expect(
      DeviceCommandResultSchema.safeParse({
        ...z.record(z.unknown()).parse(examples.commandResult),
        status: "published",
      }).success,
    ).toBe(false);
  });
});

describe("sensor errors and presence", () => {
  it("preserves explicit unavailable metrics without fabricated measurements", () => {
    const error = { metric: "humidity", code: "read_failed" };
    expect(
      DeviceTelemetrySchema.parse({
        ...telemetry,
        readings: [],
        sensorErrors: [error],
      }).readings,
    ).toEqual([]);
    expect(
      DeviceTelemetrySchema.safeParse({
        ...telemetry,
        readings: [],
        sensorErrors: [],
      }).success,
    ).toBe(false);
    expect(
      DeviceTelemetrySchema.safeParse({
        ...telemetry,
        readings: [{ metric: "humidity", value: 50, unit: "percent" }],
        sensorErrors: [error],
      }).success,
    ).toBe(false);
    expect(
      DeviceTelemetrySchema.safeParse({
        ...telemetry,
        readings: [],
        sensorErrors: [error, error],
      }).success,
    ).toBe(false);
    expect(() =>
      parseDeviceTelemetry(
        JSON.stringify({ ...telemetry, readings: [], sensorErrors: [error] }),
        { ...manifest, capabilities: [{ kind: "ping" }] },
      ),
    ).toThrow("unsupported");
  });
  it("validates presence ordering bounds and rejects caller authority", () => {
    const presence = {
      version: 1,
      messageId: "presence-1",
      type: "device.presence",
      deviceId: "station-1",
      bootId: "boot-1",
      sequence: 4294967295,
      status: "offline",
      sentAt: "2026-10-28T10:00:00Z",
    };
    expect(DevicePresenceSchema.parse(presence).status).toBe("offline");
    for (const extra of [
      { sequence: -1 },
      { sequence: 4294967296 },
      { status: "connected" },
      { tenantId: "forged" },
      { sentAt: "yesterday" },
    ])
      expect(
        DevicePresenceSchema.safeParse({ ...presence, ...extra }).success,
      ).toBe(false);
  });
});
