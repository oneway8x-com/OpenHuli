import type {
  DeviceCapabilityManifest,
  OpenHuliAudioFrame,
  OpenHuliVoiceServerMessage,
} from "@corely/contracts";
export interface VoiceIdentity {
  tenantId: string;
  deviceId: string;
  credentialId: string;
  expiresAt: Date;
}
export interface BoundVoiceDevice {
  identity: VoiceIdentity;
  manifest: DeviceCapabilityManifest;
}
export interface VoiceAuthorization {
  authenticate(token: string): Promise<BoundVoiceDevice>;
  revalidate(identity: VoiceIdentity): Promise<void>;
  watch(identity: VoiceIdentity, revoke: () => void): () => void;
  close(): Promise<void>;
}
export interface VoiceSessionContext {
  credentialId: string;
  sessionId: string;
  conversationId: string;
  tenantId: string;
  deviceId: string;
  signal: AbortSignal;
  outputAudio?: boolean;
  streamingResponses?: boolean;
}
export interface VoiceTurnContext extends VoiceSessionContext {
  source?: "text" | "voice";
  turnId: string;
  turnSequence: number;
  outputStreamId?: number;
}
export interface CommittedVoiceTurn extends VoiceTurnContext {
  lastSequence: number;
  committedAt: Date;
}
export interface VoiceOutput {
  control(message: OpenHuliVoiceServerMessage): boolean;
  audio(frame: Uint8Array): boolean;
}
/** Append must never dispatch actions; only commit may start the authenticated conversation use case. */
export interface VoiceProviderTurn {
  appendAudio(frame: OpenHuliAudioFrame): Promise<void>;
  appendText?(text: string): Promise<void>;
  commit(context: CommittedVoiceTurn): Promise<void>;
  playbackCompleted?(): Promise<void>;
  stop(): Promise<void>;
}
export interface VoiceProviderSession {
  startTurn(
    context: VoiceTurnContext,
    output: VoiceOutput,
  ): Promise<VoiceProviderTurn>;
  close(): Promise<void>;
}
/** Provider operations must honor abort; cleanup must be idempotent after partial startup. */
export interface VoiceProviderFactory {
  isReady(): boolean;
  supportsOutputAudio: boolean;
  open(context: VoiceSessionContext): Promise<VoiceProviderSession>;
}
export interface VoiceTransport {
  control(text: string): void;
  audio(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
}
export interface VoiceLimits {
  queueBytes: number;
  queueMessages: number;
  operationTimeoutMs: number;
  cleanupTimeoutMs: number;
  turnTimeoutMs: number;
  sessionTimeoutMs: number;
  idleTimeoutMs: number;
}
export const DEFAULT_VOICE_LIMITS: VoiceLimits = {
  queueBytes: 32 * 664,
  queueMessages: 64,
  operationTimeoutMs: 5000,
  cleanupTimeoutMs: 5000,
  turnTimeoutMs: 30000,
  sessionTimeoutMs: 600000,
  idleTimeoutMs: 30000,
};

/** Fixed, safe quota message that transports may return to the authenticated caller. */
export class VoiceLimitError extends Error {}
