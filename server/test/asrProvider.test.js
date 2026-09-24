const assert = require('node:assert/strict');
const test = require('node:test');
const { OpenAiCompatibleAsrProvider, fileNameForMimeType } = require('../src/asr/asrProvider');

test('names OGG/Opus multipart uploads safely for the private ASR worker', async () => {
  let request;
  const provider = new OpenAiCompatibleAsrProvider({
    baseUrl: 'http://gigaam-asr:8000/v1',
    model: 'GigaAM/v3_e2e_rnnt',
    async fetch(url, init) {
      request = { url, ...init };
      return new Response(JSON.stringify({ text: 'проверка', language: 'ru', duration: 1.2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const transcription = await provider.transcribe({
    audio: Buffer.from('ogg-bytes'), mimeType: 'audio/ogg', languageHint: 'ru',
  });
  assert.equal(request.url, 'http://gigaam-asr:8000/v1/audio/transcriptions');
  assert.equal(request.body.get('file').name, 'utterance.ogg');
  assert.equal(request.body.get('file').type, 'audio/ogg');
  assert.equal(request.body.get('model'), 'GigaAM/v3_e2e_rnnt');
  assert.equal(transcription.text, 'проверка');
  assert.equal(transcription.durationMs, 1200);
});

test('uses WAV naming for the existing Desktop formats', () => {
  assert.equal(fileNameForMimeType('audio/wav'), 'utterance.wav');
  assert.equal(fileNameForMimeType('audio/x-wav; charset=binary'), 'utterance.wav');
  assert.equal(fileNameForMimeType('application/octet-stream'), 'utterance.wav');
});
