const assert = require('node:assert/strict');
const test = require('node:test');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');
const { registerDesktopRoutes } = require('../src/desktop/desktopRoutes');
const { FixedWindowRateLimiter } = require('../src/http/rateLimiter');

function createApp(overrides = {}) {
  const app = buildApp({ config: loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' }) });
  const device = { id: 'device-a', user_id: 'user-a', name: 'Home PC', status: 'offline', capabilities: {} };
  const calls = [];
  registerDesktopRoutes(app, {
    authenticate: async (headers) => {
      if (headers.authorization !== 'Bearer valid') {
        const error = new Error('auth');
        error.statusCode = 401;
        error.publicCode = 'DEVICE_AUTH_REQUIRED';
        throw error;
      }
      return device;
    },
    deviceService: {
      async claimPairing({ code, capabilities }) {
        calls.push({ type: 'pair', code, capabilities });
        return code === 'JARVIS-ABCD-1234-ABCD-1234' ? { ...device, token: 'token-once' } : null;
      },
    },
    messageService: {
      async handle(input) {
        calls.push({ type: 'message', input });
        const resolved = await input.resolveContent();
        return { status: 'answered', answer: `answer:${resolved.content}`, ...(input.kind === 'voice' ? { transcript: resolved.content } : {}) };
      },
    },
    asr: {
      async transcribe() { return { text: 'голосовой текст', language: 'ru', durationMs: 500 }; },
    },
    limiter: overrides.limiter || new FixedWindowRateLimiter(),
  });
  return { app, calls };
}

test('Desktop pairing returns a one-time token only after a valid code', async () => {
  const { app } = createApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/desktop/pair',
    payload: { pairingCode: 'JARVIS-ABCD-1234-ABCD-1234', capabilities: { wakeWord: true } },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().token, 'token-once');
  await app.close();
});

test('Desktop text derives its owner from the device token and rejects missing auth', async () => {
  const { app, calls } = createApp();
  const denied = await app.inject({ method: 'POST', url: '/v1/desktop/messages', payload: { clientMessageId: 'a', text: 'hi' } });
  assert.equal(denied.statusCode, 401);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/desktop/messages',
    headers: { authorization: 'Bearer valid' },
    payload: { clientMessageId: 'message-a', text: 'Привет' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().answer, 'answer:Привет');
  assert.equal(calls.at(-1).input.device.user_id, 'user-a');
  await app.close();
});

test('Desktop voice accepts only bounded audio types and passes a completed utterance to ASR', async () => {
  const { app, calls } = createApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/desktop/voice',
    headers: {
      authorization: 'Bearer valid',
      'content-type': 'audio/wav',
      'x-jarvis-client-message-id': 'voice-a',
      'x-jarvis-audio-mime': 'audio/wav',
    },
    payload: Buffer.from([1, 2, 3, 4]),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().transcript, 'голосовой текст');
  assert.equal(calls.at(-1).input.kind, 'voice');
  await app.close();
});

test('Desktop can request ASR-only routing before selecting ordinary or visual handling', async () => {
  const { app } = createApp();
  const response = await app.inject({
    method: 'POST', url: '/v1/desktop/voice/transcribe',
    headers: { authorization: 'Bearer valid', 'content-type': 'audio/wav', 'x-jarvis-client-message-id': 'voice-route-a' },
    payload: Buffer.from([1, 2, 3, 4]),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().transcript, 'голосовой текст');
  assert.equal(response.json().answer, undefined);
  await app.close();
});
