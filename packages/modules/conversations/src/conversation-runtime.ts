import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PromptRegistry,
  StaticPromptProvider,
  promptDefinitions,
} from "@corely/prompts";
import { OpenHuliIdSchema, OpenHuliJsonObjectSchema } from "@corely/contracts";
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
    supportsOutputAudio: false,
    async open(context): Promise<VoiceProviderSession> {
      await deps.journal.start(context);
      const rendered = prompts.render(
        "device.assistant",
        { environment: "runtime" },
        { DEVICE_ID: context.deviceId },
      );
      const provider = await deps.provider.open({
        context,
        instructions: rendered.content,
        promptMetadata: {
          promptId: rendered.promptId,
          promptVersion: rendered.promptVersion,
          promptHash: rendered.promptHash,
        },
        tools: deps.tools,
      });
      let closed = false,
        starting = false,
        actionsBlocked = false;
      let active: { stop(): Promise<void> } | undefined;
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => {
        if (!closing) {
          closed = true;
          closing = Promise.resolve().then(() => provider.close());
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
          if (closed || starting || active || turn.signal.aborted)
            throw new Error("Conversation unavailable");
          const controller = new AbortController();
          const current: VoiceTurnContext = {
            ...turn,
            signal: controller.signal,
          };
          let committed = false,
            finished = false,
            text: string | undefined;
          let task: Promise<void> | undefined;
          let stopping: Promise<void> | undefined;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const abort = () => {
            controller.abort();
            void close().catch(() => {});
          };
          turn.signal.addEventListener("abort", abort, { once: true });
          starting = true;
          let recorded = false;
          try {
            await deps.journal.turn(current);
            recorded = true;
            if (controller.signal.aborted) throw new Error("Cancelled");
            await provider.begin(turn.source ?? "voice");
          } catch (error) {
            turn.signal.removeEventListener("abort", abort);
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
              committed = true;
              // Return promptly: the outer gateway operation budget governs queue acceptance, not model latency.
              task = run();
              void task.catch(() => {});
            },
            stop(): Promise<void> {
              if (stopping) return stopping;
              if (!finished) abort();
              stopping =
                task ??
                (async () => {
                  await deps.journal.transition(current, "cancelled");
                  turn.signal.removeEventListener("abort", abort);
                  if (active === handle) active = undefined;
                })();
              return stopping;
            },
          };
          active = handle;
          async function run() {
            let answer = "",
              calls = 0,
              events = 0;
            const identities = new Set<string>();
            const results: { id: string; status: string }[] = [];
            let inputTokens: number | undefined,
              outputTokens: number | undefined;
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
            timer = setTimeout(abort, deps.turnTimeoutMs);
            try {
              await deps.journal.transition(current, "committed");
              await deps.journal.message(current, "user", text);
              if (controller.signal.aborted) throw new Error("Cancelled");
              await provider.commit(text);
              await deps.journal.transition(current, "responding");
              while (!controller.signal.aborted) {
                if (++events > 512)
                  throw new Error("Provider event budget exceeded");
                const event = await untilAbort(
                  provider.next(),
                  controller.signal,
                );
                if (controller.signal.aborted) throw new Error("Cancelled");
                if (event.type === "text") {
                  answer += event.text;
                  if (answer.length > 4096)
                    throw new Error("Response too long");
                } else if (event.type === "tool") {
                  if (++calls > deps.maxToolCalls)
                    throw new Error("Tool budget exceeded");
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
                      result = await untilAbort(
                        deps.execute(current, {
                          ...event,
                          id,
                          arguments: OpenHuliJsonObjectSchema.parse(
                            event.arguments,
                          ),
                        }),
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
                      typeof safe.status === "string" ? safe.status : "unknown",
                  });
                  await deps.journal.usage(current, "tool_calls", 1);
                  if (controller.signal.aborted) throw new Error("Cancelled");
                  await provider.result(id, event.name, safe);
                  // Discard provisional language before calls: only a final post-result answer is delivered.
                  answer = "";
                } else if (event.type === "usage") {
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
                  if (inputTokens !== undefined)
                    await deps.journal.usage(
                      current,
                      "input_tokens",
                      inputTokens,
                    );
                  if (outputTokens !== undefined)
                    await deps.journal.usage(
                      current,
                      "output_tokens",
                      outputTokens,
                    );
                  if (controller.signal.aborted) throw new Error("Cancelled");
                  await deps.journal.transition(current, "completed");
                  if (controller.signal.aborted) throw new Error("Cancelled");
                  finished = true;
                  // Detach abort before emitting: turn completion disposes the gateway's turn handle synchronously.
                  turn.signal.removeEventListener("abort", abort);
                  if (!send("response.text", final) || !send("turn.completed"))
                    await close();
                  return;
                }
              }
              throw new Error("Cancelled");
            } catch {
              await close();
              await deps.journal.transition(
                current,
                controller.signal.aborted ? "cancelled" : "failed",
              );
              output.control({
                version: 1,
                type: "turn.failed",
                messageId: randomUUID(),
                turnId: turn.turnId,
                error: {
                  code: controller.signal.aborted
                    ? "cancelled"
                    : "provider_unavailable",
                  message: "Turn stopped; no successful outcome is implied",
                  correlationId: turn.turnId,
                  retryable: false,
                },
              });
            } finally {
              finished = true;
              clearTimeout(timer);
              turn.signal.removeEventListener("abort", abort);
              if (active === handle) active = undefined;
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
