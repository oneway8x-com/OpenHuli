import { z } from "zod";
import { OpenHuliIdSchema, OpenHuliJsonObjectSchema } from "@corely/contracts";
import { defineTool } from "@corely/modules-tool-execution";
import {
  dispatchDeviceCommand,
  getCommandOutcome,
} from "./device-command.use-cases";
import type { DeviceCommandDependencies } from "./device-command.types";

export function createDeviceCommandTools(deps: DeviceCommandDependencies) {
  const policy = {
    revision: "v1",
    effect: "write" as const,
    resource: "device" as const,
    risk: "low" as const,
    approval: "never" as const,
    timeoutMs: deps.acknowledgementTimeoutMs + 3000,
    maxAttempts: 1,
    output: OpenHuliJsonObjectSchema,
  };
  const outcome = (
    result: Awaited<ReturnType<typeof dispatchDeviceCommand>>,
  ) => {
    if (["unknown", "pending", "prepared"].includes(result.status))
      throw new Error("Device command outcome unknown; do not replay");
    return {
      kind:
        result.status === "succeeded"
          ? ("succeeded" as const)
          : ("failed" as const),
      output: OpenHuliJsonObjectSchema.parse(result),
    };
  };
  const reconcile = async (
    _args: unknown,
    context: { tenantId: string; executionId: string },
  ) => {
    const result = await getCommandOutcome(context.executionId, context, deps);
    return result.status === "unknown"
      ? { kind: "unknown" as const }
      : outcome(result);
  };
  return [
    defineTool({
      ...policy,
      id: "device.ping",
      input: z.object({ deviceId: OpenHuliIdSchema }).strict(),
      target: (args) => args.deviceId,
      execute: async (args, context) =>
        outcome(
          await dispatchDeviceCommand(
            { ...args, action: { kind: "ping" } },
            context,
            deps,
          ),
        ),
      reconcile,
    }),
    defineTool({
      ...policy,
      id: "display.message",
      input: z
        .object({
          deviceId: OpenHuliIdSchema,
          text: z.string().min(1).max(512),
        })
        .strict(),
      target: (args) => args.deviceId,
      execute: async (args, context) =>
        outcome(
          await dispatchDeviceCommand(
            {
              deviceId: args.deviceId,
              action: { kind: "display.write", text: args.text },
            },
            context,
            deps,
          ),
        ),
      reconcile,
    }),
  ];
}
