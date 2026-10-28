export const Kind = {
  probe: 1,
  challenge: 2,
  start: 3,
  ready: 4,
  heartbeat: 5,
  sample: 6,
  command: 7,
  result: 8,
} as const;
export interface Frame {
  kind: number;
  data: Buffer;
}
export function crc(bytes: Uint8Array) {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let i = 0; i < 8; ++i)
      value = ((value << 1) ^ (value & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return value;
}
export function encode(frame: Frame) {
  if (frame.data.length > 80 || frame.kind < 1 || frame.kind > 8)
    throw new Error("Invalid serial frame");
  const bytes = Buffer.alloc(frame.data.length + 7);
  bytes.set([79, 72, 1, frame.kind, frame.data.length]);
  frame.data.copy(bytes, 5);
  bytes.writeUInt16LE(crc(bytes.subarray(2, -2)), bytes.length - 2);
  return bytes;
}
export class Decoder {
  private bytes = Buffer.alloc(87);
  private used = 0;
  feed(input: Uint8Array, receive: (frame: Frame) => void) {
    for (const b of input) {
      if (!this.used) {
        if (b === 79) this.bytes[this.used++] = b;
        continue;
      }
      if (this.used === 1 && b !== 72) {
        this.used = b === 79 ? 1 : 0;
        continue;
      }
      this.bytes[this.used++] = b;
      if (
        (this.used === 3 && b !== 1) ||
        (this.used === 4 && (b < 1 || b > 8)) ||
        (this.used === 5 && b > 80)
      ) {
        this.used = 0;
        continue;
      }
      if (this.used >= 7 && this.used === this.bytes[4]! + 7) {
        const length = this.used;
        this.used = 0;
        if (
          crc(this.bytes.subarray(2, length - 2)) ===
          this.bytes.readUInt16LE(length - 2)
        )
          receive({
            kind: this.bytes[3]!,
            data: Buffer.from(this.bytes.subarray(5, length - 2)),
          });
      }
    }
  }
}
