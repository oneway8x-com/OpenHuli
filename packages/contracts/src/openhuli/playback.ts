import { OpenHuliProtocolError } from "./common";
import { parseOpenHuliAudio } from "./audio";

/** Reference simulator playback queue. A sink consumes one 20 ms frame at a time;
 * only its completion permits the caller to send playback.completed. */
export class OpenHuliPlayback {
  private active:
    | {
        turnId: string;
        turnSequence: number;
        streamId: number;
        next: number;
        generated: boolean;
        played: number;
      }
    | undefined;
  private queue: Uint8Array[] = [];
  constructor(private readonly capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1500)
      throw new Error("Invalid playback capacity");
  }
  start(turnId: string, turnSequence: number, streamId: number) {
    if (this.active) throw new OpenHuliProtocolError("Playback already active");
    this.active = {
      turnId,
      turnSequence,
      streamId,
      next: 0,
      generated: false,
      played: 0,
    };
  }
  receive(bytes: Uint8Array): boolean {
    const frame = parseOpenHuliAudio(bytes);
    const current = this.active;
    // Cancelled/previous-turn frames are discarded without playing or acknowledging.
    if (
      !current ||
      frame.turnSequence !== current.turnSequence ||
      frame.streamId !== current.streamId
    )
      return false;
    if (
      frame.kind !== "output" ||
      current.generated ||
      frame.sequence !== current.next ||
      current.next >= 1500
    )
      throw new OpenHuliProtocolError("Invalid playback sequence");
    if (this.queue.length >= this.capacity) {
      this.cancel();
      throw new OpenHuliProtocolError("Playback queue full");
    }
    current.next++;
    this.queue.push(frame.payload);
    return true;
  }
  generationCompleted(lastSequence: number) {
    const current = this.active;
    if (
      !current ||
      current.generated ||
      !current.next ||
      lastSequence !== current.next - 1
    )
      throw new OpenHuliProtocolError("Invalid generation receipt");
    current.generated = true;
  }
  /** Completion is bound to this turn/frame; a late sink callback cannot complete a new turn. */
  take(): { payload: Uint8Array; complete(): boolean } | undefined {
    const current = this.active;
    const payload = this.queue.shift();
    if (!current || !payload) return undefined;
    const sequence = current.next - this.queue.length - 1;
    let completed = false;
    return {
      payload,
      complete: () => {
        if (completed || this.active !== current) return false;
        if (current.played !== sequence)
          throw new OpenHuliProtocolError("Playback completed out of order");
        completed = true;
        current.played++;
        return true;
      },
    };
  }
  completed() {
    const current = this.active;
    if (
      !current ||
      !current.generated ||
      current.played !== current.next ||
      this.queue.length
    )
      return undefined;
    this.active = undefined;
    return {
      turnId: current.turnId,
      streamId: current.streamId,
      lastSequence: current.next - 1,
    };
  }
  cancel() {
    this.queue = [];
    this.active = undefined;
  }
  get queuedFrames() {
    return this.queue.length;
  }
}
