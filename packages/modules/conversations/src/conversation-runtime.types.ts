import type {
  ConversationBudgets,
  ConversationPhase,
} from "./conversation-operations.types";
import type { z } from "zod";
import type { OpenHuliJsonObjectSchema } from "@corely/contracts";
type JsonObject = z.infer<typeof OpenHuliJsonObjectSchema>;
import type {
  VoiceSessionContext,
  VoiceTurnContext,
} from "@corely/modules-voice";

export interface ConversationTool {
  id: string;
  description: string;
  parameters: JsonObject;
}
export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "audio"; pcm24: Uint8Array }
  | { type: "tool"; id: string; name: string; arguments: JsonObject }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      final?: boolean;
    }
  | { type: "complete" };
/** One live connection retains history. All methods honor the connection's AbortSignal. */
export interface ConversationProvider {
  begin(source: "voice" | "text"): Promise<void>;
  audio(pcm16le: Uint8Array): Promise<void>;
  commit(text?: string): Promise<void>;
  next(): Promise<ProviderEvent>;
  result(id: string, name: string, result: JsonObject): Promise<void>;
  close(): Promise<void>;
}
export interface ConversationProviderFactory {
  open(input: {
    context: VoiceSessionContext;
    instructions: string;
    promptMetadata?: {
      promptId: string;
      promptVersion: string;
      promptHash: string;
    };
    tools: readonly ConversationTool[];
  }): Promise<ConversationProvider>;
}
export interface ConversationJournal {
  start(context: VoiceSessionContext): Promise<void>;
  turn(context: VoiceTurnContext): Promise<void>;
  transition(
    context: VoiceTurnContext,
    status: "committed" | "responding" | "completed" | "cancelled" | "failed",
  ): Promise<void>;
  message(
    context: VoiceTurnContext,
    role: "user" | "assistant",
    text?: string,
  ): Promise<void>;
  audioCompletion?(
    context: VoiceTurnContext,
    kind: "generation" | "playback",
  ): Promise<void>;
  phase?(
    context: VoiceTurnContext,
    phase: ConversationPhase,
    elapsedMs: number,
    executionId?: string,
  ): Promise<void>;
  finalUsage?(
    context: VoiceTurnContext,
    status: "reported" | "unknown",
    costMicros: number | null,
  ): Promise<void>;
  usage(
    context: VoiceTurnContext,
    metric: "input_tokens" | "output_tokens" | "tool_calls",
    quantity: number,
  ): Promise<void>;
}
export interface ConversationRuntimeDependencies {
  budgets?: ConversationBudgets;
  provider: ConversationProviderFactory;
  journal: ConversationJournal;
  tools: readonly ConversationTool[];
  execute(
    context: VoiceTurnContext,
    call: { id: string; name: string; arguments: JsonObject },
    pending?: (executionId: string) => void,
  ): Promise<JsonObject>;
  maxToolCalls: number;
  turnTimeoutMs: number;
}
