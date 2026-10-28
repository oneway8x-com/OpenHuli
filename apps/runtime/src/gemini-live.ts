import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import { OpenHuliJsonObjectSchema } from "@corely/contracts";
import type {
  ConversationProviderFactory,
  ProviderEvent,
} from "@corely/modules-conversations";

export const GEMINI_LIVE_MODEL = "gemini-3.8-live";
const ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const EventSchema = z
  .object({
    setupComplete: z.object({}).passthrough().optional(),
    serverContent: z
      .object({
        outputTranscription: z
          .object({ text: z.string().max(4096).optional() })
          .passthrough()
          .optional(),
        modelTurn: z
          .object({
            parts: z
              .array(
                z
                  .object({
                    thought: z.boolean().optional(),
                    inlineData: z
                      .object({
                        data: z.string().max(65536),
                        mimeType: z.string().max(128),
                      })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough(),
              )
              .max(32),
          })
          .passthrough()
          .optional(),
        turnComplete: z.boolean().optional(),
        interrupted: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    toolCall: z
      .object({
        functionCalls: z
          .array(
            z
              .object({
                id: z.string().min(1).max(128),
                name: z.string().min(1).max(64),
                args: OpenHuliJsonObjectSchema.default({}),
              })
              .passthrough(),
          )
          .min(1)
          .max(16),
      })
      .passthrough()
      .optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z
          .number()
          .int()
          .nonnegative()
          .max(2147483647)
          .default(0),
        responseTokenCount: z
          .number()
          .int()
          .nonnegative()
          .max(2147483647)
          .default(0),
      })
      .passthrough()
      .optional(),
    error: z.unknown().optional(),
    goAway: z.unknown().optional(),
    toolCallCancellation: z.unknown().optional(),
  })
  .passthrough();

/** Fixed TLS endpoint and model. Tests inject a local socket connector, never a configurable production URL. */
export function createGeminiLiveProvider(
  apiKey: string,
  connect = (url: string) =>
    new WebSocket(url, {
      maxPayload: 131072,
      perMessageDeflate: false,
      handshakeTimeout: 5000,
    }),
): ConversationProviderFactory {
  return {
    async open({ context, instructions, tools, promptMetadata }) {
      if (!apiKey || context.signal.aborted)
        throw new Error("AI provider unavailable");
      if (promptMetadata)
        console.info(
          JSON.stringify({
            event: "ai.session.opening",
            provider: "gemini",
            model: GEMINI_LIVE_MODEL,
            correlationId: context.sessionId,
            ...promptMetadata,
          }),
        );
      const socket = connect(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
      let failed = false,
        ready = false,
        collecting = false,
        committed = false,
        source: "voice" | "text" = "voice";
      let outputBytes = 0,
        received = 0;
      const queue: ProviderEvent[] = [];
      const pending = new Map<string, { providerId: string; name: string }>();
      const seen = new Map<string, string>();
      let waiter:
        | { resolve(value: ProviderEvent): void; reject(error: Error): void }
        | undefined;
      let resolveReady: () => void = () => {},
        rejectReady: (error: Error) => void = () => {};
      const opening = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const failure = () => new Error("AI provider unavailable");
      function close() {
        if (failed) return;
        failed = true;
        queue.length = 0;
        rejectReady(failure());
        waiter?.reject(failure());
        waiter = undefined;
        context.signal.removeEventListener("abort", close);
        socket.terminate();
      }
      function send(value: unknown) {
        const text = JSON.stringify(value);
        if (
          failed ||
          socket.readyState !== WebSocket.OPEN ||
          socket.bufferedAmount + Buffer.byteLength(text) > 262144
        ) {
          close();
          throw failure();
        }
        socket.send(text, (error) => {
          if (error) close();
        });
      }
      function push(event: ProviderEvent) {
        if (failed) return;
        if (queue.length >= 64) {
          close();
          return;
        }
        if (waiter) {
          const current = waiter;
          waiter = undefined;
          current.resolve(event);
        } else queue.push(event);
      }
      socket.on("error", close);
      socket.on("close", close);
      socket.on("open", () => {
        try {
          send({
            setup: {
              model: `models/${GEMINI_LIVE_MODEL}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                maxOutputTokens: 1024,
              },
              systemInstruction: { parts: [{ text: instructions }] },
              realtimeInputConfig: {
                automaticActivityDetection: { disabled: true },
              },
              outputAudioTranscription: {},
              ...(tools.length
                ? {
                    tools: [
                      {
                        functionDeclarations: tools.map((tool) => ({
                          name: tool.id,
                          behavior: "BLOCKING",
                          description: tool.description,
                          parameters: tool.parameters,
                        })),
                      },
                    ],
                  }
                : {}),
            },
          });
        } catch {
          close();
        }
      });
      socket.on("message", (data, binary) => {
        try {
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data);
          if (binary || bytes.byteLength > 131072 || ++received > 4096)
            throw failure();
          const message = EventSchema.parse(JSON.parse(bytes.toString()));
          if (message.error || message.goAway || message.toolCallCancellation)
            throw failure();
          if (message.setupComplete) {
            if (ready) throw failure();
            ready = true;
            resolveReady();
          }
          if (message.serverContent || message.toolCall) {
            if (!ready || !committed) throw failure();
          }
          const content = message.serverContent;
          if (content?.interrupted) throw failure();
          // Native audio is consumed but never forwarded as incompatible 24 kHz protocol audio (#17).
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData) {
              outputBytes += part.inlineData.data.length;
              if (outputBytes > 2097152) throw failure();
            }
          }
          if (content?.outputTranscription?.text)
            push({ type: "text", text: content.outputTranscription.text });
          for (const call of message.toolCall?.functionCalls ?? []) {
            if (seen.has(call.id)) throw failure();
            const id = `call-${randomUUID()}`;
            seen.set(call.id, id);
            pending.set(id, { providerId: call.id, name: call.name });
            push({ type: "tool", id, name: call.name, arguments: call.args });
          }
          if (message.usageMetadata && committed)
            push({
              type: "usage",
              inputTokens: message.usageMetadata.promptTokenCount,
              outputTokens: message.usageMetadata.responseTokenCount,
            });
          if (content?.turnComplete) {
            if (pending.size) throw failure();
            committed = false;
            collecting = false;
            push({ type: "complete" });
          }
        } catch {
          close();
        }
      });
      context.signal.addEventListener("abort", close, { once: true });
      if (context.signal.aborted) close();
      const timer = setTimeout(close, 5000);
      try {
        await opening;
      } finally {
        clearTimeout(timer);
      }
      return {
        async begin(kind) {
          if (failed || collecting || committed || queue.length || waiter)
            throw failure();
          source = kind;
          collecting = true;
          outputBytes = 0;
          pending.clear();
          if (source === "voice")
            send({ realtimeInput: { activityStart: {} } });
        },
        async audio(pcm) {
          if (
            !collecting ||
            committed ||
            source !== "voice" ||
            pcm.byteLength !== 640
          )
            throw failure();
          send({
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: Buffer.from(pcm).toString("base64"),
              },
            },
          });
        },
        async commit(text) {
          if (!collecting || committed || failed) throw failure();
          committed = true;
          if (source === "text")
            send({
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: z.string().min(1).max(4096).parse(text) }],
                  },
                ],
                turnComplete: true,
              },
            });
          else send({ realtimeInput: { activityEnd: {} } });
        },
        async next() {
          const event = queue.shift();
          if (event) return event;
          if (failed || waiter) throw failure();
          return new Promise<ProviderEvent>((resolve, reject) => {
            waiter = { resolve, reject };
          });
        },
        async result(id, name, response) {
          const call = pending.get(id);
          if (!call || call.name !== name || failed) throw failure();
          pending.delete(id);
          send({
            toolResponse: {
              functionResponses: [{ id: call.providerId, name, response }],
            },
          });
        },
        async close() {
          close();
        },
      };
    },
  };
}
