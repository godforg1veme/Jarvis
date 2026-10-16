const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { WebSocket } = require('ws');
const { createManualBroker } = require('../src/manualBroker');
test('real manual broker: separate credential/owner, closed controls and single revision-bound VNC transport', async () => {
  const ownerId = randomUUID(), token = 'fixture-manual-broker-token-'.repeat(2);
  let state = { phase: 'pending', revision: 1 }, starts = 0, tcpConnections = 0;
  const listeners = new Set();
  const coordinator = { status: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    start: async () => { starts++; state = { phase: 'active', revision: 2 }; return state; }, finish: async () => state };
  const tcp = net.createServer((s) => { tcpConnections++; s.on('data', (d) => s.write(d)); });
  await new Promise((r) => tcp.listen(0, '127.0.0.1', r));
  const broker = createManualBroker({ coordinator, ownerId, token, vncPort: tcp.address().port });
  await new Promise((r) => broker.listen(0, '127.0.0.1', r));
  const port = broker.address().port, headers = { authorization: `Bearer ${token}`, 'x-jarvis-owner-id': ownerId };
  const request = (url, body, patch = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, 'content-type': 'application/json', ...patch } }, (res) => {
      let data = ''; res.on('data', (d) => { data += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }); req.on('error', reject); req.end(body);
  });
  try {
    assert.equal((await request('/status')).body.value.phase, 'pending'); assert.equal(starts, 0);
    for (const patch of [{ authorization: 'Bearer wrong' }, { 'x-jarvis-owner-id': randomUUID() }]) assert.equal((await request('/start', '{"revision":1}', patch)).status, 403);
    for (const body of ['{"revision":1,"revision":2}', '{"revision":1,"extra":true}', '{"revision":"1"}', '{"revision":-1}']) assert.equal((await request('/start', body)).status, 409);
    assert.equal(starts, 0); assert.equal((await request('/start', '{"revision":1}')).status, 200);
    const deny = new WebSocket(`ws://127.0.0.1:${port}/transport?revision=2`, 'binary', { headers: { ...headers, authorization: 'Bearer wrong' } });
    await once(deny, 'error'); assert.equal(tcpConnections, 0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/transport?revision=2`, 'binary', { headers }); await once(ws, 'open');
    const echoed = once(ws, 'message'); ws.send(Buffer.from('fixture'), { binary: true }); assert.equal((await echoed)[0].toString(), 'fixture');
    const duplicate = new WebSocket(`ws://127.0.0.1:${port}/transport?revision=2`, 'binary', { headers }); await once(duplicate, 'error'); assert.equal(tcpConnections, 1);
    const closed = once(ws, 'close'); state = { phase: 'checking', revision: 3 }; for (const fn of listeners) fn(state); await closed;
  } finally {
    broker.closeManualTransports(); broker.closeAllConnections(); await new Promise((r) => broker.close(r)); await new Promise((r) => tcp.close(r));
  }
});
