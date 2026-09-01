const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function pcm16ToWav(pcm) {
  const samples = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  if (samples.length === 0 || samples.length % 2 !== 0) throw new Error('PCM payload is invalid');
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

module.exports = { BITS_PER_SAMPLE, CHANNELS, SAMPLE_RATE, pcm16ToWav };
