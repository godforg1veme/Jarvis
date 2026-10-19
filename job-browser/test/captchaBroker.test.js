const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID, randomBytes } = require('node:crypto');
const { createCaptchaBroker } = require('../src/captchaBroker');
const { normalizeAnswer, parseClosedJson } = require('../src/captchaTelegramProtocol');
test('human text normalization is narrow and invalid text cannot become a model/shell command', () => {
  assert.equal(normalizeAnswer('  ПРОВЕРКА   Картинки  '), 'проверка картинки');
  for (const text of ['', 'test answer', 'проверка', 'проверка картинки третье', 'проверка\nкартинки', 'проверка картинки;']) assert.equal(normalizeAnswer(text), null);
  for (const text of ['{"operation":"status","operation":"answer","args":{}}', '{"args":{"revision":1,"revision":2}}', '{"a":1,"\\u0061":2}', '{"a":[]}', '{"a":true} trailing']) assert.throws(() => parseClosedJson(text));
});
test('private broker validates owner/auth/duplicate headers/JSON/body/operations before effects and sanitizes errors', async t => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), calls = [];
  const server = createCaptchaBroker({ ownerId, token, coordinator: { status: () => ({ phase: 'pending', revision: 1 }) },
    controller: { challenge: async refresh => { calls.push(refresh); if (refresh) throw new Error('private failure'); return { outcome: 'idle' }; }, answer: async () => ({ outcome: 'invalid' }) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (body, headers = {}, route = '/rpc', method = 'POST') => new Promise((resolve, reject) => {
    const bytes = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { authorization: `Bearer ${token}`, 'x-jarvis-owner-id': ownerId, 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes), ...headers } }, res => {
      let raw = ''; res.on('data', chunk => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, raw, value: JSON.parse(raw) }));
    }); req.on('error', reject); req.end(bytes);
  });
  const status = { userId: ownerId, operation: 'status', args: {} };
  for (const headers of [{ authorization: 'Bearer foreign' }, { 'x-jarvis-owner-id': randomUUID() }, { authorization: [`Bearer ${token}`, `Bearer ${token}`] }]) assert.equal((await request(status, headers)).status, 403);
  for (const body of [{ ...status, target: 'https://hh.ru' }, { userId: ownerId, operation: 'challenge', args: { refresh: 1 } }, { userId: ownerId, operation: 'answer', args: {} }, '{"operation":"status","operation":"status","args":{}}', 'x'.repeat(8193)]) assert.notEqual((await request(body)).status, 200);
  assert.equal((await request(status, {}, '/status', 'GET')).status, 400);
  assert.equal((await request(status, { 'content-encoding': 'gzip' })).status, 400);
  assert.deepEqual(calls, []);
  assert.deepEqual((await request(status)).value, { ok: true, value: { phase: 'pending', revision: 1 } });
  assert.deepEqual((await request({ userId: ownerId, operation: 'challenge', args: { refresh: false } })).value, { ok: true, value: { outcome: 'idle' } });
  const failed = await request({ userId: ownerId, operation: 'challenge', args: { refresh: true } });
  assert.deepEqual(failed.value, { ok: false, code: 'JOB_CAPTCHA_UNAVAILABLE' }); assert.equal(failed.raw.includes('private failure'), false);
});
