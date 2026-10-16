'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { WebSocketServer, WebSocket } = require('ws');
const { createManualGateway } = require('../src/server');
const { createBrowserClient } = require('../src/browserClient');
const ORIGIN = 'https://jarvis.test.ts.net';
async function fixture(t, options = {}) {
  const token = randomBytes(32).toString('hex'), ownerId = randomUUID();
  let state = { phase: 'pending', revision: 1 }, failFinish = false;
  const calls = [], upgrades = [];
  const broker = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`); assert.equal(req.headers['x-jarvis-owner-id'], ownerId);
    calls.push(req.url); let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/start' && JSON.parse(body).revision !== state.revision) { res.writeHead(409); res.end(JSON.stringify({ ok: false, code: 'JOB_HH_MANUAL_STALE' })); return; }
    if (req.url === '/start') { assert.deepEqual(JSON.parse(body), { revision: state.revision }); state = { phase: 'active', revision: state.revision + 1 }; }
    if (req.url === '/finish') state = { phase: failFinish ? 'active' : 'idle', revision: state.revision + 1 };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value: state }));
  });
  const bwss = new WebSocketServer({ noServer: true });
  broker.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`); assert.equal(req.headers['x-jarvis-owner-id'], ownerId);
    upgrades.push(req.url);
    bwss.handleUpgrade(req, socket, head, ws => { ws.send(Buffer.from('RFB fixture')); ws.on('message', data => ws.send(data)); });
  });
  await new Promise(r => broker.listen(0, '127.0.0.1', r));
  const gateway = createManualGateway({ origin: ORIGIN, ownerLogin: 'owner@example.test', ownerId, token,
    brokerUrl: `http://127.0.0.1:${broker.address().port}`, testAllowLoopback: true, ...options });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r));
  t.after(async () => { gateway.disconnectTransport(); for (const ws of bwss.clients) ws.terminate(); await Promise.all([new Promise(r => gateway.close(r)), new Promise(r => broker.close(r))]); });
  let cookie, csrf;
  function request(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: gateway.address().port, path: url, method,
        headers: { Host: new URL(ORIGIN).host, 'Tailscale-User-Login': 'owner@example.test', ...(cookie ? { cookie } : {}),
          ...(data === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }), ...headers } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
      }); req.on('error', reject); req.end(data);
    });
  }
  async function login() { const result = await request('/hh/'); cookie = result.headers['set-cookie'][0].split(';')[0]; const s = await request('/hh/api/status'); csrf = s.json().csrf; return result; }
  const control = (action, revision) => request(`/hh/api/${action}`, { method: 'POST', headers: { Origin: ORIGIN, 'x-csrf-token': csrf }, body: { revision } });
  function ws(extra = {}, suffix = `?revision=${state.revision}`, clientOptions = {}) {
    return new WebSocket(`ws://127.0.0.1:${gateway.address().port}/hh/transport${suffix}`, 'binary', {
      headers: { Host: new URL(ORIGIN).host, Origin: ORIGIN, 'Tailscale-User-Login': 'owner@example.test', cookie, ...extra }, perMessageDeflate: false, ...clientOptions });
  }
  return { request, login, control, ws, calls, upgrades, token, ownerId, setState: value => { state = value; }, failFinish: () => { failFinish = true; } };
}
test('rejects untrusted owner, host, origin, assets and upgrades before broker access', async t => {
  const f = await fixture(t);
  for (const headers of [{ 'Tailscale-User-Login': '' }, { 'Tailscale-User-Login': 'foreign@example.test' }, { Host: 'foreign.ts.net' }, { Origin: 'https://evil.test' }]) {
    assert.equal((await f.request('/hh/', { headers })).status, 403);
    assert.equal((await f.request('/hh/novnc/core/rfb.js', { headers })).status, 403);
  }
  assert.equal((await f.request('/hh/app.js')).status, 403); assert.equal(f.calls.length, 0);
  await f.login(); const ws = f.ws({ 'Tailscale-User-Login': 'foreign@example.test' }); ws.on('error', () => {});
  const [, response] = await once(ws, 'unexpected-response'); assert.equal(response.statusCode, 403); ws.terminate();
  assert.equal(f.upgrades.length, 0);
});
test('GET has no state effects; cookie, CSRF and exact revision grammar protect POST', async t => {
  const f = await fixture(t); const page = await f.login();
  assert.match(page.headers['set-cookie'][0], /Secure; HttpOnly; SameSite=Strict; Path=\/hh$/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(page.headers['content-security-policy'], /connect-src 'self' wss:\/\/jarvis\.test\.ts\.net/);
  for (const route of ['/hh/', '/hh/app.js', '/hh/style.css', '/hh/novnc/core/rfb.js']) assert.equal((await f.request(route)).status, 200);
  assert.equal(f.calls.filter(v => v !== '/status').length, 0);
  for (const body of ['{"revision":1,"revision":1}', '{"revision":1,"url":"http://evil"}', '{"revision":-1}', '{"revision":1.0}', 'x'.repeat(4097)]) {
    assert.equal((await f.request('/hh/api/start', { method: 'POST', headers: { Origin: ORIGIN, 'x-csrf-token': (await f.request('/hh/api/status')).json().csrf }, body })).status, 400);
  }
  assert.equal((await f.request('/hh/api/start', { method: 'POST', body: { revision: 1 } })).status, 403);
  assert.equal((await f.request('/hh/api/start', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: { revision: 1 } })).status, 403);
  assert.equal(f.calls.filter(v => v !== '/status').length, 0);
  const started = await f.control('start', 1); assert.deepEqual(started.json().value, { phase: 'active', revision: 2 });
  assert.equal(started.text.includes(f.token), false); assert.equal(started.text.includes(f.ownerId), false);
  for (const route of ['/hh/novnc/core/../package.json', '/hh/novnc/%2e%2e/package.json', '/hh/app.js?url=http://evil', '/hh/api/status?x=1']) assert.equal((await f.request(route)).status, 404);
});
test('transport requires active matching revision; binary only, finish closes input and failed finish reconnects', async t => {
  const f = await fixture(t); await f.login(); await f.control('start', 1);
  const ws = f.ws(); const first = once(ws, 'message'); await once(ws, 'open'); assert.equal((await first)[0].toString(), 'RFB fixture');
  const echo = once(ws, 'message'); ws.send(Buffer.from('key events')); assert.equal((await echo)[0].toString(), 'key events');
  const closed = once(ws, 'close'); f.failFinish(); assert.equal((await f.control('finish', 2)).json().value.phase, 'active'); await closed;
  const reconnected = f.ws(); const welcome = once(reconnected, 'message'); await once(reconnected, 'open'); await welcome;
  const invalidated = once(reconnected, 'close'); f.setState({ phase: 'checking', revision: 4 }); await invalidated;
  assert.equal(f.upgrades.length, 2);
});
test('broker configuration cannot become arbitrary proxy', () => {
  const common = { ownerId: randomUUID(), token: randomBytes(32).toString('hex') };
  for (const brokerUrl of ['http://evil.test:8082', 'https://job-browser:8082', 'http://job-browser:8082/path', 'http://127.0.0.1:8082']) assert.throws(() => createBrowserClient({ ...common, brokerUrl }));
});
async function rejected(ws) {
  ws.on('error', () => {});
  const [, response] = await once(ws, 'unexpected-response');
  assert.equal(response.statusCode, 403); ws.terminate();
}
test('WS rejects pending, stale revision, missing session, cross-origin and secret query alternatives', async t => {
  const f = await fixture(t); await f.login();
  await rejected(f.ws()); await f.control('start', 1);
  await rejected(f.ws({}, '?revision=1'));
  await rejected(f.ws({ Cookie: '' }));
  await rejected(f.ws({ Origin: 'https://evil.test' }));
  await rejected(f.ws({}, '?revision=2&token=forbidden'));
  await rejected(f.ws({}, '?revision=9007199254740992'));
  assert.equal(f.upgrades.length, 0);
  assert.equal((await f.control('start', 1)).json().code, 'JOB_HH_MANUAL_STALE');
});
test('only one WS transport exists, and text or oversized payload disconnects it', async t => {
  const f = await fixture(t); await f.login(); await f.control('start', 1);
  const first = f.ws(); const firstWelcome = once(first, 'message'); await once(first, 'open'); await firstWelcome;
  await rejected(f.ws()); const closed = once(first, 'close'); first.send('clipboard text'); await closed;
  const second = f.ws(); const secondWelcome = once(second, 'message'); await once(second, 'open'); await secondWelcome;
  const tooLarge = once(second, 'close'); second.send(Buffer.alloc(65537)); await tooLarge;
  assert.equal(f.upgrades.length, 2);
});
test('session count, duplicate cookies, controls and static query abuse stay bounded', async t => {
  const f = await fixture(t); const page = await f.login(); const cookie = page.headers['set-cookie'][0].split(';')[0];
  assert.equal((await f.request('/hh/api/status', { headers: { cookie: `${cookie}; ${cookie}` } })).status, 403);
  for (let i = 0; i < 12; i++) assert.equal((await f.control('start', 0)).status, 409);
  assert.equal((await f.control('start', 0)).status, 429);
  for (let i = 0; i < 8; i++) assert.equal((await f.request('/hh/', { headers: { cookie: '' } })).status, 200);
  assert.equal((await f.request('/hh/api/status', { headers: { cookie } })).status, 403);
  for (let i = 0; i < 23; i++) assert.equal((await f.request('/hh/', { headers: { cookie: '' } })).status, 200);
  assert.equal((await f.request('/hh/', { headers: { cookie: '' } })).status, 429);
});
test('evicting an old authenticated cookie closes its transport while manual state remains active', async t => {
  const f = await fixture(t); await f.login(); await f.control('start', 1);
  const transport = f.ws(); const welcome = once(transport, 'message'); await once(transport, 'open'); await welcome;
  const closed = once(transport, 'close');
  for (let i = 0; i < 8; i++) assert.equal((await f.request('/hh/', { headers: { cookie: '' } })).status, 200);
  await closed;
  await f.login(); assert.equal((await f.request('/hh/api/status')).json().value.phase, 'active');
  const resumed = f.ws(); const resumedWelcome = once(resumed, 'message'); await once(resumed, 'open'); await resumedWelcome;
  resumed.close();
  assert.equal(f.calls.filter(v => v === '/finish').length, 0);
});
test('wire client uses bounded 60-second mutations and five-second status timeout', async t => {
  const original = http.request; const timeouts = [];
  t.mock.method(http, 'request', function (...args) {
    if (args[0] instanceof URL && args[1]?.headers?.authorization) timeouts.push([args[0].pathname, args[1].timeout]);
    return original.apply(this, args);
  });
  const f = await fixture(t); await f.login(); await f.control('start', 1); await f.control('finish', 2);
  assert.deepEqual(timeouts, [['/status', 5000], ['/start', 60000], ['/finish', 60000]]);
});
test('lost-phone heartbeat releases transport without confirming or expiring manual state', async t => {
  const f = await fixture(t, { testPingIntervalMs: 30 }); await f.login(); await f.control('start', 1);
  const lost = f.ws({}, '?revision=2', { autoPong: false });
  const welcome = once(lost, 'message'); await once(lost, 'open'); await welcome;
  await once(lost, 'close');
  assert.equal((await f.request('/hh/api/status')).json().value.phase, 'active');
  assert.equal(f.calls.filter(v => v === '/finish').length, 0);
  const resumed = f.ws(); const next = once(resumed, 'message'); await once(resumed, 'open'); await next; resumed.close();
});
