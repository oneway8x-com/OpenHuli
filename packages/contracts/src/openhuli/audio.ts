import { z } from "zod";
import {
  OpenHuliProtocolError,
  OpenHuliSequenceSchema,
  OpenHuliStreamIdSchema,
} from "./common";

export const OPENHULI_AUDIO_HEADER_BYTES = 24;
export const OPENHULI_AUDIO_CHUNK_BYTES = 640;
export const OPENHULI_AUDIO_MESSAGE_BYTES =
  OPENHULI_AUDIO_HEADER_BYTES + OPENHULI_AUDIO_CHUNK_BYTES;
export const OPENHULI_MAX_TURN_CHUNKS = 1500;

const AudioMetadataSchema = z
  .object({
    kind: z.enum(["input", "output"]),
    streamId: OpenHuliStreamIdSchema,
    turnSequence: OpenHuliSequenceSchema.refine((sequence) => sequence > 0),
    sequence: OpenHuliSequenceSchema,
  })
  .strict();
export type OpenHuliAudioFrame = z.infer<typeof AudioMetadataSchema> & {
  payload: Uint8Array;
};

export function encodeOpenHuliAudio(frame: OpenHuliAudioFrame): Uint8Array {
  const meta = AudioMetadataSchema.parse({
    kind: frame.kind,
    streamId: frame.streamId,
    turnSequence: frame.turnSequence,
    sequence: frame.sequence,
  });
  if (frame.payload.byteLength !== OPENHULI_AUDIO_CHUNK_BYTES) {
    throw new OpenHuliProtocolError("PCM chunk must contain exactly 640 bytes");
  }
  const bytes = new Uint8Array(OPENHULI_AUDIO_MESSAGE_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4f48); // ASCII OH; multibyte header fields use network byte order.
  view.setUint8(2, 1);
  view.setUint8(3, meta.kind === "input" ? 1 : 2);
  view.setUint32(4, meta.streamId);
  view.setUint32(8, meta.turnSequence);
  view.setUint32(12, meta.sequence);
  view.setUint32(16, frame.payload.byteLength);
  view.setUint32(20, 0);
  bytes.set(frame.payload, OPENHULI_AUDIO_HEADER_BYTES);
  return bytes;
}

export function parseOpenHuliAudio(bytes: Uint8Array): OpenHuliAudioFrame {
  if (bytes.byteLength !== OPENHULI_AUDIO_MESSAGE_BYTES) {
    throw new OpenHuliProtocolError("Invalid binary message length");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = view.getUint8(3);
  if (
    view.getUint16(0) !== 0x4f48 ||
    view.getUint8(2) !== 1 ||
    (kind !== 1 && kind !== 2) ||
    view.getUint32(20) !== 0
  ) {
    throw new OpenHuliProtocolError("Unsupported audio header");
  }
  if (view.getUint32(16) !== OPENHULI_AUDIO_CHUNK_BYTES) {
    throw new OpenHuliProtocolError("Invalid PCM payload length");
  }
  const meta = AudioMetadataSchema.parse({
    kind: kind === 1 ? "input" : "output",
    streamId: view.getUint32(4),
    turnSequence: view.getUint32(8),
    sequence: view.getUint32(12),
  });
  return { ...meta, payload: bytes.slice(OPENHULI_AUDIO_HEADER_BYTES) };
}

/** Feed decoded WebSocket binary fragments, preserving the WebSocket FIN/message boundary. */
export class OpenHuliAudioMessageDecoder {
  private readonly buffer = new Uint8Array(OPENHULI_AUDIO_MESSAGE_BYTES);
  private used = 0;

  push(
    fragment: Uint8Array,
    endOfMessage: boolean,
  ): OpenHuliAudioFrame | undefined {
    if (this.used + fragment.byteLength > this.buffer.byteLength) {
      this.used = 0;
      throw new OpenHuliProtocolError("Binary message exceeds byte limit");
    }
    this.buffer.set(fragment, this.used);
    this.used += fragment.byteLength;
    if (!endOfMessage) return undefined;
    const message = this.buffer.slice(0, this.used);
    this.used = 0;
    return parseOpenHuliAudio(message);
  }

  finish(): void {
    const pending = this.used;
    this.used = 0;
    if (pending)
      throw new OpenHuliProtocolError(
        "Disconnected with a fragmented audio message",
      );
  }
}
