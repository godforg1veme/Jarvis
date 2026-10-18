const test = require('node:test'),
  assert = require('node:assert/strict');
const Fastify = require('fastify');
const { registerMiniAppRoutes } = require('../src/miniApp/routes');
test('API fails closed on foreign origin, missing cookie, CSRF and unsafe errors', async () => {
  const app = Fastify({ logger: false });
  registerMiniAppRoutes(app, {
    config: {
      miniAppPublicOrigin: 'https://jarvis.example',
      telegramBotToken: 'fixture',
    },
    pool: {
      async query() {
        throw Error('PRIVATE DATABASE DETAIL');
      },
    },
    accessService: {},
  });
  try {
    let r = await app.inject({
      method: 'POST',
      url: '/mini/api/session',
      headers: { origin: 'https://foreign.example' },
      payload: { initData: 'fake' },
    });
    assert.deepEqual(r.json(), { ok: false, code: 'invalid_origin' });
    r = await app.inject({ url: '/mini/api/me' });
    assert.equal(r.statusCode, 401);
    r = await app.inject({
      url: '/mini/api/me',
      headers: { cookie: `__Host-jarvis-mini=${'a'.repeat(64)}` },
    });
    assert.deepEqual(r.json(), { ok: false, code: 'unavailable' });
    assert.equal(r.body.includes('PRIVATE'), false);
    r = await app.inject({ url: '/mini/api/me?userId=forged' });
    assert.deepEqual(r.json(), { ok: false, code: 'invalid_request' });
    r = await app.inject({
      method: 'POST',
      url: '/mini/api/logout',
      headers: { origin: 'https://foreign.example' },
    });
    assert.equal(r.statusCode, 403);
  } finally {
    await app.close();
  }
});
