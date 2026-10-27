import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import {
  VoiceSession,
  type VoiceAuthorization,
  type VoiceProviderFactory,
} from "@corely/modules-voice";
import { OPENHULI_MAX_JSON_BYTES } from "@corely/contracts";
import type { RuntimeConfig } from "./config";

export interface VoiceGatewayOptions {
  authorization: VoiceAuthorization;
  provider?: VoiceProviderFactory;
}
function reject(socket: Duplex, status: number) {
  socket.end(
    `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}
function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}
export function createVoiceGateway(
  config: RuntimeConfig,
  options: VoiceGatewayOptions,
  capacity: () => boolean,
  available: () => boolean,
  onCleanupFailure: () => void,
) {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: OPENHULI_MAX_JSON_BYTES,
    perMessageDeflate: false,
  });
  const sessions = new Map<
    WebSocket,
    { session: VoiceSession; force?: ReturnType<typeof setTimeout> }
  >();
  const pending = new Set<Duplex>(),
    devices = new Set<string>(),
    cleanups = new Set<Promise<void>>();
  let stopping = false;
  let closing: Promise<void> | undefined;
  function state() {
    try {
      return !stopping && options.provider?.isReady()
        ? ("ready" as const)
        : ("unconfigured" as const);
    } catch {
      return "unavailable" as const;
    }
  }
  function count() {
    return sessions.size + pending.size + cleanups.size;
  }
  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const header = request.headers.authorization;
    if (
      request.headers.origin ||
      !header?.startsWith("Bearer ") ||
      header.length > 1100
    ) {
      reject(socket, 401);
      return;
    }
    if (stopping || !available() || state() !== "ready" || !capacity()) {
      reject(socket, 503);
      return;
    }
    pending.add(socket);
    const timeout = setTimeout(
      () => socket.destroy(),
      config.RUNTIME_STARTUP_TIMEOUT_MS,
    );
    const lost = () => {
      clearTimeout(timeout);
    };
    socket.once("close", lost);
    socket.once("error", lost);
    void (async () => {
      let key: string | undefined;
      try {
        const bound = await options.authorization.authenticate(header.slice(7));
        if (
          bound.manifest.deviceId !== bound.identity.deviceId ||
          !Number.isFinite(bound.identity.expiresAt.getTime()) ||
          bound.identity.expiresAt.getTime() <= Date.now()
        )
          throw new Error("Invalid device binding");
        if (
          stopping ||
          socket.destroyed ||
          !available() ||
          state() !== "ready"
        ) {
          if (!socket.destroyed) reject(socket, 503);
          return;
        }
        key = `${bound.identity.tenantId}:${bound.identity.deviceId}`;
        if (devices.has(key)) {
          reject(socket, 409);
          return;
        }
        devices.add(key);
        const provider = options.provider;
        if (!provider) throw new Error("Voice provider unavailable");
        let accepted = false;
        try {
          server.handleUpgrade(request, socket, head, (client) => {
            accepted = true;
            lost();
            const session = new VoiceSession(
              bound,
              provider,
              {
                control: (text) => send(client, text),
                audio: (data) => send(client, data),
                close: (code, reason) => closeSocket(client, code, reason),
              },
              () => options.authorization.revalidate(bound.identity),
              {
                queueBytes: config.RUNTIME_VOICE_QUEUE_BYTES,
                queueMessages: config.RUNTIME_VOICE_QUEUE_MESSAGES,
                operationTimeoutMs: config.RUNTIME_VOICE_OPERATION_TIMEOUT_MS,
                cleanupTimeoutMs: config.RUNTIME_SHUTDOWN_TIMEOUT_MS,
                turnTimeoutMs: config.RUNTIME_VOICE_TURN_TIMEOUT_MS,
                sessionTimeoutMs: config.RUNTIME_VOICE_SESSION_TIMEOUT_MS,
                idleTimeoutMs: config.RUNTIME_IDLE_TIMEOUT_MS,
              },
            );
            const entry: {
              session: VoiceSession;
              force?: ReturnType<typeof setTimeout>;
            } = { session };
            sessions.set(client, entry);
            let unwatch: () => void = () => {};
            client.on("error", () => client.terminate());
            client.on("message", (data, binary) =>
              session.receive(bytes(data), binary),
            );
            client.once("close", () => {
              clearTimeout(entry.force);
              unwatch();
              sessions.delete(client);
              const cleanup = session
                .stop()
                .catch(() => onCleanupFailure())
                .finally(() => {
                  cleanups.delete(cleanup);
                  if (key) devices.delete(key);
                });
              cleanups.add(cleanup);
            });
            try {
              unwatch = options.authorization.watch(bound.identity, () =>
                session.revoke(),
              );
            } catch {
              session.revoke();
            }
          });
        } catch {
          socket.destroy();
        }
        if (!accepted) devices.delete(key);
      } catch {
        if (key) devices.delete(key);
        if (!socket.destroyed) reject(socket, 401);
      } finally {
        lost();
        pending.delete(socket);
      }
    })();
  }
  function closeSocket(client: WebSocket, code: number, reason: string) {
    const entry = sessions.get(client);
    client.close(code, reason);
    if (entry && !entry.force) {
      entry.force = setTimeout(() => client.terminate(), 250);
      entry.force.unref?.();
    }
  }
  function send(client: WebSocket, data: string | Uint8Array) {
    const length =
      typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    if (
      client.readyState !== client.OPEN ||
      client.bufferedAmount + length > config.RUNTIME_VOICE_BUFFERED_BYTES
    ) {
      client.terminate();
      throw new Error("Voice output consumer is too slow");
    }
    client.send(data, (error) => {
      if (error) client.terminate();
    });
  }
  function stop(): Promise<void> {
    if (closing) return closing;
    stopping = true;
    for (const socket of pending) socket.destroy();
    pending.clear();
    const stopped = [...sessions].map(async ([client, entry]) => {
      const cleanup = entry.session.stop();
      closeSocket(client, 1001, "Runtime shutting down");
      await cleanup;
    });
    closing = (async () => {
      await Promise.allSettled(stopped).then((results) => {
        if (results.some((result) => result.status === "rejected"))
          onCleanupFailure();
      });
      for (const client of sessions.keys()) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all([...cleanups]);
      await options.authorization.close();
    })();
    return closing;
  }
  return { upgrade, state, count, stop };
}
