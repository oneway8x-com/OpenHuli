import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { WebSocket } from "ws";
import {
  OPENHULI_PCM_FORMAT,
  encodeOpenHuliAudio,
  OpenHuliIdSchema,
  parseOpenHuliVoiceServerMessage,
} from "@corely/contracts";
import { GEMINI_LIVE_MODEL } from "./gemini-live";

/** Opt-in paid-provider smoke. Output contains configuration/latency/status only, never credentials or transcripts. */
async function main() {
  if (!process.argv.includes("--live"))
    throw new Error("Pass --live to authorize a paid provider smoke test");
  const endpoint = new URL(
    process.env.OPENHULI_RUNTIME_URL ?? "ws://127.0.0.1:3200/voice",
  );
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
    throw new Error("Use a verified WSS /voice URL or loopback WS");
  const deviceId = OpenHuliIdSchema.parse(process.env.OPENHULI_DEVICE_ID);
  const token = process.env.OPENHULI_DEVICE_TOKEN;
  if (!token)
    throw new Error("OPENHULI_DEVICE_TOKEN must be configured locally");
  const pcmIndex = process.argv.indexOf("--pcm");
  let pcm: Buffer | undefined;
  if (pcmIndex >= 0) {
    const path = process.argv[pcmIndex + 1];
    if (!path || path.startsWith("--"))
      throw new Error("--pcm requires a local PCM16LE file");
    const size = statSync(path).size;
    if (size < 640 || size > 320000 || size % 640 !== 0)
      throw new Error(
        "PCM must contain 1–500 complete 20ms frames (16kHz PCM16LE mono, no WAV header)",
      );
    pcm = readFileSync(path);
  }
  const started = performance.now(),
    turnId = randomUUID();
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(endpoint, {
      headers: { authorization: `Bearer ${token}` },
      maxPayload: 16384,
      handshakeTimeout: 5000,
    });
    let pump: ReturnType<typeof setInterval> | undefined;
    let settled = false,
      successfulResult = false,
      readyMs = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(pump);
      socket.terminate();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Live smoke timed out")),
      35000,
    );
    const send = (type: string, fields: Record<string, unknown>) =>
      socket.send(
        JSON.stringify({
          version: 1,
          messageId: randomUUID(),
          type,
          ...fields,
        }),
      );
    socket.on("error", () => finish(new Error("Live connection failed")));
    socket.on("close", () =>
      finish(new Error("Live connection closed before completion")),
    );
    socket.on("open", () =>
      send("session.start", {
        conversationId: randomUUID(),
        inputFormat: OPENHULI_PCM_FORMAT,
      }),
    );
    socket.on("message", (data, binary) => {
      try {
        if (binary) throw new Error("Unexpected binary output");
        const message = parseOpenHuliVoiceServerMessage(data.toString());
        if (message.type === "session.ready") {
          readyMs = Math.round(performance.now() - started);
          if (pcm) {
            const audio = pcm;
            send("turn.start", { turnId, turnSequence: 1, streamId: 1 });
            let sequence = 0;
            pump = setInterval(() => {
              try {
                socket.send(
                  encodeOpenHuliAudio({
                    kind: "input",
                    turnSequence: 1,
                    streamId: 1,
                    sequence,
                    payload: audio.subarray(
                      sequence * 640,
                      (sequence + 1) * 640,
                    ),
                  }),
                );
                sequence++;
                if (sequence * 640 === audio.byteLength) {
                  clearInterval(pump);
                  send("turn.commit", { turnId, lastSequence: sequence - 1 });
                }
              } catch {
                finish(new Error("Audio smoke input failed"));
              }
            }, 20);
          } else {
            send("turn.text", {
              turnId,
              turnSequence: 1,
              text: `Use device_context to read the owner-configured context for exactly device ${deviceId}. Report the configured room and distinguish configuration from live telemetry.`,
            });
          }
        } else if (
          message.type === "response.text" &&
          message.turnId === turnId
        )
          successfulResult = /Tool results: .*: succeeded/.test(message.text);
        else if (
          message.type === "turn.completed" &&
          message.turnId === turnId
        ) {
          if (!successfulResult)
            throw new Error("No confirmed tool result in live response");
          console.log(
            JSON.stringify({
              provider: "gemini",
              model: GEMINI_LIVE_MODEL,
              api: "v1beta",
              input: pcm ? "voice" : "text",
              providerReadyMs: readyMs,
              totalMs: Math.round(performance.now() - started),
              outcome: "succeeded",
              audioPlayback: "not-tested",
            }),
          );
          finish();
        } else if (
          message.type === "session.error" ||
          message.type === "turn.failed"
        )
          throw new Error("Live turn failed");
      } catch {
        finish(new Error("Live smoke did not confirm a successful tool turn"));
      }
    });
  });
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error && !error.name.startsWith("Zod")
      ? error.message
      : "Invalid live smoke configuration",
  );
  process.exitCode = 1;
});
