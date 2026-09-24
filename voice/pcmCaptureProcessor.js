const TARGET_SAMPLE_RATE = 16000;
const OUTPUT_BATCH_SAMPLES = 2048;

class JarvisPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sampleSum = 0;
    this.sampleCount = 0;
    this.output = new Int16Array(OUTPUT_BATCH_SAMPLES);
    this.outputLength = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'flush') this.flush();
    };
  }

  appendSample(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcm = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    this.output[this.outputLength] = pcm;
    this.outputLength += 1;
    if (this.outputLength === this.output.length) this.emitFullBatch();
  }

  emitFullBatch() {
    const buffer = this.output.buffer;
    this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
    this.output = new Int16Array(OUTPUT_BATCH_SAMPLES);
    this.outputLength = 0;
  }

  flush() {
    if (this.sampleCount > 0) {
      this.appendSample(this.sampleSum / this.sampleCount);
      this.sampleSum = 0;
      this.sampleCount = 0;
      this.phase = 0;
    }
    if (this.outputLength === 0) return;
    const buffer = this.output.buffer.slice(0, this.outputLength * Int16Array.BYTES_PER_ELEMENT);
    this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
    this.output = new Int16Array(OUTPUT_BATCH_SAMPLES);
    this.outputLength = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let index = 0; index < input.length; index += 1) {
      this.sampleSum += input[index];
      this.sampleCount += 1;
      this.phase += TARGET_SAMPLE_RATE;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.appendSample(this.sampleSum / this.sampleCount);
        this.sampleSum = 0;
        this.sampleCount = 0;
      }
    }
    return true;
  }
}

registerProcessor('jarvis-pcm-capture', JarvisPcmCaptureProcessor);
