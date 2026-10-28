import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import {
  createDeviceCommandTools,
  type DeviceCommandDependencies,
} from "@corely/modules-device-commands";
import { PrismaService } from "@corely/data";
import { OpenHuliIdSchema, OpenHuliJsonObjectSchema } from "@corely/contracts";
import {
  DeviceAccessRepository,
  readConfiguredDeviceContext,
} from "@corely/modules-devices";
import { IdentityRepository, readAuthConfig } from "@corely/modules-identity";
import {
  ToolRegistry,
  ToolExecutionRepository,
  defineTool,
  submitToolCall,
  dispatchToolExecution,
  getToolExecution,
  cancelToolExecution,
  type ToolAuthentication,
} from "@corely/modules-tool-execution";
import {
  ConversationRepository,
  createConversationJournal,
  createConversationRuntime,
  type ConversationProviderFactory,
} from "@corely/modules-conversations";
import type { RuntimeConfig } from "./config";
import { createGeminiLiveProvider } from "./gemini-live";

/** Server composition owns verified credential references. No tokens or keys cross the provider port. */
export function createLiveConversationRuntime(
  config: RuntimeConfig,
  provider?: ConversationProviderFactory,
  commands?: DeviceCommandDependencies,
) {
  const auth = readAuthConfig();
  const persistence = new PrismaService();
  const devices = new DeviceAccessRepository(persistence);
  const registry = new ToolRegistry([
    ...(commands ? createDeviceCommandTools(commands) : []),
    defineTool({
      id: "device_context",
      revision: "1",
      effect: "read",
      resource: "device",
      risk: "low",
      approval: "never",
      timeoutMs: 2000,
      maxAttempts: 1,
      input: z.object({ deviceId: OpenHuliIdSchema }).strict(),
      output: OpenHuliJsonObjectSchema,
      target: (args) => args.deviceId,
      execute: async (args, context) => ({
        kind: "succeeded",
        output: await readConfiguredDeviceContext(
          args.deviceId,
          context,
          devices,
        ),
      }),
    }),
  ]);
  const deps = {
    store: new ToolExecutionRepository(persistence),
    devices,
    identity: new IdentityRepository(persistence),
    auth,
    registry,
  };
  const inflight = new Set<Promise<unknown>>();
  const factory = (ownerToken?: string) =>
    createConversationRuntime({
      provider:
        provider ?? createGeminiLiveProvider(config.GEMINI_API_KEY ?? ""),
      journal: createConversationJournal(
        new ConversationRepository(persistence),
      ),
      tools: [
        ...(commands
          ? [
              {
                id: "device.ping",
                description:
                  "Ask one exact authorized online device to acknowledge a ping. Success requires a device receipt. Clarify ambiguous targets.",
                parameters: {
                  type: "OBJECT",
                  properties: { deviceId: { type: "STRING" } },
                  required: ["deviceId"],
                },
              },
              {
                id: "display.message",
                description:
                  "Display text on one exact authorized device with a configured display. Requires owner consent and a device acknowledgement. Never guess a target.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    deviceId: { type: "STRING" },
                    text: { type: "STRING" },
                  },
                  required: ["deviceId", "text"],
                },
              },
            ]
          : []),
        {
          id: "device_context",
          description:
            "Read owner-configured name, room, location and capabilities for one exact authorized device ID. This is configuration, not a live sensor reading. Ask for clarification if the target is ambiguous.",
          parameters: {
            type: "OBJECT",
            properties: { deviceId: { type: "STRING" } },
            required: ["deviceId"],
          },
        },
      ],
      maxToolCalls: config.AI_MAX_TOOL_CALLS,
      turnTimeoutMs: config.AI_TURN_TIMEOUT_MS,
      execute(context, call, pending) {
        const task = (async () => {
          const auth: ToolAuthentication = ownerToken
            ? { kind: "owner", token: ownerToken }
            : {
                kind: "verified-device",
                session: {
                  tenantId: context.tenantId,
                  deviceId: context.deviceId,
                  credentialId: context.credentialId,
                  purpose: "voice",
                },
              };
          const queued = await submitToolCall(
            {
              toolCall: {
                version: 1,
                conversationId: context.conversationId,
                turnId: context.turnId,
                toolCallId: call.id,
                toolId: call.name,
                arguments: call.arguments,
              },
              correlationId: context.turnId,
            },
            auth,
            deps,
          );
          let result = await dispatchToolExecution(
            queued.executionId,
            auth,
            deps,
            context.signal,
          );
          if (result.status === "awaiting_approval") {
            pending?.(result.executionId);
            try {
              while (result.status === "awaiting_approval") {
                await pause(200, undefined, { signal: context.signal });
                result = await getToolExecution(result.executionId, auth, deps);
              }
              if (result.status === "queued")
                result = await dispatchToolExecution(
                  result.executionId,
                  auth,
                  deps,
                  context.signal,
                );
            } catch {
              await cancelToolExecution(result.executionId, auth, deps);
              throw new Error("Approval wait stopped");
            }
          }
          return {
            executionId: result.executionId,
            status: result.status,
            outcome: result.outcome,
            output: result.output,
            error: result.error,
            approvalId: result.approvalId,
          };
        })();
        inflight.add(task);
        void task.then(
          () => inflight.delete(task),
          () => inflight.delete(task),
        );
        return task;
      },
    });
  return {
    ...factory(),
    isReady: () => Boolean(provider || config.GEMINI_API_KEY),
    tools: deps,
    repository: new ConversationRepository(persistence),
    openOwner(
      context: Parameters<ReturnType<typeof factory>["open"]>[0],
      token: string,
    ) {
      return factory(token).open(context);
    },
    async close() {
      await Promise.allSettled([...inflight]);
      await persistence.disconnect();
    },
  };
}
