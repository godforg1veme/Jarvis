const assert = require('node:assert/strict');
const test = require('node:test');
const { CloudVoiceService, containsWakeWord, normalizeSpeech, pcmRms } = require('./cloudVoiceService');

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

test('cloud voice transcribes first, routes once, and speaks only the final routed answer', async () => {
  const calls = [];
  let response;
  const service = new CloudVoiceService({
    electron: { BrowserWindow: class {}, ipcMain: {} },
    cloudClient: {
      async transcribeVoice() { calls.push('transcribe'); return { ok: true, transcript: 'посмотри в камеру' }; },
      async sendVoice() { calls.push('legacy-answer'); throw new Error('must not call'); },
    },
    ttsService: { async speak(text) { calls.push(`speak:${text}`); } },
    wakeWordHost: { start: async () => {}, stop() {}, sendPcm() {} },
    onTranscript: async (text) => { calls.push(`route:${text}`); return {
      answer: 'Вижу стол.', clientMessageId: 'message-fixture', confirmation: { commandId: 'command-fixture' },
    }; },
    onResponse: (value) => { response = value; },
    settings: {},
  });
  service.utteranceChunks = [Buffer.alloc(320)];
  service.utteranceBytes = 320;
  await service._finishUtterance();
  assert.deepEqual(calls, ['transcribe', 'route:посмотри в камеру', 'speak:Вижу стол.']);
  assert.equal(response.answer, 'Вижу стол.');
  assert.equal(response.clientMessageId, 'message-fixture');
  assert.equal(response.confirmation.commandId, 'command-fixture');
});

test('unknown routed voice outcome is described as a send uncertainty', async () => {
  const statuses = [];
  const service = new CloudVoiceService({
    electron: { BrowserWindow: class {}, ipcMain: {} },
    cloudClient: { async transcribeVoice() { return { transcript: 'привет' }; } },
    wakeWordHost: { start: async () => {}, stop() {}, sendPcm() {} },
    onTranscript: async () => { throw Object.assign(new Error('private transport detail'), { outcome: 'unknown' }); },
    onStatus: (status) => statuses.push(status), settings: {},
  });
  service.utteranceChunks = [Buffer.alloc(320)];
  service.utteranceBytes = 320;
  await service._finishUtterance();
  assert.match(statuses.find((status) => status.type === 'error').message, /Проверьте результат отправки/);
  assert.equal(JSON.stringify(statuses).includes('private transport detail'), false);
});
