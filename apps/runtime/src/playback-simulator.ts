import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  OPENHULI_PCM_FORMAT,
  OpenHuliPlayback,
  OpenHuliVoicePeer,
  parseOpenHuliVoiceServerMessage,
} from "@corely/contracts";

/** Real authenticated wire client. Sink resolves after playback, never merely after enqueue.
 * No reconnect/replay. Cancellation stops the sink through the supplied AbortSignal. */
export async function runPlaybackSimulator(input: {
  endpoint: string;
  token: string;
  text: string;
  sink(pcm16: Uint8Array, signal: AbortSignal): Promise<void>;
  signal?: AbortSignal;
  speaker?: boolean;
}) {
  const endpoint = new URL(input.endpoint);
  if (
    !(
      endpoint.protocol === "wss:" ||
      (endpoint.protocol === "ws:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
    ) ||
    endpoint.pathname !== "/voice" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Use verified WSS /voice or loopback WS");
  if (!input.token || input.text.length < 1 || input.text.length > 4096)
    throw new Error("Invalid simulator input");
  const peer = new OpenHuliVoicePeer("device", {
    version: 1,
    type: "device.manifest",
    messageId: "simulator",
    deviceId: "simulator",
    firmwareVersion: "simulator",
    capabilities: [
      { kind: "microphone", format: OPENHULI_PCM_FORMAT },
      ...(input.speaker !== false
        ? [{ kind: "speaker" as const, format: OPENHULI_PCM_FORMAT }]
        : []),
    ],
  });
  const player = new OpenHuliPlayback(100),
    controller = new AbortController();
  const turnId = randomUUID();
  let frames = 0,
    started = false,
    generation = false,
    receipt = false,
    firstFrameBeforeGeneration = false;
  const startedAt = performance.now();
  let firstFrameMs: number | undefined;
  return new Promise<{
    frames: number;
    firstFrameBeforeGeneration: boolean;
    firstFrameMs?: number;
    totalMs: number;
  }>((resolve, reject) => {
    const socket = new WebSocket(endpoint, {
      headers: { authorization: `Bearer ${input.token}` },
      maxPayload: 16384,
      handshakeTimeout: 5000,
      perMessageDeflate: false,
    });
    let settled = false;
    const send = (type: string, fields: Record<string, unknown>) => {
      const wire = JSON.stringify({
        version: 1,
        messageId: randomUUID(),
        type,
        ...fields,
      });
      peer.sendControl(wire);
      socket.send(wire);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
      peer.close();
      controller.abort();
      player.cancel();
      socket.terminate();
      if (error) reject(error);
      else
        resolve({
          frames,
          firstFrameBeforeGeneration,
          ...(firstFrameMs === undefined ? {} : { firstFrameMs }),
          totalMs: Math.round(performance.now() - startedAt),
        });
    };
    const cancel = () => {
      if (socket.readyState === WebSocket.OPEN && started)
        send("turn.cancel", { turnId });
      finish(new Error("Playback cancelled"));
    };
    const timer = setTimeout(
      () => finish(new Error("Playback timed out")),
      35000,
    );
    input.signal?.addEventListener("abort", cancel, { once: true });

    socket.on("error", () => finish(new Error("Playback connection failed")));
    socket.on("close", () =>
      finish(new Error("Playback closed before completion")),
    );
    socket.on("open", () =>
      send("session.start", {
        conversationId: randomUUID(),
        streamingResponses: true,
        inputFormat: OPENHULI_PCM_FORMAT,
        ...(input.speaker !== false
          ? { outputFormat: OPENHULI_PCM_FORMAT }
          : {}),
      }),
    );
    socket.on("message", (data, binary) => {
      try {
        if (binary) {
          peer.receiveAudio(
            new Uint8Array(
              Array.isArray(data)
                ? Buffer.concat(data)
                : Buffer.isBuffer(data)
                  ? data
                  : Buffer.from(data),
            ),
          );
          if (
            !started ||
            !player.receive(
              new Uint8Array(
                Array.isArray(data)
                  ? Buffer.concat(data)
                  : Buffer.isBuffer(data)
                    ? data
                    : Buffer.from(data),
              ),
            )
          )
            throw new Error("Stale playback frame");
          return;
        }
        const message = parseOpenHuliVoiceServerMessage(data.toString());
        peer.receiveControl(data.toString());
        if ("turnId" in message && message.turnId !== turnId)
          throw new Error("Wrong response turn");
        switch (message.type) {
          case "session.ready":
            if (started || (input.speaker !== false && !message.outputFormat))
              throw new Error("Output not negotiated");
            started = true;
            send("turn.text", { turnId, turnSequence: 1, text: input.text });
            break;
          case "audio.start":
            player.start(turnId, 1, message.streamId);
            break;
          case "audio.generation.completed":
            generation = true;
            player.generationCompleted(message.lastSequence);
            break;
          case "turn.completed":
            if (input.speaker !== false && !receipt)
              throw new Error("Playback receipt missing");
            finish();
            break;
          case "session.error":
          case "turn.failed":
            throw new Error("Playback turn failed");
        }
      } catch {
        finish(new Error("Invalid or failed playback response"));
      }
    });
    if (input.signal?.aborted) {
      cancel();
      return;
    }
    void (async () => {
      try {
        while (!settled) {
          const frame = player.take();
          if (frame) {
            await input.sink(frame.payload, controller.signal);
            if (settled) return;
            if (!frames) {
              firstFrameMs = Math.round(performance.now() - startedAt);
              firstFrameBeforeGeneration = !generation;
            }
            frames++;
            if (!frame.complete()) throw new Error("Stale sink completion");
          } else await pause(5, undefined, { signal: controller.signal });
          const complete = player.completed();
          if (complete) {
            receipt = true;
            send("playback.completed", complete);
          }
        }
      } catch {
        finish(new Error("Playback sink failed or cancelled"));
      }
    })();
  });
}
