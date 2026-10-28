import { z } from "zod";
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
) {
  const auth = readAuthConfig();
  const persistence = new PrismaService();
  const devices = new DeviceAccessRepository(persistence);
  const registry = new ToolRegistry([
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
  const factory = createConversationRuntime({
    provider: provider ?? createGeminiLiveProvider(config.GEMINI_API_KEY ?? ""),
    journal: createConversationJournal(new ConversationRepository(persistence)),
    tools: [
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
    async execute(context, call) {
      const auth: ToolAuthentication = {
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
      const result = await dispatchToolExecution(
        queued.executionId,
        auth,
        deps,
        context.signal,
      );
      return {
        executionId: result.executionId,
        status: result.status,
        outcome: result.outcome,
        output: result.output,
        error: result.error,
        approvalId: result.approvalId,
      };
    },
  });
  return {
    ...factory,
    async close() {
      await persistence.disconnect();
    },
  };
}
