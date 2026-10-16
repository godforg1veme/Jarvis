'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { createAccess, equal, single } = require('./access');
const { createBrowserClient } = require('./browserClient');
const PUBLIC = path.resolve(__dirname, '../public');
const NOVNC = path.resolve(__dirname, '../node_modules/@novnc/novnc');
const UNAVAILABLE = { ok: false, code: 'JOB_HH_MANUAL_UNAVAILABLE' };
function createManualGateway(options) {
  const access = createAccess({ ...options, onEvict: id => { if (transport?.sessionId === id) disconnect(); } });
  // Safari does not consistently map connect-src 'self' to the WSS scheme.
  const csp = `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${options.origin.replace('https:', 'wss:')}; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;
  const browserClient = createBrowserClient(options);
  let transport = null;
  let upgrading = false;
  let polling = false;
  let controlBusy = false;
  let creationTimes = [];
  const pingInterval = options.testAllowLoopback && Number.isInteger(options.testPingIntervalMs)
    && options.testPingIntervalMs >= 20 ? options.testPingIntervalMs : 10000;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 65536,
    handleProtocols: protocols => protocols.has('binary') ? 'binary' : false });
  function disconnect(force = false) {
    if (!transport) return;
    const current = transport; transport = null;
    clearInterval(current.timer);
    clearInterval(current.heartbeat);
    for (const ws of [current.client, current.upstream]) {
      if (force && ws.readyState !== WebSocket.CLOSED) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) ws.close(1000);
      else if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    }
  }
  function headers(res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), clipboard-read=(), clipboard-write=(), display-capture=()');
  }
  function json(res, status, value) { headers(res); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  function denied(res, status = 403) { json(res, status, { ok: false, code: 'JOB_HH_MANUAL_INVALID' }); }
  async function body(req) {
    if (single(req, 'content-type') !== 'application/json' || req.headers['content-encoding'] || req.headers['transfer-encoding']) throw new Error('invalid');
    const length = single(req, 'content-length');
    if (!length || !/^[0-9]{1,4}$/.test(length) || Number(length) > 4096) throw new Error('invalid');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error('invalid'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString('utf8');
    // This closed grammar also rejects duplicate JSON keys and integer coercion.
    if (!/^\s*\{\s*"revision"\s*:\s*(0|[1-9][0-9]*)\s*\}\s*$/.test(raw)) throw new Error('invalid');
    const value = JSON.parse(raw);
    if (!Number.isSafeInteger(value.revision)) throw new Error('invalid');
    return value;
  }
  async function staticFile(req, res) {
    const fixed = { '/hh/': 'index.html', '/hh/app.js': 'app.js', '/hh/input.js': 'input.js', '/hh/style.css': 'style.css' };
    let root = PUBLIC; let relative = fixed[req.url];
    if (!relative && /^\/hh\/novnc\/(core|vendor)\/[a-zA-Z0-9_./-]+\.js$/.test(req.url)) {
      root = NOVNC; relative = req.url.slice('/hh/novnc/'.length);
      if (relative.split('/').some(v => v === '.' || v === '..' || !v)) return denied(res, 404);
    }
    if (!relative) return denied(res, 404);
    const realRoot = await fs.realpath(root); const file = await fs.realpath(path.join(root, relative));
    if (!file.startsWith(realRoot + path.sep)) return denied(res, 404);
    const metadata = await fs.stat(file);
    if (!metadata.isFile() || metadata.size > 1024 * 1024) return denied(res, 404);
    const data = await fs.readFile(file);
    if (data.length > 1024 * 1024) return denied(res, 404);
    headers(res);
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(data);
  }
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000 }, (req, res) => {
    (async () => {
      if (!access.owner(req)) return denied(res);
      if (req.url.length > 512 || !req.url.startsWith('/hh/') || req.headers['sec-fetch-site'] === 'cross-site') return denied(res);
      if (req.headers.origin && !access.sameOrigin(req)) return denied(res);
      let session = access.session(req);
      if (!session && req.method === 'GET' && req.url === '/hh/') {
        const now = Date.now(); creationTimes = creationTimes.filter(t => now - t < 60000);
        if (creationTimes.length >= 32) return denied(res, 429);
        creationTimes.push(now); session = access.issue(res);
      }
      if (!session) return denied(res);
      if (!access.rate(session, 'requests', 240)) return denied(res, 429);
      if (req.method === 'GET' && req.url === '/hh/api/status') {
        const result = await browserClient.control('status');
        if (!result.ok || result.value.phase !== 'active' || (transport && transport.revision !== result.value.revision)) disconnect();
        return json(res, result.ok ? 200 : 503, result.ok ? { ...result, csrf: session.csrf } : result);
      }
      if (req.method === 'POST' && ['/hh/api/start', '/hh/api/finish'].includes(req.url)) {
        if (!access.sameOrigin(req) || !equal(single(req, 'x-csrf-token'), session.csrf)) return denied(res);
        if (!access.rate(session, 'controls', 12)) return denied(res, 429);
        let value; try { value = await body(req); } catch { return denied(res, 400); }
        if (controlBusy) return json(res, 409, { ok: false, code: 'JOB_HH_MANUAL_BUSY' });
        controlBusy = true;
        try {
          // Close input before finish is forwarded; a failed verification may reconnect explicitly.
          disconnect();
          const result = await browserClient.control(req.url.endsWith('/start') ? 'start' : 'finish', value.revision);
          return json(res, result.ok ? 200 : 409, result);
        } finally { controlBusy = false; }
      }
      if (req.method !== 'GET') return denied(res, 405);
      return staticFile(req, res);
    })().catch(() => { disconnect(); if (!res.headersSent) json(res, 503, UNAVAILABLE); else res.destroy(); });
  });
  server.on('upgrade', (req, socket, head) => {
    const reject = () => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
    (async () => {
      const session = access.session(req);
      if (!access.owner(req) || !access.sameOrigin(req) || !session || controlBusy || upgrading || transport
          || !/^\/hh\/transport\?revision=(0|[1-9][0-9]*)$/.test(req.url)
          || !access.rate(session, 'transports', 12)
          || (req.headers['sec-websocket-protocol'] && req.headers['sec-websocket-protocol'] !== 'binary')) return reject();
      const revision = Number(req.url.split('=')[1]); if (!Number.isSafeInteger(revision)) return reject();
      upgrading = true;
      try {
        const result = await browserClient.control('status');
        if (!result.ok || result.value.phase !== 'active' || result.value.revision !== revision || controlBusy || socket.destroyed) return reject();
        wss.handleUpgrade(req, socket, head, client => {
          const upstream = browserClient.transport(revision);
          transport = { client, upstream, revision, timer: null, sessionId: session.id };
          const current = transport;
          const closeCurrent = () => { if (transport === current) disconnect(); };
          const forward = (from, to, data, binary) => {
            if (!binary || data.length > 65536 || to.readyState !== WebSocket.OPEN || to.bufferedAmount + data.length > 262144) return closeCurrent();
            to.send(data, { binary: true }, error => { if (error) closeCurrent(); });
          };
          client.on('message', (data, binary) => forward(client, upstream, data, binary));
          upstream.on('message', (data, binary) => forward(upstream, client, data, binary));
          for (const ws of [client, upstream]) { ws.on('error', closeCurrent); ws.on('close', closeCurrent); }
          transport.timer = setInterval(async () => {
            if (polling) return; polling = true;
            try {
              const state = await browserClient.control('status');
              if (!state.ok || state.value.phase !== 'active' || state.value.revision !== revision) closeCurrent();
            } finally { polling = false; }
          }, 1000);
          transport.timer.unref();
          const alive = new Map([[client, true], [upstream, true]]);
          for (const ws of [client, upstream]) ws.on('pong', () => alive.set(ws, true));
          transport.heartbeat = setInterval(() => {
            if (transport !== current) return;
            if ([...alive.values()].some(value => !value)) return disconnect(true);
            for (const ws of [client, upstream]) {
              if (ws.readyState !== WebSocket.OPEN) return disconnect(true);
              alive.set(ws, false); ws.ping();
            }
          }, pingInterval);
          transport.heartbeat.unref();
        });
      } finally { upgrading = false; }
    })().catch(reject);
  });
  server.on('clientError', (_, socket) => { socket.destroy(); });
  server.on('close', disconnect);
  server.browserClient = browserClient;
  server.disconnectTransport = disconnect;
  return server;
}
if (require.main === module) {
  try {
    const server = createManualGateway({ origin: process.env.JARVIS_JOB_MANUAL_ORIGIN,
      ownerLogin: process.env.JARVIS_JOB_MANUAL_OWNER_LOGIN, ownerId: process.env.JARVIS_JOB_MANUAL_OWNER_ID,
      token: process.env.JARVIS_JOB_MANUAL_TOKEN });
    server.listen(8080, '0.0.0.0');
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.disconnectTransport(); server.close(); });
  } catch { process.stderr.write('JOB_MANUAL_CONFIG_INVALID\n'); process.exitCode = 1; }
}
module.exports = { createManualGateway };
