/** Streaming 24 kHz PCM16LE -> 16 kHz PCM16LE. A 31-tap low-pass FIR precedes
 * rational (3:2) interpolation; filter history and phase survive provider chunks.
 * About 0.63 ms filter delay; final protocol frame is zero padded to 20 ms. */
export class OpenHuliPcmOutput {
  private history = new Float64Array(31);
  private count = 0;
  private previous = 0;
  private next = 0;
  private frame = new Uint8Array(640);
  private used = 0;
  private ended = false;
  private readonly taps = (() => {
    const values = Array.from({ length: 31 }, (_, i) => {
      const x = i - 15;
      const cutoff = 7000 / 24000;
      return (
        (x === 0
          ? 2 * cutoff
          : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)) *
        (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / 30))
      );
    });
    const sum = values.reduce((a, b) => a + b, 0);
    return values.map((value) => value / sum);
  })();
  push(pcm: Uint8Array): Uint8Array[] {
    if (this.ended || pcm.length % 2 || pcm.length > 49152)
      throw new Error("Invalid provider PCM chunk");
    const frames: Uint8Array[] = [];
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let offset = 0; offset < pcm.length; offset += 2) {
      this.history[this.count % 31] = view.getInt16(offset, true);
      let filtered = 0;
      for (let tap = 0; tap < 31; tap++)
        filtered +=
          this.taps[tap]! * this.history[(this.count - tap + 31) % 31]!;
      if (this.next <= this.count) {
        const weight = this.count - this.next;
        const sample = Math.max(
          -32768,
          Math.min(
            32767,
            Math.round(filtered * (1 - weight) + this.previous * weight),
          ),
        );
        new DataView(this.frame.buffer).setInt16(this.used, sample, true);
        this.used += 2;
        this.next += 1.5;
        if (this.used === 640) {
          frames.push(this.frame);
          this.frame = new Uint8Array(640);
          this.used = 0;
        }
      }
      this.previous = filtered;
      this.count++;
      if (this.count > 720000)
        throw new Error("Provider audio exceeds 30 seconds");
    }
    return frames;
  }
  finish(): Uint8Array[] {
    if (this.ended) throw new Error("PCM stream already finished");
    this.ended = true;
    return this.used ? [this.frame] : [];
  }
}
