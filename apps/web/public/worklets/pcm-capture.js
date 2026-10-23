// Collects mono mic samples into ~85 ms blocks and posts them to the page.
// Conversion to 16 kHz PCM16 happens on the page (src/lib/live-audio.ts). Nothing is stored.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(1024, Math.round(sampleRate * 0.085));
    this.buf = new Float32Array(this.size);
    this.len = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const n = Math.min(channel.length - i, this.size - this.len);
      this.buf.set(channel.subarray(i, i + n), this.len);
      this.len += n;
      i += n;
      if (this.len === this.size) {
        const block = this.buf;
        this.port.postMessage(block, [block.buffer]);
        this.buf = new Float32Array(this.size);
        this.len = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
