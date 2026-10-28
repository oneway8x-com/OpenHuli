import {
  createHttpTools,
  HttpIntegrationRepository,
  tenantHttpConfig,
  readIntegrationSettings,
  saveIntegrationSettings,
  testHttpIntegration,
  readHttpToolsConfig,
  type HttpToolsConfig,
  type SecretStore,
  type JsonHttpClient,
} from "@corely/modules-http-tools";
import { createTelemetryTools } from "@corely/modules-telemetry";
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
  ConversationOperationsRepository,
  createConversationBudgets,
  clearConversationPrivateData,
  readConversationDiagnostics,
  type ConversationPolicy,
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
  http?: {
    config: HttpToolsConfig;
    secrets: SecretStore;
    client?: JsonHttpClient;
  },
) {
  const auth = readAuthConfig();
  const persistence = new PrismaService();
  const devices = new DeviceAccessRepository(persistence);
  const operations = new ConversationOperationsRepository(persistence);
  const policy: ConversationPolicy = {
    sessionsPerDay: config.AI_DEVICE_SESSIONS_PER_DAY,
    concurrentSessions: config.AI_DEVICE_CONCURRENT_SESSIONS,
    audioSecondsPerDay: config.AI_DEVICE_AUDIO_SECONDS_PER_DAY,
    audioSecondsPerSession: config.AI_SESSION_AUDIO_SECONDS,
    sessionTimeoutMs: config.RUNTIME_VOICE_SESSION_TIMEOUT_MS,
    dailyBudgetMicros: config.AI_DAILY_BUDGET_MICROS,
    sessionReservationMicros: config.AI_SESSION_RESERVATION_MICROS,
    ...(config.AI_INPUT_MICROS_PER_MILLION_TOKENS
      ? {
          inputMicrosPerMillionTokens:
            config.AI_INPUT_MICROS_PER_MILLION_TOKENS,
        }
      : {}),
    ...(config.AI_OUTPUT_MICROS_PER_MILLION_TOKENS
      ? {
          outputMicrosPerMillionTokens:
            config.AI_OUTPUT_MICROS_PER_MILLION_TOKENS,
        }
      : {}),
    retentionDays: config.AI_OPERATIONAL_RETENTION_DAYS,
  };
  const budgets = createConversationBudgets(operations, policy);
  const httpConfig = http?.config ?? readHttpToolsConfig(process.env);
  const integrations = new HttpIntegrationRepository(persistence);
  const secrets = http?.secrets ?? {
    async get(reference: string) {
      if (
        reference !== httpConfig.notes?.secretReference ||
        !process.env.NOTES_API_TOKEN
      )
        throw new Error("Notes credential unavailable");
      return process.env.NOTES_API_TOKEN;
    },
  };
  const httpTools = createHttpTools(httpConfig, secrets, http?.client);
  const localTools = [
    ...(commands
      ? [
          ...createDeviceCommandTools(commands),
          ...createTelemetryTools(commands.telemetry),
        ]
      : []),
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
  ];
  const registry = new ToolRegistry([...httpTools, ...localTools]);
  const registryForTenant = async (tenantId: string) =>
    new ToolRegistry([
      ...localTools.map((tool) => deps.registry.get(tool.id)),
      ...createHttpTools(
        await tenantHttpConfig({ tenantId }, integrations, httpConfig),
        secrets,
        http?.client,
      ),
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
      budgets,
      provider:
        provider ?? createGeminiLiveProvider(config.GEMINI_API_KEY ?? ""),
      journal: createConversationJournal(
        new ConversationRepository(persistence),
        operations,
      ),
      tools: [
        {
          id: "weather.forecast",
          description:
            "Read an attributed Open-Meteo forecast for the owner-configured location. This is a forecast, not a device sensor measurement. Include source and fetch time.",
          parameters: {
            type: "OBJECT",
            properties: {
              days: { type: "INTEGER", minimum: 1, maximum: 3 },
            },
          },
        },
        ...(httpTools.some((tool) => tool.id === "notes.create")
          ? [
              {
                id: "notes.create",
                description:
                  "Create one exact note through the owner-configured notes service. Requires owner consent. Report success only after a confirmed receipt.",
                parameters: {
                  type: "OBJECT",
                  properties: { text: { type: "STRING" } },
                  required: ["text"],
                },
              },
            ]
          : []),
        ...(commands
          ? [
              {
                id: "device.list",
                description:
                  "List up to ten owner-paired devices and their measured freshness. Clarify ambiguous names before acting.",
                parameters: { type: "OBJECT", properties: {} },
              },
              {
                id: "telemetry.latest",
                description:
                  "Read measured device sensor readings with freshness and source timestamps. Never describe stale data as current.",
                parameters: {
                  type: "OBJECT",
                  properties: { deviceId: { type: "STRING" } },
                  required: ["deviceId"],
                },
              },
              {
                id: "telemetry.history",
                description:
                  "Read up to ten measured sensor samples for one exact authorized device.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    deviceId: { type: "STRING" },
                    take: { type: "INTEGER", minimum: 1, maximum: 10 },
                  },
                  required: ["deviceId"],
                },
              },
            ]
          : []),
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
          const scopedDeps = {
            ...deps,
            registry: await registryForTenant(context.tenantId),
          };
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
            scopedDeps,
          );
          scopedDeps.registry = await registryForTenant(context.tenantId);
          let result = await dispatchToolExecution(
            queued.executionId,
            auth,
            scopedDeps,
            context.signal,
          );
          if (result.status === "awaiting_approval") {
            pending?.(result.executionId);
            try {
              while (result.status === "awaiting_approval") {
                await pause(200, undefined, { signal: context.signal });
                result = await getToolExecution(
                  result.executionId,
                  auth,
                  scopedDeps,
                );
              }
              if (result.status === "queued") {
                scopedDeps.registry = await registryForTenant(context.tenantId);
                result = await dispatchToolExecution(
                  result.executionId,
                  auth,
                  scopedDeps,
                  context.signal,
                );
              }
            } catch {
              await cancelToolExecution(result.executionId, auth, scopedDeps);
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
  let cleanupTask: Promise<void> | undefined;
  const cleanup = () => {
    if (!cleanupTask)
      cleanupTask = (async () => {
        for (const { tenantId } of await operations.tenantsForCleanup())
          await clearConversationPrivateData(
            { action: "cleanup" },
            { tenantId },
            operations,
            policy,
          );
      })().finally(() => {
        cleanupTask = undefined;
      });
    return cleanupTask;
  };
  const retentionTimer = setInterval(() => {
    void cleanup().catch(() => {
      console.error("Conversation retention cleanup unavailable");
    });
  }, 60000);
  retentionTimer.unref();
  return {
    ...factory(),
    isReady: () => Boolean(provider || config.GEMINI_API_KEY),
    tools: deps,
    operations: {
      diagnostics: (tenantId: string, runId: unknown) =>
        readConversationDiagnostics(runId, { tenantId }, operations),
      privacy: (tenantId: string, input: unknown) =>
        clearConversationPrivateData(input, { tenantId }, operations, policy),
      policy,
    },
    registryForTenant,
    integrations: {
      read: (tenantId: string) =>
        readIntegrationSettings({ tenantId }, integrations, httpConfig),
      save: (tenantId: string, input: unknown) =>
        saveIntegrationSettings(input, { tenantId }, integrations),
      notesConfigured: Boolean(httpConfig.notes),
      test: async (
        tenantId: string,
        toolId: "weather.forecast" | "notes.create",
      ) =>
        testHttpIntegration(
          toolId,
          { tenantId },
          await tenantHttpConfig({ tenantId }, integrations, httpConfig),
          secrets,
          http?.client,
        ),
    },
    repository: new ConversationRepository(persistence),
    openOwner(
      context: Parameters<ReturnType<typeof factory>["open"]>[0],
      token: string,
    ) {
      return factory(token).open(context);
    },
    async close() {
      clearInterval(retentionTimer);
      await Promise.allSettled([
        ...inflight,
        ...(cleanupTask ? [cleanupTask] : []),
      ]);
      await persistence.disconnect();
    },
  };
}
