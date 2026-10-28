import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ManagementCommandSchema,
  OpenHuliIdSchema,
  parseOpenHuliJson,
} from "@corely/contracts";
import {
  verifyAccessToken,
  resolveOwnerSession,
} from "@corely/modules-identity";
import { getOwnerDevice } from "@corely/modules-devices";
import {
  getTelemetryLatest,
  getTelemetryHistory,
  type TelemetryDependencies,
} from "@corely/modules-telemetry";
import {
  startConversation,
  startConversationTurn,
  transitionConversationTurn,
  getConversation,
  getConversationTurn,
} from "@corely/modules-conversations";
import {
  submitToolCall,
  findToolCall,
  dispatchToolExecution,
  getToolExecution,
  decideToolApproval,
  cancelToolExecution,
} from "@corely/modules-tool-execution";
import type { createLiveConversationRuntime } from "./conversation-composition";

type Composition = ReturnType<typeof createLiveConversationRuntime>;
/** Authenticated server-to-server management; browser requests enter through the same-origin BFF. */
export function createDeviceManagement(
  composition: Composition,
  telemetry?: TelemetryDependencies,
) {
  const inflight = new Set<Promise<unknown>>();
  const lifetime = new AbortController();
  function dispatch(id: string, token: string, tenantId: string) {
    const task = (async () => {
      const deps = {
        ...composition.tools,
        registry: await composition.registryForTenant(tenantId),
      };
      await dispatchToolExecution(
        id,
        { kind: "owner", token },
        deps,
        lifetime.signal,
      );
    })();
    inflight.add(task);
    void task.catch(() => {}).finally(() => inflight.delete(task));
  }
  return {
    async handle(request: IncomingMessage, response: ServerResponse) {
      const send = (status: number, data: unknown) =>
        response.writeHead(status).end(JSON.stringify(data));
      let owner, token: string;
      try {
        if (request.headers.origin) throw new Error("Origin denied");
        token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const claims = verifyAccessToken(token, composition.tools.auth.secret);
        if (!claims) throw new Error("Authentication required");
        owner = await resolveOwnerSession(
          claims,
          composition.tools.auth,
          composition.tools.identity,
        );
      } catch {
        send(401, { error: "Sign in required" });
        return;
      }
      try {
        const url = new URL(request.url ?? "/", "http://runtime.invalid");
        const auth = { kind: "owner" as const, token };
        const deps = {
          ...composition.tools,
          registry: await composition.registryForTenant(owner.tenantId),
        };
        if (request.method === "GET") {
          const requestId = url.searchParams.get("request");
          const execution = url.searchParams.get("execution");
          if (execution || requestId) {
            const view = requestId
              ? await findToolCall(
                  {
                    conversationId: manualRun(
                      owner.userId,
                      OpenHuliIdSchema.parse(requestId),
                    ),
                    toolCallId: requestId,
                  },
                  auth,
                  deps,
                )
              : await getToolExecution(
                  OpenHuliIdSchema.parse(execution),
                  auth,
                  deps,
                );
            if (
              !["device.ping", "display.message"].includes(view.toolId) ||
              view.targetDeviceId !==
                OpenHuliIdSchema.parse(url.searchParams.get("device"))
            )
              throw new Error("Command target mismatch");
            // Raw errors and arbitrary tool output are never returned by management.
            send(200, {
              ...view,
              error: view.error
                ? "Command failed or outcome is unconfirmed"
                : null,
              output: null,
            });
            return;
          }
          const deviceId = url.searchParams.get("device");
          if (deviceId) {
            await getOwnerDevice(deviceId, owner, deps.devices);
            const observedAt = new Date();
            send(
              200,
              telemetry
                ? {
                    available: true,
                    latest: await getTelemetryLatest(
                      { deviceId },
                      owner,
                      telemetry,
                      observedAt,
                    ),
                    history: await getTelemetryHistory(
                      {
                        deviceId,
                        from: new Date(
                          observedAt.getTime() -
                            Math.min(
                              86400000,
                              telemetry.policy.retentionDays * 86400000,
                            ),
                        ).toISOString(),
                        take: 100,
                      },
                      owner,
                      telemetry,
                      observedAt,
                    ),
                  }
                : { available: false },
            );
            return;
          }
          send(200, {
            settings: await composition.integrations.read(owner.tenantId),
            notesConfigured: composition.integrations.notesConfigured,
            telemetryAvailable: Boolean(telemetry),
          });
          return;
        }
        if (
          request.method !== "POST" ||
          !request.headers["content-type"]?.startsWith("application/json")
        )
          throw new Error("Invalid request");
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          if (!Buffer.isBuffer(chunk) || (size += chunk.length) > 16384)
            throw new Error("Body too large");
          chunks.push(chunk);
        }
        const command = parseOpenHuliJson(
          new TextDecoder("utf8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
          ManagementCommandSchema,
        );
        if (command.action === "settings") {
          send(
            200,
            await composition.integrations.save(
              owner.tenantId,
              command.settings,
            ),
          );
          return;
        }
        if (command.action === "test") {
          send(
            200,
            await composition.integrations.test(owner.tenantId, command.toolId),
          );
          return;
        }
        if (command.action === "approval") {
          const result = await decideToolApproval(command.decision, auth, deps);
          if (result.status === "queued")
            dispatch(result.executionId, token, owner.tenantId);
          send(202, { executionId: result.executionId });
          return;
        }
        if (command.action === "cancel") {
          await cancelToolExecution(command.executionId, auth, deps);
          send(200, { executionId: command.executionId });
          return;
        }
        const { device } = await getOwnerDevice(
          command.deviceId,
          owner,
          deps.devices,
        );
        if (device.status !== "active") throw new Error("Inactive device");
        const capability = device.capabilities.find(
          (c) =>
            c.kind ===
            (command.toolId === "display.message" ? "display" : "ping"),
        );
        if (
          !capability ||
          (capability.kind === "display" &&
            (!command.text || command.text.length > capability.maxTextLength))
        )
          throw new Error("Unsupported command");
        // Scope client retry identity to this owner, device, tool and exact arguments.
        const runId = manualRun(owner.userId, command.requestId),
          turnId = runId.replace("manual-", "turn-");
        try {
          await startConversation(
            {
              id: runId,
              deviceId: device.id,
              correlationId: command.requestId,
              retainTranscripts: false,
              expiresAt: new Date(Date.now() + 900000),
            },
            owner,
            composition.repository,
          );
        } catch {
          const existing = await getConversation(
            runId,
            owner,
            composition.repository,
          );
          if (!existing || existing.deviceId !== device.id)
            throw new Error("Could not reserve command");
        }
        try {
          await startConversationTurn(
            {
              version: 1,
              conversationId: runId,
              turnId,
              turnSequence: 1,
              source: "text",
              status: "collecting",
              correlationId: command.requestId,
            },
            owner,
            composition.repository,
          );
          await transitionConversationTurn(
            { conversationId: runId, turnId, status: "committed" },
            owner,
            composition.repository,
          );
        } catch {
          const turn = await getConversationTurn(
            { conversationId: runId, turnId },
            owner,
            composition.repository,
          );
          if (!turn || turn.status !== "committed")
            throw new Error("Command not ready");
        }
        const result = await submitToolCall(
          {
            toolCall: {
              version: 1,
              conversationId: runId,
              turnId,
              toolCallId: command.requestId,
              toolId: command.toolId,
              arguments:
                command.toolId === "display.message"
                  ? { deviceId: device.id, text: command.text }
                  : { deviceId: device.id },
            },
            correlationId: command.requestId,
          },
          auth,
          deps,
        );
        if (result.status === "queued")
          dispatch(result.executionId, token, owner.tenantId);
        send(202, { executionId: result.executionId });
      } catch {
        if (!response.headersSent)
          send(400, {
            error:
              "Request denied or unavailable. Check device capabilities, session and runtime settings.",
          });
        else response.end();
      }
    },
    async stop() {
      lifetime.abort();
      await Promise.allSettled([...inflight]);
    },
  };
}

function manualRun(userId: string, requestId: string) {
  return `manual-${createHash("sha256")
    .update(JSON.stringify([userId, requestId]))
    .digest("hex")
    .slice(0, 48)}`;
}
