import type { VoiceSessionContext } from "@corely/modules-voice";

export interface ConversationPolicy {
  sessionsPerDay: number;
  concurrentSessions: number;
  audioSecondsPerDay: number;
  audioSecondsPerSession: number;
  sessionTimeoutMs: number;
  dailyBudgetMicros: number;
  sessionReservationMicros: number;
  inputMicrosPerMillionTokens?: number | undefined;
  outputMicrosPerMillionTokens?: number | undefined;
  retentionDays: number;
}
export interface ConversationLease {
  signal: AbortSignal;
  audio(bytes: number): Promise<void>;
  check(): void;
  usage(input: number, output: number, turnId: string): Promise<number | null>;
  close(): Promise<void>;
}
export interface ConversationBudgets {
  acquire(context: VoiceSessionContext): Promise<ConversationLease>;
}
export const CONVERSATION_PHASES = [
  "input_started",
  "input_committed",
  "provider_requested",
  "provider_first_event",
  "tool_started",
  "tool_finished",
  "first_useful_output",
  "generation_completed",
  "playback_completed",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ConversationPhase = (typeof CONVERSATION_PHASES)[number];
