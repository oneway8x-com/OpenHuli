import { randomUUID } from "node:crypto";
import {
  OpenHuliVoicePeer,
  parseOpenHuliVoiceClientMessage,
  type OpenHuliVoiceServerMessage,
  type OpenHuliAudioFrame,
} from "@corely/contracts";
import type {
  BoundVoiceDevice,
  VoiceLimits,
  VoiceProviderFactory,
  VoiceProviderSession,
  VoiceProviderTurn,
  VoiceSessionContext,
  VoiceTransport,
  VoiceOutput,
} from "./voice.types";

type Turn = {
  id: string;
  sequence: number;
  abort: AbortController;
  committed: boolean;
  handle: VoiceProviderTurn | undefined;
  timer: ReturnType<typeof setTimeout>;
  expectsPlayback?: boolean;
  played?: boolean;
  completion?: OpenHuliVoiceServerMessage;
};
export class VoiceSession {
  readonly sessionId = randomUUID();
  readonly conversationId = this.sessionId;
  private readonly peer: OpenHuliVoicePeer;
  private readonly abort = new AbortController();
  private provider: VoiceProviderSession | undefined;
  private active: Turn | undefined;
  private outputAudio = false;
  private streamingResponses = false;
  private queuedBytes = 0;
  private queuedMessages = 0;
  private work: Promise<void> = Promise.resolve();
  private closed = false;
  private stopping: Promise<void> | undefined;
  private inflight = new Set<Promise<unknown>>();
  private cleanupFailed = false;
  private cleanups = new Set<Promise<void>>();
  private readonly idle: ReturnType<typeof setTimeout>;
  private readonly lifetime: ReturnType<typeof setTimeout>;
  constructor(
    private readonly device: BoundVoiceDevice,
    private readonly factory: VoiceProviderFactory,
    private readonly transport: VoiceTransport,
    private readonly authorize: () => Promise<void>,
    private readonly limits: VoiceLimits,
  ) {
    this.peer = new OpenHuliVoicePeer("server", device.manifest);
    this.idle = setTimeout(
      () => this.fail("expired", "Voice session idle timeout", 1008),
      limits.idleTimeoutMs,
    );
    this.lifetime = setTimeout(
      () => this.fail("expired", "Voice session expired", 1008),
      Math.max(
        0,
        Math.min(
          limits.sessionTimeoutMs,
          device.identity.expiresAt.getTime() - Date.now(),
        ),
      ),
    );
    this.idle.unref?.();
    this.lifetime.unref?.();
  }
  private context(): VoiceSessionContext {
    return {
      credentialId: this.device.identity.credentialId,
      sessionId: this.sessionId,
      conversationId: this.conversationId,
      tenantId: this.device.identity.tenantId,
      deviceId: this.device.identity.deviceId,
      signal: this.abort.signal,
      outputAudio: this.outputAudio,
      streamingResponses: this.streamingResponses,
    };
  }
  private async bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Voice operation timed out")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.inflight.add(promise);
    void promise.then(
      () => this.inflight.delete(promise),
      () => this.inflight.delete(promise),
    );
    return promise;
  }
  private async assertActive(): Promise<void> {
    try {
      await this.track(this.authorize());
    } catch {
      this.revoke();
      throw new Error("Voice authorization failed");
    }
  }
  private cleanup(work: () => Promise<void>) {
    const task = this.bounded(
      Promise.resolve().then(work),
      this.limits.cleanupTimeoutMs,
    )
      .catch(() => {
        this.cleanupFailed = true;
      })
      .finally(() => this.cleanups.delete(task));
    this.cleanups.add(task);
  }
  private cancelTurn(turn: Turn) {
    clearTimeout(turn.timer);
    turn.abort.abort();
    if (turn.handle) {
      const handle = turn.handle;
      turn.handle = undefined;
      this.cleanup(() => handle.stop());
    }
  }
  private enqueue(size: number, work: () => Promise<void>) {
    if (this.closed) return;
    if (
      this.queuedBytes + size > this.limits.queueBytes ||
      this.queuedMessages + 1 > this.limits.queueMessages
    ) {
      this.fail("limit_exceeded", "Voice consumer is too slow", 1013);
      return;
    }
    this.queuedBytes += size;
    this.queuedMessages++;
    this.work = this.work
      .then(async () => {
        if (!this.closed)
          await this.bounded(work(), this.limits.operationTimeoutMs);
      })
      .catch(() =>
        this.fail("provider_unavailable", "Voice operation failed", 1011),
      )
      .finally(() => {
        this.queuedBytes -= size;
        this.queuedMessages--;
      });
  }
  private send(message: OpenHuliVoiceServerMessage) {
    const text = JSON.stringify(message);
    this.peer.sendControl(text);
    this.transport.control(text);
  }
  private output(turn: Turn): VoiceOutput {
    const current = () =>
      !this.closed &&
      this.active === turn &&
      !turn.abort.signal.aborted &&
      turn.committed;
    return {
      control: (message) => {
        if (!current()) return false;
        try {
          if (!("turnId" in message) || message.turnId !== turn.id)
            return false;
          if (message.type === "audio.start") turn.expectsPlayback = true;
          if (
            message.type === "turn.completed" &&
            turn.expectsPlayback &&
            !turn.played
          ) {
            turn.completion = message;
            return true;
          }
          this.send(message);
        } catch {
          this.fail("invalid_message", "Invalid provider response", 1011);
          return false;
        }
        if (
          message.type === "turn.completed" ||
          message.type === "turn.failed"
        ) {
          this.active = undefined;
          this.cancelTurn(turn);
        }
        return true;
      },
      audio: (bytes) => {
        if (!current()) return false;
        try {
          this.peer.sendAudio(bytes);
          this.transport.audio(bytes);
          return true;
        } catch {
          this.fail("invalid_message", "Invalid provider audio", 1011);
          return false;
        }
      },
    };
  }
  /** WebSocket libraries reassemble fragments; each call is one complete text/binary message. */
  receive(bytes: Uint8Array, binary: boolean): void {
    if (this.closed) return;
    this.idle.refresh();
    try {
      if (binary) {
        const frame: OpenHuliAudioFrame = this.peer.receiveAudio(bytes);
        const turn = this.active;
        if (!turn) throw new Error("No collecting turn");
        this.enqueue(bytes.byteLength, async () => {
          if (turn.abort.signal.aborted) return;
          if (!turn.handle) throw new Error("Provider turn unavailable");
          await this.track(turn.handle.appendAudio(frame));
        });
        return;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const message = parseOpenHuliVoiceClientMessage(text);
      this.peer.receiveControl(text);
      switch (message.type) {
        case "session.start": {
          this.enqueue(bytes.byteLength, async () => {
            await this.assertActive();
            if (this.closed) return;
            this.streamingResponses = Boolean(message.streamingResponses);
            this.outputAudio = Boolean(
              message.outputFormat && this.factory.supportsOutputAudio,
            );
            const opening = this.track(this.factory.open(this.context()));
            void opening.then(
              (handle) => {
                if (this.closed) this.cleanup(() => handle.close());
              },
              () => {},
            );
            this.provider = await opening;
            if (this.closed) return;
            this.send({
              version: 1,
              type: "session.ready",
              messageId: randomUUID(),
              sessionId: this.sessionId,
              inputFormat: message.inputFormat,
              ...(this.streamingResponses
                ? { streamingResponses: true as const }
                : {}),
              ...(message.outputFormat && this.factory.supportsOutputAudio
                ? { outputFormat: message.outputFormat }
                : {}),
            });
          });
          break;
        }
        case "turn.start":
        case "turn.text": {
          const turn: Turn = {
            id: message.turnId,
            sequence: message.turnSequence,
            abort: new AbortController(),
            committed: false,
            handle: undefined,
            timer: setTimeout(
              () =>
                this.fail(
                  "limit_exceeded",
                  "Voice turn duration exceeded",
                  1008,
                ),
              this.limits.turnTimeoutMs,
            ),
          };
          turn.timer.unref?.();
          this.active = turn;
          this.enqueue(bytes.byteLength, async () => {
            if (turn.abort.signal.aborted) return;
            await this.assertActive();
            if (turn.abort.signal.aborted) return;
            if (!this.provider) throw new Error("Provider session unavailable");
            const opening = this.track(
              this.provider.startTurn(
                {
                  ...this.context(),
                  source: message.type === "turn.text" ? "text" : "voice",
                  turnId: turn.id,
                  turnSequence: turn.sequence,
                  outputStreamId: this.peer.allocateOutputStream(),
                  signal: turn.abort.signal,
                },
                this.output(turn),
              ),
            );
            void opening.then(
              (handle) => {
                if (turn.abort.signal.aborted || this.closed)
                  this.cleanup(() => handle.stop());
              },
              () => {},
            );
            const handle = await opening;
            if (turn.abort.signal.aborted || this.closed) return;
            turn.handle = handle;
            if (message.type === "turn.text") {
              if (!handle.appendText) throw new Error("Text input unsupported");
              await this.track(handle.appendText(message.text));
              await this.assertActive();
              if (turn.abort.signal.aborted || this.closed) return;
              turn.committed = true;
              await this.track(
                handle.commit({
                  ...this.context(),
                  source: "text",
                  turnId: turn.id,
                  turnSequence: turn.sequence,
                  signal: turn.abort.signal,
                  lastSequence: 0,
                  committedAt: new Date(),
                }),
              );
            }
          });
          break;
        }
        case "turn.commit": {
          const turn = this.active;
          if (!turn) throw new Error("No collecting turn");
          this.enqueue(bytes.byteLength, async () => {
            if (turn.abort.signal.aborted) return;
            await this.assertActive();
            if (turn.abort.signal.aborted || this.closed) return;
            if (!turn.handle) throw new Error("Provider turn unavailable");
            turn.committed = true;
            await this.track(
              turn.handle.commit({
                ...this.context(),
                turnId: turn.id,
                turnSequence: turn.sequence,
                signal: turn.abort.signal,
                lastSequence: message.lastSequence,
                committedAt: new Date(),
              }),
            );
          });
          break;
        }
        case "turn.cancel": {
          const turn = this.active;
          this.active = undefined;
          if (turn) this.cancelTurn(turn);
          break;
        }
        case "playback.completed": {
          const turn = this.active;
          if (!turn) throw new Error("No playback turn");
          this.enqueue(bytes.byteLength, async () => {
            await this.assertActive();
            if (turn.abort.signal.aborted || this.closed) return;
            await this.track(
              turn.handle?.playbackCompleted?.() ?? Promise.resolve(),
            );
            if (turn.abort.signal.aborted || this.closed) return;
            turn.played = true;
            if (turn.completion) this.output(turn).control(turn.completion);
          });
          break;
        }
      }
    } catch {
      this.fail("invalid_message", "Invalid voice message", 1008);
    }
  }
  revoke(): void {
    this.fail("unauthorized", "Voice credential is no longer valid", 1008);
  }
  private fail(
    code:
      | "invalid_message"
      | "limit_exceeded"
      | "expired"
      | "unauthorized"
      | "provider_unavailable",
    message: string,
    status: number,
  ) {
    if (this.closed) return;
    try {
      this.transport.control(
        JSON.stringify({
          version: 1,
          type: "session.error",
          messageId: randomUUID(),
          error: {
            code,
            message,
            correlationId: this.sessionId,
            retryable: false,
          },
        }),
      );
    } catch {
      /* Close without adding output to a congested socket. */
    }
    void this.stop().catch(() => {});
    this.transport.close(status, message);
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    this.abort.abort();
    this.peer.close();
    clearTimeout(this.idle);
    clearTimeout(this.lifetime);
    if (this.active) {
      this.cancelTurn(this.active);
      this.active = undefined;
    }
    if (this.provider) {
      const provider = this.provider;
      this.provider = undefined;
      this.cleanup(() => provider.close());
    }
    this.stopping = (async () => {
      try {
        await this.bounded(
          Promise.all([this.work, Promise.allSettled([...this.inflight])]),
          this.limits.cleanupTimeoutMs,
        );
      } catch {
        this.cleanupFailed = true;
      }
      await Promise.all([...this.cleanups]);
      if (this.cleanupFailed) throw new Error("Voice cleanup failed");
    })();
    return this.stopping;
  }
}
