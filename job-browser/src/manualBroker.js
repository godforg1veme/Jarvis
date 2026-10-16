const http = require('node:http');
const net = require('node:net');
const { createHash, timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { UUID } = require('./rpcProtocol');
const { fail } = require('./manualState');
function createManualBroker({ coordinator, ownerId, token, run = (fn) => fn(), vncPort = 5900 }) {
  if (!UUID.test(ownerId || '') || !/^[\x21-\x7e]{32,256}$/.test(token || '')
    || !Number.isInteger(vncPort) || vncPort < 1 || vncPort > 65535) throw fail('JOB_MANUAL_CONFIG_INVALID');
  const digest = (s) => createHash('sha256').update(s).digest(), expected = digest(`Bearer ${token}`);
  const unique = (req, name) => req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length === 1;
  const auth = (req) => unique(req, 'x-jarvis-owner-id') && unique(req, 'authorization') && req.headers['x-jarvis-owner-id'] === ownerId
    && timingSafeEqual(expected, digest(typeof req.headers.authorization === 'string' ? req.headers.authorization : ''));
  const reply = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  let active = 0;
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    if (!auth(req)) { req.resume(); return reply(res, 403, { ok: false, code: 'JOB_MANUAL_ACCESS_DENIED' }); }
    if (req.method === 'GET' && req.url === '/status') return reply(res, 200, { ok: true, value: coordinator.status() });
    if (req.method !== 'POST' || !['/start', '/finish'].includes(req.url) || req.headers['content-type'] !== 'application/json') {
      req.resume(); return reply(res, 400, { ok: false, code: 'JOB_MANUAL_INVALID_REQUEST' });
    }
    if (active >= 2) { req.resume(); return reply(res, 429, { ok: false, code: 'JOB_MANUAL_BUSY' }); }
    active++;
    try {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 4096) { req.resume(); return reply(res, 413, { ok: false, code: 'JOB_MANUAL_INVALID_REQUEST' }); } chunks.push(c); }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!/^\s*\{\s*"revision"\s*:\s*(0|[1-9][0-9]*)\s*\}\s*$/.test(raw)) throw fail();
      const input = JSON.parse(raw);
      if (!input || Array.isArray(input) || Object.keys(input).length !== 1
        || !Object.hasOwn(input, 'revision') || !Number.isSafeInteger(input.revision) || input.revision < 0) throw fail();
      const value = await run(() => req.url === '/start' ? coordinator.start(input.revision) : coordinator.finish(input.revision));
      reply(res, 200, { ok: true, value });
    } catch (e) {
      reply(res, 409, { ok: false, code: e.code === 'JOB_MANUAL_REVISION_CONFLICT' ? e.code : 'JOB_MANUAL_INVALID_REQUEST' });
    } finally { active--; }
  });
  server.maxConnections = 16;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false,
    handleProtocols: (protocols) => protocols.has('binary') ? 'binary' : false });
  server.on('upgrade', (req, socket, head) => {
    let revision = null;
    try {
      const u = new URL(req.url, 'http://manual.invalid');
      if (u.pathname === '/transport' && u.searchParams.size === 1 && /^\d{1,15}$/.test(u.searchParams.get('revision') || '')) revision = Number(u.searchParams.get('revision'));
    } catch {}
    const status = coordinator.status();
    if (!auth(req) || status.phase !== 'active' || status.revision !== revision || wss.clients.size >= 1) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.manualRevision = revision;
      const upstream = net.createConnection({ host: '127.0.0.1', port: vncPort });
      const end = () => { upstream.destroy(); if (ws.readyState === WebSocket.OPEN) ws.close(1008, 'MANUAL_TRANSPORT_CLOSED'); };
      ws.on('message', (data, binary) => {
        if (!binary || upstream.writableLength > 1048576 || coordinator.status().phase !== 'active'
          || coordinator.status().revision !== revision) return end();
        upstream.write(data);
      });
      upstream.on('data', (data) => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 2097152) return end();
        ws.send(data, { binary: true });
      });
      upstream.on('error', end); upstream.on('close', end); ws.on('error', end); ws.on('close', end);
    });
  });
  const unsubscribe = coordinator.subscribe((status) => {
    for (const ws of wss.clients) if (status.phase !== 'active' || ws.manualRevision !== status.revision) ws.close(1008, 'MANUAL_TRANSPORT_CLOSED');
  });
  server.closeManualTransports = () => { for (const ws of wss.clients) ws.terminate(); };
  server.on('close', () => { unsubscribe(); for (const ws of wss.clients) ws.terminate(); wss.close(); });
  return server;
}
module.exports = { createManualBroker };
