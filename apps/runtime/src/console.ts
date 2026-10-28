import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ConsoleCommandSchema,
  parseOpenHuliJson,
  type OpenHuliVoiceServerMessage,
} from "@corely/contracts";
import {
  resolveOwnerSession,
  verifyAccessToken,
} from "@corely/modules-identity";
import { readConfiguredDeviceContext } from "@corely/modules-devices";
import {
  listConsoleConversations,
  readConsoleActivity,
} from "@corely/modules-conversations";
import {
  decideToolApproval,
  cancelToolExecution,
} from "@corely/modules-tool-execution";
import type {
  VoiceProviderSession,
  VoiceProviderTurn,
} from "@corely/modules-voice";
import type { createLiveConversationRuntime } from "./conversation-composition";

type Composition = ReturnType<typeof createLiveConversationRuntime>;
type Live = {
  tenantId: string;
  sid: string;
  controller: AbortController;
  provider?: VoiceProviderSession;
  turn?: {
    id: string;
    controller: AbortController;
    handle?: VoiceProviderTurn | undefined;
  };
  sequence: number;
  seen: Map<string, string>;
  stream?: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
};
export function createConsoleRuntime(
  composition: Composition,
  enabled: boolean,
) {
  const sessions = new Map<string, Live>();
  const deps = composition.tools;
  const authenticate = async (request: IncomingMessage) => {
    if (request.headers.origin) throw new Error("Origin not permitted");
    const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const claims = verifyAccessToken(token, deps.auth.secret);
    if (!claims) throw new Error("Authentication required");
    const owner = await resolveOwnerSession(claims, deps.auth, deps.identity);
    return { ...owner, sid: claims.sid, token, expiresAt: claims.exp * 1000 };
  };
  async function dispose(id: string) {
    const live = sessions.get(id);
    if (!live) return;
    sessions.delete(id);
    clearTimeout(live.timer);
    live.controller.abort();
    live.turn?.controller.abort();
    live.stream?.end();
    await live.turn?.handle?.stop().catch(() => {});
    await live.provider?.close().catch(() => {});
  }
  function notify(live: Live, message: OpenHuliVoiceServerMessage) {
    const text = `data: ${JSON.stringify(message)}\n\n`;
    if (live.stream?.destroyed || live.stream?.writableEnded) {
      delete live.stream;
      return;
    }
    if (live.stream && !live.stream.write(text)) {
      live.stream.end();
      delete live.stream;
    }
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://runtime.invalid");
    let owner;
    try {
      owner = await authenticate(request);
    } catch {
      response
        .writeHead(401)
        .end(JSON.stringify({ error: "Sign in required" }));
      return;
    }
    const auth = { kind: "owner" as const, token: owner.token };
    try {
      if (request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) {
          response.end(
            JSON.stringify(
              await listConsoleConversations(owner, composition.repository),
            ),
          );
          return;
        }
        const snapshot = await readConsoleActivity(
          id,
          owner,
          composition.repository,
        );
        const live = sessions.get(id);
        const writable = Boolean(
          live &&
          live.tenantId === owner.tenantId &&
          live.sid === owner.sid &&
          !live.controller.signal.aborted,
        );
        if (url.pathname === "/console/events") {
          if (!writable || !live) {
            response
              .writeHead(409)
              .end(JSON.stringify({ error: "Session is read only" }));
            return;
          }
          live.stream?.end();
          live.stream = response;
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          });
          response.on("error", () => {
            response.destroy();
          });
          response.write(": connected\n\n");
          let checking = false;
          const heartbeat = setInterval(() => {
            if (checking) return;
            checking = true;
            void authenticate(request)
              .then(
                () => {
                  if (response.destroyed || response.writableEnded) return;
                  if (!response.write(": heartbeat\n\n")) response.end();
                },
                () => {
                  response.end();
                  void dispose(id);
                },
              )
              .finally(() => {
                checking = false;
              });
          }, 5000);
          response.on("close", () => {
            clearInterval(heartbeat);
            if (live.stream === response) delete live.stream;
          });
          return;
        }
        response.end(JSON.stringify({ ...snapshot, live: writable }));
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/console")
        throw new Error("Invalid request");
      if (!request.headers["content-type"]?.startsWith("application/json"))
        throw new Error("JSON required");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const bytes of request) {
        if (!Buffer.isBuffer(bytes)) throw new Error("Invalid body");
        size += bytes.length;
        if (size > 16384) throw new Error("Body too large");
        chunks.push(bytes);
      }
      const text = new TextDecoder("utf8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
      const command = ConsoleCommandSchema.parse(
        parseOpenHuliJson(text, ConsoleCommandSchema),
      );
      if (command.action === "create") {
        if (!enabled) {
          response
            .writeHead(503)
            .end(JSON.stringify({ error: "AI provider is not configured" }));
          return;
        }
        if (sessions.size >= 32) throw new Error("Session limit reached");
        await readConfiguredDeviceContext(
          command.deviceId,
          owner,
          deps.devices,
        );
        if (sessions.size >= 32) throw new Error("Session limit reached");
        const id = randomUUID(),
          controller = new AbortController();
        const live: Live = {
          tenantId: owner.tenantId,
          sid: owner.sid,
          controller,
          sequence: 0,
          seen: new Map(),
          timer: setTimeout(
            () => {
              void dispose(id);
            },
            Math.min(300000, owner.expiresAt - Date.now()),
          ),
        };
        sessions.set(id, live);
        try {
          live.provider = await composition.openOwner(
            {
              tenantId: owner.tenantId,
              deviceId: command.deviceId,
              credentialId: "owner-console",
              conversationId: id,
              sessionId: id,
              signal: controller.signal,
              streamingResponses: true,
              outputAudio: false,
            },
            owner.token,
          );
          if (controller.signal.aborted) {
            await live.provider.close();
            throw new Error("Session cancelled");
          }
        } catch {
          await dispose(id);
          throw new Error("Provider unavailable");
        }
        response.writeHead(201).end(JSON.stringify({ id }));
        return;
      }
      const snapshot = await readConsoleActivity(
        command.conversationId,
        owner,
        composition.repository,
      );
      if (
        command.action === "approval" ||
        command.action === "cancel-execution"
      ) {
        if (
          !snapshot.executions.some(
            (e) => e.executionId === command.executionId,
          )
        )
          throw new Error("Execution not found");
        if (command.action === "approval")
          await decideToolApproval(
            {
              version: 1,
              executionId: command.executionId,
              approvalId: command.approvalId,
              requestHash: command.requestHash,
              targetDeviceId: command.targetDeviceId,
              decision: command.decision,
            },
            auth,
            deps,
          );
        else await cancelToolExecution(command.executionId, auth, deps);
        response.end(JSON.stringify({ accepted: true }));
        return;
      }
      const live = sessions.get(command.conversationId);
      if (
        !live ||
        live.tenantId !== owner.tenantId ||
        live.sid !== owner.sid ||
        live.controller.signal.aborted
      ) {
        response.writeHead(409).end(
          JSON.stringify({
            error: "Start a new conversation; this session is read only",
          }),
        );
        return;
      }
      if (command.action === "cancel") {
        const turn = live.turn;
        delete live.turn;
        turn?.controller.abort();
        await turn?.handle?.stop();
        await dispose(command.conversationId);
        response.end(JSON.stringify({ accepted: true }));
        return;
      }
      const requestHash = createHash("sha256")
        .update(command.text)
        .digest("hex");
      if (live.seen.has(command.turnId)) {
        if (live.seen.get(command.turnId) !== requestHash) {
          response.writeHead(409).end(
            JSON.stringify({
              error: "Turn identity was used with different text",
            }),
          );
          return;
        }
        response.writeHead(202).end(JSON.stringify({ accepted: true }));
        return;
      }
      if (live.turn || live.seen.size >= 100 || !live.provider) {
        response.writeHead(409).end(
          JSON.stringify({
            error: "A turn is active or session limit reached",
          }),
        );
        return;
      }
      live.seen.set(command.turnId, requestHash);
      const turn = {
        id: command.turnId,
        controller: new AbortController(),
        handle: undefined as VoiceProviderTurn | undefined,
      };
      live.turn = turn;
      const context = {
        tenantId: owner.tenantId,
        deviceId: snapshot.deviceId ?? "console",
        credentialId: "owner-console",
        conversationId: command.conversationId,
        sessionId: command.conversationId,
        turnId: command.turnId,
        turnSequence: ++live.sequence,
        source: "text" as const,
        signal: AbortSignal.any([
          turn.controller.signal,
          live.controller.signal,
        ]),
      };
      try {
        turn.handle = await live.provider.startTurn(context, {
          audio: () => false,
          control(message) {
            if (live.turn !== turn || context.signal.aborted) return false;
            notify(live, message);
            if (
              message.type === "turn.completed" ||
              message.type === "turn.failed"
            )
              delete live.turn;
            if (message.type === "turn.failed")
              void dispose(command.conversationId);
            return true;
          },
        });
        await turn.handle.appendText?.(command.text);
        await turn.handle.commit({
          ...context,
          lastSequence: 0,
          committedAt: new Date(),
        });
      } catch {
        await dispose(command.conversationId);
        throw new Error("Turn unavailable");
      }
      response.writeHead(202).end(JSON.stringify({ accepted: true }));
    } catch {
      if (!response.headersSent)
        response
          .writeHead(400)
          .end(
            JSON.stringify({ error: "Console request denied or unavailable" }),
          );
      else response.end();
    }
  }
  return {
    handle,
    async stop() {
      await Promise.all([...sessions.keys()].map(dispose));
    },
  };
}
