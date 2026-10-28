import { z } from "zod";
import { OpenHuliIdSchema, OpenHuliJsonObjectSchema } from "@corely/contracts";
import { defineTool } from "@corely/modules-tool-execution";
import {
  getTelemetryHistory,
  getTelemetryLatest,
  listTelemetryDevices,
  type TelemetryDependencies,
} from "./telemetry.use-cases";

export function createTelemetryTools(deps: TelemetryDependencies) {
  const policy = {
    revision: "v1",
    effect: "read" as const,
    risk: "low" as const,
    approval: "never" as const,
    timeoutMs: 3000,
    maxAttempts: 1,
    output: OpenHuliJsonObjectSchema,
  };
  return [
    defineTool({
      ...policy,
      id: "device.list",
      resource: "tenant",
      input: z.object({}).strict(),
      execute: async (_args, context) => ({
        kind: "succeeded",
        output: await listTelemetryDevices(context, deps),
      }),
    }),
    defineTool({
      ...policy,
      id: "telemetry.latest",
      resource: "device",
      input: z.object({ deviceId: OpenHuliIdSchema }).strict(),
      target: (args) => args.deviceId,
      execute: async (args, context) => ({
        kind: "succeeded",
        output: await getTelemetryLatest(args, context, deps),
      }),
    }),
    defineTool({
      ...policy,
      id: "telemetry.history",
      resource: "device",
      input: z
        .object({
          deviceId: OpenHuliIdSchema,
          from: z.string().datetime({ offset: true }).nullable().default(null),
          to: z.string().datetime({ offset: true }).nullable().default(null),
          take: z.number().int().min(1).max(10).default(10),
        })
        .strict(),
      target: (args) => args.deviceId,
      execute: async (args, context) => ({
        kind: "succeeded",
        output: await getTelemetryHistory(
          {
            deviceId: args.deviceId,
            take: args.take,
            ...(args.from ? { from: args.from } : {}),
            ...(args.to ? { to: args.to } : {}),
          },
          context,
          deps,
        ),
      }),
    }),
  ];
}
