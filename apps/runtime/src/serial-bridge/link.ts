import { randomBytes } from "node:crypto";
import type { DeviceCommand } from "@corely/contracts";
import { Decoder, encode, Kind, type Frame } from "./wire";
export interface LocalResult {
  status: "succeeded" | "failed" | "expired" | "unknown";
  reason?: "unsupported_capability";
  completedAt: number;
}
export interface LocalSample {
  sequence: number;
  sampledAt: number;
  temperature: { state: number; value: number };
  humidity: { state: number; value: number };
}
/** A physical link, independent of OS serial and MQTT. One outstanding command, no replay. */
export class SerialLink {
  private decoder = new Decoder();
  private session: Buffer | undefined;
  private nonce = randomBytes(16);
  private probeAt = -Infinity;
  private heardAt = -Infinity;
  private sentAt = -Infinity;
  private startedAt = 0;
  private anchorTick = 0;
  private anchorUtc = 0;
  private anchorMono = 0;
  private uncertainty = 0;
  private acknowledgedHeartbeat = 0;
  private heartbeatSequence = 0;
  private sequence = 0;
  private sampleSequence = 0;
  private active = false;
  private pending:
    | {
        sequence: number;
        expires: number;
        settle: (value: LocalResult) => void;
      }
    | undefined;
  constructor(
    private readonly io: {
      write(bytes: Buffer): boolean;
      now(): number;
      monotonic(): number;
      sensors: number;
      display: number;
      sample(value: LocalSample): void;
      state(online: boolean): void;
    },
  ) {}
  connected() {
    return this.active;
  }
  generation() {
    return this.session?.toString("hex");
  }
  private send(kind: number, data: Buffer = Buffer.alloc(0)) {
    return this.io.write(encode({ kind, data }));
  }
  reset() {
    const was = this.active;
    this.active = false;
    this.session = undefined;
    this.pending?.settle({ status: "unknown", completedAt: this.io.now() });
    this.pending = undefined;
    this.probeAt = -Infinity;
    this.decoder = new Decoder();
    if (was) this.io.state(false);
  }
  poll() {
    const tick = this.io.monotonic(),
      now = this.io.now();
    if (
      this.active &&
      (tick - this.heardAt >= 3000 ||
        tick - this.startedAt >= 3600000 ||
        Math.abs(now - (this.anchorUtc + tick - this.anchorMono)) > 1000)
    )
      this.reset();
    if (this.pending && now >= this.pending.expires) {
      this.pending.settle({ status: "unknown", completedAt: now });
      this.pending = undefined;
    }
    if (!this.active && tick - this.probeAt >= 1100) {
      this.session = undefined;
      this.nonce = randomBytes(16);
      this.probeAt = tick;
      this.send(Kind.probe);
    } else if (this.active && tick - this.sentAt >= 1000) {
      this.sentAt = tick;
      const data = Buffer.alloc(28);
      this.session?.copy(data);
      data.writeUInt32LE(++this.heartbeatSequence, 24);
      if (!this.send(Kind.heartbeat, data)) this.reset();
    }
  }
  receive(bytes: Uint8Array) {
    this.decoder.feed(bytes, (frame) => this.accept(frame));
  }
  private accept({ kind, data }: Frame) {
    const tick = this.io.monotonic(),
      now = this.io.now();
    if (
      kind === Kind.challenge &&
      data.length === 14 &&
      !this.active &&
      tick - this.probeAt < 1000
    ) {
      if (
        !data.readUInt32LE(0) ||
        !data.readUInt32LE(4) ||
        data[12] !== this.io.sensors ||
        data[13] !== this.io.display
      )
        return;
      this.session = Buffer.concat([data.subarray(0, 8), this.nonce]);
      if (
        !this.send(
          Kind.start,
          Buffer.concat([this.session, data.subarray(8, 12)]),
        )
      )
        this.reset();
      return;
    }
    if (
      !this.session ||
      data.length < 24 ||
      !data.subarray(0, 24).equals(this.session)
    )
      return;
    if (
      kind === Kind.ready &&
      data.length === 30 &&
      !this.active &&
      tick - this.probeAt < 1000 &&
      data[28] === this.io.sensors &&
      data[29] === this.io.display
    ) {
      this.anchorTick = data.readUInt32LE(24);
      this.anchorUtc = now;
      this.anchorMono = tick;
      this.uncertainty = Math.ceil(tick - this.probeAt) + 10;
      this.acknowledgedHeartbeat =
        this.heartbeatSequence =
        this.sequence =
        this.sampleSequence =
          0;
      this.active = true;
      this.startedAt = this.heardAt = tick;
      this.sentAt = -Infinity;
      this.io.state(true);
      return;
    }
    if (!this.active) return;
    if (
      kind === Kind.heartbeat &&
      data.length === 32 &&
      data.readUInt32LE(24) === this.heartbeatSequence &&
      data.readUInt32LE(24) > this.acknowledgedHeartbeat &&
      (data.readUInt32LE(28) - this.anchorTick) >>> 0 <=
        tick - this.anchorMono + this.uncertainty
    ) {
      this.acknowledgedHeartbeat = data.readUInt32LE(24);
      this.heardAt = tick;
      return;
    }
    if (kind === Kind.sample && data.length === 38) {
      const seq = data.readUInt32LE(24),
        delta = (data.readUInt32LE(28) - this.anchorTick) >>> 0;
      const sampledAt = this.anchorUtc - this.uncertainty + delta;
      if (
        !seq ||
        seq <= this.sampleSequence ||
        delta > tick - this.anchorMono + this.uncertainty ||
        now - sampledAt >= 60000 ||
        sampledAt > now
      )
        return;
      this.sampleSequence = seq;
      this.heardAt = tick;
      this.io.sample({
        sequence: seq,
        sampledAt,
        temperature: { state: data[32]!, value: data.readInt16LE(33) / 100 },
        humidity: { state: data[35]!, value: data.readInt16LE(36) / 100 },
      });
    }
    if (
      kind === Kind.result &&
      data.length === 33 &&
      this.pending &&
      data.readUInt32LE(24) === this.pending.sequence &&
      data[32]! <= 4
    ) {
      const elapsed = (data.readUInt32LE(28) - this.anchorTick) >>> 0;
      if (elapsed > tick - this.anchorMono + this.uncertainty) return;
      const status =
        data[32] === 0
          ? "succeeded"
          : data[32] === 2
            ? "expired"
            : data[32] === 4
              ? "unknown"
              : "failed";
      this.heardAt = tick;
      this.pending.settle({
        status: now >= this.pending.expires ? "unknown" : status,
        completedAt: now,
        ...(data[32] === 3
          ? { reason: "unsupported_capability" as const }
          : {}),
      });
      this.pending = undefined;
    }
  }
  command(
    action: DeviceCommand["action"],
    expires: number,
  ): Promise<LocalResult> {
    const now = this.io.now(),
      remaining = expires - this.anchorUtc - this.uncertainty;
    if (
      !this.active ||
      !this.session ||
      this.pending ||
      this.sequence === 0xffffffff ||
      expires - now <= this.uncertainty ||
      expires - now > 15000
    )
      return Promise.resolve({ status: "expired", completedAt: now });
    if (
      Math.abs(now - (this.anchorUtc + this.io.monotonic() - this.anchorMono)) >
      1000
    ) {
      this.reset();
      return Promise.resolve({ status: "expired", completedAt: now });
    }
    const text =
      action.kind === "display.write"
        ? Buffer.from(action.text, "utf8")
        : Buffer.alloc(0);
    if (
      text.length > this.io.display ||
      [...text].some((b) => b < 32 || b > 126)
    )
      return Promise.resolve({
        status: "failed",
        reason: "unsupported_capability",
        completedAt: now,
      });
    const data = Buffer.alloc(34 + text.length);
    this.session.copy(data);
    data.writeUInt32LE(++this.sequence, 24);
    data.writeUInt32LE((this.anchorTick + Math.floor(remaining)) >>> 0, 28);
    data[32] = action.kind === "display.write" ? 1 : 0;
    data[33] = text.length;
    text.copy(data, 34);
    return new Promise((resolve) => {
      this.pending = { sequence: this.sequence, expires, settle: resolve };
      if (!this.send(Kind.command, data)) {
        this.pending = undefined;
        resolve({ status: "unknown", completedAt: now });
        this.reset();
      }
    });
  }
}
