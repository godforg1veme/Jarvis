const assert = require('node:assert/strict');
const test = require('node:test');
const { pcm16ToWav } = require('./pcmWav');

test('PCM is wrapped into a mono 16 kHz WAV without writing an audio file', () => {
  const wav = pcm16ToWav(Buffer.from([0, 0, 4, 0]));
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 4);
});
