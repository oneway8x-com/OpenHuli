import { VoiceLimitError } from "@corely/modules-voice";
import { setTimeout as pause } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PromptRegistry,
  StaticPromptProvider,
  promptDefinitions,
} from "@corely/prompts";
import {
  OpenHuliVoiceServerMessageSchema,
  OpenHuliPcmOutput,
  OPENHULI_PCM_FORMAT,
  encodeOpenHuliAudio,
  OpenHuliIdSchema,
  OpenHuliJsonObjectSchema,
} from "@corely/contracts";
import type {
  VoiceProviderFactory,
  VoiceProviderSession,
  VoiceTurnContext,
} from "@corely/modules-voice";
import type { ConversationRuntimeDependencies } from "./conversation-runtime.types";

const prompts = new PromptRegistry([
  new StaticPromptProvider(promptDefinitions),
]);
const Text = z.string().trim().min(1).max(4096);

async function untilAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Turn interrupted"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([work, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Shared committed-turn use case for device voice and typed input. No transport or Prisma access. */
export function createConversationRuntime(
  deps: ConversationRuntimeDependencies,
): VoiceProviderFactory {
  z.number().int().min(1).max(16).parse(deps.maxToolCalls);
  z.number().int().min(100).max(30000).parse(deps.turnTimeoutMs);
  return {
    isReady: () => true,
    supportsOutputAudio: true,
    async open(context): Promise<VoiceProviderSession> {
      await deps.journal.start(context);
      const lease = await deps.budgets?.acquire(context);
      context = {
        ...context,
        signal: AbortSignal.any([
          context.signal,
          ...(lease ? [lease.signal] : []),
        ]),
      };
      const rendered = prompts.render(
        "device.assistant",
        { environment: "runtime" },
        { DEVICE_ID: context.deviceId },
      );
      const provider = await deps.provider
        .open({
          context,
          instructions: rendered.content,
          promptMetadata: {
            promptId: rendered.promptId,
            promptVersion: rendered.promptVersion,
            promptHash: rendered.promptHash,
          },
          tools: deps.tools,
        })
        .catch(async (error) => {
          await lease?.close();
          throw error;
        });
      let outputStream = 0x80000000;
      let closed = false,
        starting = false,
        actionsBlocked = false;
      let active: { stop(): Promise<void> } | undefined;
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => {
        if (!closing) {
          closed = true;
          closing = Promise.resolve().then(async () => {
            try {
              await provider.close();
            } finally {
              await lease?.close();
            }
          });
        }
        return closing;
      };
      const abortSession = () => {
        void close().catch(() => {});
      };
      context.signal.addEventListener("abort", abortSession, { once: true });
      if (context.signal.aborted) {
        await close();
        throw new Error("Session cancelled");
      }
      return {
        async startTurn(turn, output) {
          lease?.check();
          if (closed || starting || active || turn.signal.aborted)
            throw new Error("Conversation unavailable");
          const startedAt = performance.now();
          const phase = (
            name: Parameters<NonNullable<typeof deps.journal.phase>>[1],
            executionId?: string,
          ) =>
            deps.journal.phase?.(
              current,
              name,
              Math.min(2147483647, Math.round(performance.now() - startedAt)),
              executionId,
            );
          const controller = new AbortController();
          const current: VoiceTurnContext = {
            ...turn,
            signal: controller.signal,
          };
          let committed = false,
            finished = false,
            text: string | undefined;
          let generated = false,
            played = false;
          let task: Promise<void> | undefined;
          let stopping: Promise<void> | undefined;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const abort = () => {
            controller.abort();
            void close().catch(() => {});
          };
          turn.signal.addEventListener("abort", abort, { once: true });
          context.signal.addEventListener("abort", abort, { once: true });
          starting = true;
          let recorded = false;
          try {
            await deps.journal.turn(current);
            recorded = true;
            await phase("input_started");
            if (controller.signal.aborted) throw new Error("Cancelled");
            await provider.begin(turn.source ?? "voice");
          } catch (error) {
            turn.signal.removeEventListener("abort", abort);
            context.signal.removeEventListener("abort", abort);
            if (recorded) await deps.journal.transition(current, "failed");
            await close();
            throw error;
          } finally {
            starting = false;
          }
          const handle = {
            async appendAudio(frame: { payload: Uint8Array }) {
              if (committed || text !== undefined || controller.signal.aborted)
                throw new Error("Input closed");
              await lease?.audio(frame.payload.byteLength);
              lease?.check();
              await provider.audio(frame.payload);
            },
            async appendText(value: string) {
              if (committed || turn.source !== "text" || text !== undefined)
                throw new Error("Input closed");
              text = Text.parse(value);
            },
            async commit() {
              if (committed || controller.signal.aborted)
                throw new Error("Turn already committed or cancelled");
              lease?.check();
              committed = true;
              // Return promptly: the outer gateway operation budget governs queue acceptance, not model latency.
              task = run();
              void task.catch(() => {});
            },
            async playbackCompleted() {
              if (!generated || played || controller.signal.aborted)
                throw new Error("Playback out of order");
              await phase("playback_completed");
              await deps.journal.audioCompletion?.(current, "playback");
              if (controller.signal.aborted)
                throw new Error("Playback cancelled");
              await deps.journal.transition(current, "completed");
              played = true;
              if (active === handle) active = undefined;
            },
            stop(): Promise<void> {
              if (stopping) return stopping;
              if (!finished || (generated && !played)) abort();
              stopping =
                generated && !played && finished
                  ? deps.journal.transition(current, "cancelled")
                  : (task ??
                    (async () => {
                      await deps.journal.transition(current, "cancelled");
                      turn.signal.removeEventListener("abort", abort);
                      context.signal.removeEventListener("abort", abort);
                      if (active === handle) active = undefined;
                    })());
              return stopping;
            },
          };
          active = handle;
          async function run() {
            let answer = "",
              calls = 0,
              events = 0;
            let converter = new OpenHuliPcmOutput();
            let sequence = 0;
            const streamId = turn.outputStreamId ?? ++outputStream;
            let buffered: Uint8Array[] = [];
            // Tool-capable turns hold model claims until authoritative results are known.
            const streamImmediately = deps.tools.length === 0;
            const control = (fields: Record<string, unknown>) => {
              // All variants are checked again by the transport's wire peer.
              return output.control(
                OpenHuliVoiceServerMessageSchema.parse({
                  version: 1,
                  messageId: randomUUID(),
                  turnId: turn.turnId,
                  ...fields,
                }),
              );
            };
            const deliver = async (frames: Uint8Array[]) => {
              if (!context.outputAudio) return;
              for (const payload of frames) {
                if (controller.signal.aborted || sequence >= 1500)
                  throw new Error("Output stopped or too long");
                if (
                  sequence === 0 &&
                  !control({
                    type: "audio.start",
                    streamId,
                    format: OPENHULI_PCM_FORMAT,
                  })
                )
                  throw new Error("Output closed");
                if (
                  !output.audio(
                    encodeOpenHuliAudio({
                      kind: "output",
                      streamId,
                      turnSequence: turn.turnSequence,
                      sequence: sequence++,
                      payload,
                    }),
                  )
                )
                  throw new Error("Output closed");
                if (sequence === 1) await useful();
                await pause(20, undefined, { signal: controller.signal });
              }
            };
            const identities = new Set<string>();
            const results: { id: string; status: string }[] = [];
            let inputTokens: number | undefined,
              outputTokens: number | undefined;
            let finalUsageReceived = false;
            let estimatedCostMicros: number | null = null;
            let firstEvent = false,
              usefulOutput = false;
            const useful = async () => {
              if (!usefulOutput) {
                usefulOutput = true;
                await phase("first_useful_output");
              }
            };
            const send = (
              type: "response.text" | "turn.completed",
              value?: string,
            ) =>
              output.control({
                version: 1,
                messageId: randomUUID(),
                turnId: turn.turnId,
                ...(type === "response.text"
                  ? { type, text: value ?? "" }
                  : { type }),
              });
            timer = setTimeout(() => {
              controller.abort(new VoiceLimitError("Turn time budget reached"));
              void close().catch(() => {});
            }, deps.turnTimeoutMs);
            try {
              await deps.journal.transition(current, "committed");
              await deps.journal.message(current, "user", text);
              if (controller.signal.aborted) throw new Error("Cancelled");
              await phase("input_committed");
              lease?.check();
              await phase("provider_requested");
              await provider.commit(text);
              await deps.journal.transition(current, "responding");
              while (!controller.signal.aborted) {
                if (++events > 2048)
                  throw new Error("Provider event budget exceeded");
                const event = await untilAbort(
                  provider.next(),
                  controller.signal,
                );
                if (controller.signal.aborted) throw new Error("Cancelled");
                lease?.check();
                if (!firstEvent) {
                  firstEvent = true;
                  await phase("provider_first_event");
                }
                if (event.type === "text") {
                  answer += event.text;
                  if (answer.length > 4096)
                    throw new Error("Response too long");

                  if (
                    context.streamingResponses &&
                    streamImmediately &&
                    event.text.length &&
                    !control({ type: "response.delta", text: event.text })
                  )
                    throw new Error("Output closed");
                  if (
                    context.streamingResponses &&
                    streamImmediately &&
                    event.text.length
                  )
                    await useful();
                } else if (event.type === "audio") {
                  const frames = converter.push(event.pcm24);
                  if (context.outputAudio) {
                    if (streamImmediately) await deliver(frames);
                    else {
                      buffered.push(...frames);
                      if (buffered.length > 1500)
                        throw new Error("Output too long");
                    }
                  }
                } else if (event.type === "tool") {
                  if (++calls > deps.maxToolCalls)
                    throw new VoiceLimitError("Tool call budget reached");
                  const id = OpenHuliIdSchema.parse(event.id);
                  if (identities.has(id))
                    throw new Error("Repeated provider call identity");
                  identities.add(id);
                  // Definitions are server-owned. Unlisted calls never enter the executor.
                  let result;
                  if (
                    actionsBlocked ||
                    !deps.tools.some((tool) => tool.id === event.name)
                  )
                    result = { status: "denied", error: "Tool not available" };
                  else {
                    try {
                      lease?.check();
                      await phase("tool_started");
                      result = await untilAbort(
                        deps.execute(
                          current,
                          {
                            ...event,
                            id,
                            arguments: OpenHuliJsonObjectSchema.parse(
                              event.arguments,
                            ),
                          },
                          (executionId) => {
                            if (
                              context.streamingResponses &&
                              !controller.signal.aborted
                            )
                              control({
                                type: "tool.result",
                                executionId,
                                status: "awaiting_approval",
                              });
                          },
                        ),
                        controller.signal,
                      );
                    } catch {
                      result = {
                        status: "denied",
                        error: "Tool request denied or invalid",
                      };
                    }
                  }
                  const safe = OpenHuliJsonObjectSchema.parse(result);
                  await phase(
                    "tool_finished",
                    typeof safe.executionId === "string"
                      ? safe.executionId
                      : undefined,
                  );
                  lease?.check();
                  if (
                    [
                      "unknown",
                      "awaiting_approval",
                      "queued",
                      "running",
                      "cancelled",
                      "expired",
                    ].includes(String(safe.status))
                  )
                    actionsBlocked = true;
                  results.push({
                    id:
                      typeof safe.executionId === "string"
                        ? safe.executionId
                        : id,
                    status:
                      safe.outcome === "partial"
                        ? "partial"
                        : typeof safe.status === "string"
                          ? safe.status
                          : "unknown",
                  });
                  await deps.journal.usage(current, "tool_calls", 1);
                  if (controller.signal.aborted) throw new Error("Cancelled");
                  const status = results.at(-1)!;
                  if (
                    context.streamingResponses &&
                    !control({
                      type: "tool.result",
                      executionId: status.id,
                      status:
                        status.status === "partial"
                          ? "succeeded"
                          : status.status,
                    })
                  )
                    throw new Error("Output closed");
                  await provider.result(id, event.name, safe);
                  // Discard provisional language before calls: only a final post-result answer is delivered.
                  answer = "";
                  buffered = [];
                  converter = new OpenHuliPcmOutput();
                } else if (event.type === "usage") {
                  finalUsageReceived = event.final === true;
                  inputTokens = z
                    .number()
                    .int()
                    .min(0)
                    .max(2147483647)
                    .parse(event.inputTokens);
                  outputTokens = z
                    .number()
                    .int()
                    .min(0)
                    .max(2147483647)
                    .parse(event.outputTokens);
                  estimatedCostMicros =
                    (await lease?.usage(
                      inputTokens,
                      outputTokens,
                      turn.turnId,
                    )) ?? null;
                } else {
                  // Non-success tool outcomes always produce an authoritative status, not a model success claim.
                  const uncertain = results.some(
                    (result) => result.status !== "succeeded",
                  );
                  const body = uncertain
                    ? "The requested action is not confirmed. Review the tool result or clarify the request."
                    : Text.parse(answer);
                  const evidence = results.length
                    ? `\nTool results: ${results.map((result) => `${result.id}: ${result.status}`).join(", ")}`
                    : "";
                  const final = (body + evidence).slice(0, 4096);
                  await deps.journal.message(current, "assistant", final);
                  await deps.journal.finalUsage?.(
                    current,
                    finalUsageReceived &&
                      inputTokens !== undefined &&
                      outputTokens !== undefined
                      ? "reported"
                      : "unknown",
                    estimatedCostMicros,
                  );
                  if (finalUsageReceived && inputTokens !== undefined)
                    await deps.journal.usage(
                      current,
                      "input_tokens",
                      inputTokens,
                    );
                  if (finalUsageReceived && outputTokens !== undefined)
                    await deps.journal.usage(
                      current,
                      "output_tokens",
                      outputTokens,
                    );
                  if (controller.signal.aborted) throw new Error("Cancelled");
                  if (!uncertain && context.outputAudio) {
                    await deliver([...buffered, ...converter.finish()]);
                    buffered = [];
                    if (sequence) {
                      await deps.journal.audioCompletion?.(
                        current,
                        "generation",
                      );
                      await phase("generation_completed");
                      generated = true;
                      if (
                        !control({
                          type: "audio.generation.completed",
                          streamId,
                          lastSequence: sequence - 1,
                        })
                      )
                        throw new Error("Output closed");
                    }
                  }
                  if (!generated)
                    await deps.journal.transition(current, "completed");
                  if (controller.signal.aborted) throw new Error("Cancelled");
                  finished = true;
                  // Detach abort before emitting: turn completion disposes the gateway's turn handle synchronously.
                  turn.signal.removeEventListener("abort", abort);
                  context.signal.removeEventListener("abort", abort);
                  if (!send("response.text", final)) {
                    await close();
                    return;
                  }
                  await useful();
                  await phase("completed");
                  if (!send("turn.completed")) await close();
                  return;
                }
              }
              throw new Error("Cancelled");
            } catch (error) {
              const limit =
                error instanceof VoiceLimitError
                  ? error
                  : lease?.signal.reason instanceof VoiceLimitError
                    ? lease.signal.reason
                    : controller.signal.reason instanceof VoiceLimitError
                      ? controller.signal.reason
                      : undefined;
              const cancelled = controller.signal.aborted && !limit;
              controller.abort(limit ?? error);
              await close();
              await deps.journal.finalUsage?.(
                current,
                "unknown",
                estimatedCostMicros,
              );
              await phase(cancelled ? "cancelled" : "failed");
              await deps.journal.transition(
                current,
                cancelled ? "cancelled" : "failed",
              );
              output.control({
                version: 1,
                type: "turn.failed",
                messageId: randomUUID(),
                turnId: turn.turnId,
                error: {
                  code: limit
                    ? "limit_exceeded"
                    : cancelled
                      ? "cancelled"
                      : "provider_unavailable",
                  message:
                    limit?.message ??
                    "Turn stopped; no successful outcome is implied",
                  correlationId: turn.turnId,
                  retryable: false,
                },
              });
            } finally {
              finished = true;
              clearTimeout(timer);
              turn.signal.removeEventListener("abort", abort);
              context.signal.removeEventListener("abort", abort);
              if (active === handle && !(generated && !played))
                active = undefined;
            }
          }
          return handle;
        },
        async close() {
          context.signal.removeEventListener("abort", abortSession);
          const stopped = active?.stop();
          await close();
          await stopped;
        },
      };
    },
  };
}
