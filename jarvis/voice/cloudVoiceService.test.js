const assert = require('node:assert/strict');
const test = require('node:test');
const { containsWakeWord, normalizeSpeech, pcmRms } = require('./cloudVoiceService');

test('cloud voice wake detector recognizes supported Jarvis aliases locally', () => {
  assert.equal(containsWakeWord('Джарвис, какая погода?'), true);
  assert.equal(containsWakeWord('ярвис'), true);
  assert.equal(containsWakeWord('обычный разговор'), false);
  assert.equal(normalizeSpeech('ДжАрвис!').includes('джарвис'), true);
});

test('cloud voice RMS stays bounded for PCM16 input', () => {
  assert.equal(pcmRms(Buffer.from([0, 0, 0, 0])), 0);
  const loud = Buffer.alloc(4);
  loud.writeInt16LE(16384, 0);
  loud.writeInt16LE(-16384, 2);
  assert.ok(pcmRms(loud) > 0.45 && pcmRms(loud) < 0.55);
});
