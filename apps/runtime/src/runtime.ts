import { createVoiceGateway, type VoiceGatewayOptions } from "./voice-gateway";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { OPENHULI_MAX_JSON_BYTES } from "@corely/contracts";
import type { RuntimeConfig } from "./config";
import type { RuntimeConnectionHooks, RuntimeDependency } from "./ports";

type Phase = "new" | "starting" | "running" | "stopping" | "stopped" | "failed";
type Connection = { abort: AbortController; timer: NodeJS.Timeout };

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Runtime operation timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function rejectUpgrade(socket: Duplex, status: number): void {
  socket.end(
    `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

function hasToken(
  header: string | undefined,
  token: string | undefined,
): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createRuntime(
  config: RuntimeConfig,
  options: {
    dependencies?: RuntimeDependency[];
    connections?: RuntimeConnectionHooks;
    voice?: VoiceGatewayOptions;
  } = {},
) {
  const dependencies = options.dependencies ?? [];
  if (
    new Set(dependencies.map((item) => item.name)).size !== dependencies.length
  ) {
    throw new Error("Duplicate runtime dependency");
  }
  const abort = new AbortController();
  const connections = new Map<WebSocket, Connection>();
  const cleanups = new Set<Promise<void>>();
  let cleanupFailed = false;
  let phase: Phase = "new";
  let httpFailed = false;
  let starting: Promise<AddressInfo> | undefined;
  let stopping: Promise<void> | undefined;
  if (config.RUNTIME_VOICE_ENABLED && !options.voice)
    throw new Error("Voice authorization is not configured");
  const gateway: ReturnType<typeof createVoiceGateway> | undefined =
    config.RUNTIME_VOICE_ENABLED && options.voice
      ? createVoiceGateway(
          config,
          options.voice,
          () =>
            phase === "running" &&
            !cleanupFailed &&
            connections.size + cleanups.size + (gateway?.count() ?? 0) <
              config.RUNTIME_MAX_CONNECTIONS,
          () => health().ready,
          () => {
            cleanupFailed = true;
          },
        )
      : undefined;
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: OPENHULI_MAX_JSON_BYTES,
    perMessageDeflate: false,
  });

  function health() {
    const states: Record<
      "mqtt" | "ai",
      "disabled" | "unconfigured" | "ready" | "unavailable"
    > = {
      mqtt: "disabled",
      ai: "unconfigured",
    };
    for (const dependency of dependencies) {
      try {
        states[dependency.name] = dependency.isReady()
          ? "ready"
          : "unavailable";
      } catch {
        states[dependency.name] = "unavailable";
      }
    }
    return {
      phase,
      live: !httpFailed && (phase === "starting" || phase === "running"),
      ready:
        !httpFailed &&
        !cleanupFailed &&
        phase === "running" &&
        !Object.values(states).includes("unavailable") &&
        (!gateway || gateway.state() === "ready"),
      dependencies: states,
      voice: gateway?.state() ?? "unconfigured",
      connections: connections.size + (gateway?.count() ?? 0),
    };
  }

  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const status = health();
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && request.url === "/health/live") {
      response
        .writeHead(status.live ? 200 : 503)
        .end(JSON.stringify({ live: status.live }));
    } else if (request.method === "GET" && request.url === "/health/ready") {
      response.writeHead(status.ready ? 200 : 503).end(JSON.stringify(status));
    } else {
      response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.setTimeout(config.RUNTIME_IDLE_TIMEOUT_MS, (socket) =>
    socket.destroy(),
  );
  server.on("error", () => {
    httpFailed = true;
  });
  server.on("clientError", (_error, socket) => socket.destroy());

  sockets.on("connection", (socket) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => socket.terminate(),
      config.RUNTIME_IDLE_TIMEOUT_MS,
    );
    timer.unref();
    const connection = { abort: controller, timer };
    connections.set(socket, connection);
    let handle: ReturnType<RuntimeConnectionHooks["opened"]> | undefined;
    socket.on("error", () => socket.terminate());
    socket.on("ping", () => timer.refresh());
    socket.on("pong", () => timer.refresh());
    socket.on("message", () =>
      socket.close(1008, "Probe supports ping/pong only"),
    );
    socket.once("close", () => {
      clearTimeout(timer);
      connections.delete(socket);
      controller.abort();
      const cleanup = Promise.resolve()
        .then(() =>
          bounded(
            Promise.resolve(handle?.close()),
            config.RUNTIME_SHUTDOWN_TIMEOUT_MS,
          ),
        )
        .catch(() => {
          cleanupFailed = true;
        })
        .finally(() => cleanups.delete(cleanup));
      cleanups.add(cleanup);
    });
    try {
      handle = options.connections?.opened({
        connectionId: randomUUID(),
        signal: controller.signal,
      });
    } catch {
      socket.terminate();
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/voice" && gateway) {
      gateway.upgrade(request, socket, head);
      return;
    }
    if (request.url !== "/internal/probe" || !config.RUNTIME_PROBE_TOKEN) {
      rejectUpgrade(socket, 404);
      return;
    }
    if (
      request.headers.origin ||
      !hasToken(request.headers.authorization, config.RUNTIME_PROBE_TOKEN)
    ) {
      rejectUpgrade(socket, 401);
      return;
    }
    if (!health().ready) {
      rejectUpgrade(socket, 503);
      return;
    }
    if (
      connections.size + cleanups.size + (gateway?.count() ?? 0) >=
      config.RUNTIME_MAX_CONNECTIONS
    ) {
      rejectUpgrade(socket, 503);
      return;
    }
    try {
      sockets.handleUpgrade(request, socket, head, (client) =>
        sockets.emit("connection", client),
      );
    } catch {
      socket.destroy();
    }
  });

  function stop(): Promise<void> {
    if (stopping) return stopping;
    phase = "stopping";
    stopping = Promise.resolve().then(async () => {
      abort.abort();
      for (const [socket, connection] of connections) {
        connection.abort.abort();
        socket.close(1001, "Runtime shutting down");
      }
      const force = setTimeout(
        () => {
          for (const socket of connections.keys()) socket.terminate();
          server.closeAllConnections();
        },
        Math.min(250, config.RUNTIME_SHUTDOWN_TIMEOUT_MS / 2),
      );
      try {
        const results = await bounded(
          Promise.allSettled([
            (async () => {
              await Promise.all([
                new Promise<void>((resolve) => server.close(() => resolve())),
                new Promise<void>((resolve) => sockets.close(() => resolve())),
              ]);
              await Promise.all([...cleanups]);
            })(),
            ...(gateway ? [gateway.stop()] : []),
            ...dependencies.map((item) =>
              Promise.resolve().then(() => item.stop()),
            ),
          ]),
          config.RUNTIME_SHUTDOWN_TIMEOUT_MS,
        );
        if (
          cleanupFailed ||
          results.some((item) => item.status === "rejected")
        ) {
          throw new Error("Runtime resource cleanup failed");
        }
        phase = "stopped";
      } catch {
        phase = "failed";
        throw new Error("Runtime shutdown failed");
      } finally {
        clearTimeout(force);
        for (const socket of connections.keys()) socket.terminate();
        server.closeAllConnections();
      }
    });
    return stopping;
  }

  function start(): Promise<AddressInfo> {
    if (!["new", "starting", "running"].includes(phase))
      return Promise.reject(new Error("Runtime is closed"));
    if (starting) return starting;
    phase = "starting";
    starting = (async () => {
      try {
        await bounded(
          (async () => {
            await new Promise<void>((resolve, reject) => {
              const fail = () => {
                cleanup();
                reject(new Error("Runtime listener unavailable"));
              };
              const listening = () => {
                cleanup();
                resolve();
              };
              const cleanup = () => {
                server.off("error", fail);
                server.off("listening", listening);
                abort.signal.removeEventListener("abort", fail);
              };
              server.once("error", fail);
              server.once("listening", listening);
              abort.signal.addEventListener("abort", fail, { once: true });
              server.listen({
                host: config.RUNTIME_HOST,
                port: config.RUNTIME_PORT,
                signal: abort.signal,
              });
            });
            await Promise.all(
              dependencies.map((item) => item.start(abort.signal)),
            );
          })(),
          config.RUNTIME_STARTUP_TIMEOUT_MS,
        );
        if (abort.signal.aborted) throw new Error("Runtime startup cancelled");
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Runtime listener unavailable");
        phase = "running";
        return address;
      } catch {
        await stop();
        throw new Error("Runtime startup failed");
      }
    })();
    return starting;
  }
  return { start, stop, health };
}
