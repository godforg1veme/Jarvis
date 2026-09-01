const assert = require('assert');
const {
  GeminiVoiceAdvisor,
  normalizeAdvisorResponse,
  pcmToWavBase64,
  MIN_REQUEST_INTERVAL_MS,
} = require('../tools/geminiVoiceAdvisor');
const { getSttSettings } = require('../voice/sttSettings');

const settings = getSttSettings();
const normalized = normalizeAdvisorResponse({
  settings: {
    fasterWhisper: {
      performanceProfile: 'custom',
      startRms: 0.018,
      continueRms: 0.009,
      silenceMs: 1100,
    },
  },
  confidence: 0.84,
  explanation: 'Фон заметный, порог продолжения снижен.',
}, settings);

assert.strictEqual(normalized.ok, true);
assert.strictEqual(normalized.candidate.fasterWhisper.startRms, 0.018);
assert.strictEqual(normalized.candidate.fasterWhisper.continueRms, 0.009);
assert.strictEqual(normalized.confidence, 0.84);
assert.throws(() => normalizeAdvisorResponse({ settings: {} }, settings), /no allowed/i);

const wav = Buffer.from(pcmToWavBase64(Buffer.alloc(3200)), 'base64');
assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');

const advisor = new GeminiVoiceAdvisor({ apiKeyResolver: () => '' });
advisor.analyze({ settings, summary: {} }).then((result) => {
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'api-key-missing');
  assert(MIN_REQUEST_INTERVAL_MS >= 1000);
  console.log('[test] Gemini Voice Advisor validation and no-key behavior OK');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
