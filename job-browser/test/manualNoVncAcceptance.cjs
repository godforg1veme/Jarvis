'use strict';
// Isolated Linux only: network none, fixture.tailnet.ts.net -> 127.0.0.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { initial } = require('../src/manualState');
const { createManualBroker } = require('../src/manualBroker');
const { createManualGateway } = require(process.env.JARVIS_MANUAL_FIXTURE_GATEWAY || '/opt/job-manual/src/server');
const ORIGIN = 'https://fixture.tailnet.ts.net';
async function listening(server, port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
async function ready(options) {
  for (let i = 0; i < 100; i++) {
    if (await new Promise(resolve => { const s = net.connect(options); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); })) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('FIXTURE_DISPLAY_UNAVAILABLE');
}
test('real noVNC renders headed display, touch and Cyrillic input, then verifies finish', { timeout: 90000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-novnc-')); await fs.chmod(root, 0o700);
  const children = [], servers = [], sockets = new Set(); let remote, uiBrowser, gateway, broker;
  const child = (command, args) => { const value = spawn(command, args, { stdio: 'ignore', env: { ...process.env, DISPLAY: ':99' } }); value.on('error', () => {}); children.push(value); return value; };
  try {
    child('/usr/bin/Xvfb', [':99', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-noreset']);
    await ready({ path: '/tmp/.X11-unix/X99' });
    child('/usr/bin/x11vnc', ['-display', ':99', '-listen', '127.0.0.1', '-localhost', '-rfbport', '5900', '-rfbportv6', '-1', '-forever', '-shared', '-nopw', '-nosel', '-noclipboard', '-nosetclipboard', '-nosetprimary', '-input', 'KMB', '-no6', '-noipv6', '-norc', '-noremote', '-noxdamage', '-quiet']);
    await ready({ host: '127.0.0.1', port: 5900 });
    remote = await chromium.launch({ headless: false, chromiumSandbox: true, env: { ...process.env, DISPLAY: ':99' }, args: ['--window-position=0,0', '--window-size=1280,900', '--kiosk'] });
    const hh = await remote.newPage({ viewport: null });
    await hh.setContent('<!doctype html><html lang="ru"><meta charset="utf-8"><body style="background:#174b75;margin:0;padding:140px 80px;color:white;font:36px sans-serif"><h1>Изолированная проверка HH</h1><input id="answer" aria-label="Проверка" style="font-size:40px;width:600px;height:90px"><p>Экран и ввод без реальной HH-сессии</p></body></html>');
    const ownerId = randomUUID(), token = randomBytes(32).toString('hex'); let state = initial(ownerId), verified = false, opens = 0;
    const coordinator = new ManualCoordinator({ store: { read: async () => structuredClone(state), write: async value => (state = structuredClone(value)) },
      open: async () => { opens++; await hh.bringToFront(); }, verify: async () => verified && await hh.locator('#answer').inputValue() === 'Привет' });
    await coordinator.load(); await coordinator.pending({ target: 'https://hh.ru/vacancy/123', recoveryId: randomUUID() });
    broker = createManualBroker({ coordinator, ownerId, token }); await listening(broker); servers.push(broker);
    gateway = createManualGateway({ origin: ORIGIN, ownerLogin: 'fixture@example.test', ownerId, token,
      brokerUrl: `http://127.0.0.1:${broker.address().port}`, testAllowLoopback: true });
    await listening(gateway); servers.push(gateway);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key'), '-out', path.join(root, 'cert'), '-subj', '/CN=fixture.tailnet.ts.net', '-days', '1'], { stdio: 'ignore' });
    const upstreamHeaders = req => ({ ...req.headers, host: new URL(ORIGIN).host, 'tailscale-user-login': 'fixture@example.test' });
    const serve = https.createServer({ key: await fs.readFile(path.join(root, 'key')), cert: await fs.readFile(path.join(root, 'cert')) }, (req, res) => {
      const outgoing = http.request({ host: '127.0.0.1', port: gateway.address().port, method: req.method, path: req.url, headers: upstreamHeaders(req) }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
      outgoing.on('error', () => { res.writeHead(503); res.end(); }); req.pipe(outgoing);
    });
    serve.on('upgrade', (req, socket, head) => {
      const outgoing = http.request({ host: '127.0.0.1', port: gateway.address().port, method: 'GET', path: req.url, headers: upstreamHeaders(req) });
      outgoing.on('upgrade', (response, upstream, extra) => {
        sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((s, v, i, a) => i % 2 ? s : s + v + ': ' + a[i + 1] + '\r\n', '')}\r\n`);
        if (head.length) upstream.write(head); if (extra.length) socket.write(extra); upstream.pipe(socket); socket.pipe(upstream);
      });
      outgoing.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Forbidden\r\nConnection: close\r\n\r\n`); response.resume(); });
      outgoing.on('error', () => socket.destroy()); outgoing.end();
    });
    serve.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await listening(serve, 443); servers.push(serve);
    uiBrowser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const uiContext = await uiBrowser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await uiContext.newPage(); const failures = [];
    page.on('pageerror', () => failures.push('FIXTURE_UI_ERROR'));
    await page.goto(`${ORIGIN}/hh/`); assert.equal(coordinator.status().phase, 'pending');
    await page.getByRole('button', { name: 'Начать ручную проверку' }).tap();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#screen canvas'); if (!canvas || canvas.width < 500) return false;
      const pixel = canvas.getContext('2d').getImageData(10, 300, 1, 1).data;
      return pixel[2] > 50;
    });
    assert.equal(opens, 1); assert.throws(() => coordinator.assertAutomatic(), { code: 'JOB_HH_MANUAL_ACTIVE' });
    const second = await page.evaluate(() => new Promise(resolve => { const ws = new WebSocket(`wss://${location.host}/hh/transport?revision=2`, 'binary'); ws.onerror = () => resolve('rejected'); ws.onopen = () => { ws.close(); resolve('opened'); }; }));
    assert.equal(second, 'rejected');
    const point = await hh.locator('#answer').evaluate(el => { const r = el.getBoundingClientRect(); return { x: window.screenX + r.x + r.width / 2, y: window.screenY + window.outerHeight - window.innerHeight + r.y + r.height / 2 }; });
    const canvas = page.locator('#screen canvas'); const box = await canvas.boundingBox();
    const intrinsic = await canvas.evaluate(el => ({ width: el.width, height: el.height }));
    await page.touchscreen.tap(box.x + point.x * box.width / intrinsic.width, box.y + point.y * box.height / intrinsic.height);
    await hh.waitForFunction(() => document.activeElement?.id === 'answer');
    await page.locator('#keyboard').fill('Привет');
    await hh.waitForFunction(() => document.querySelector('#answer').value === 'Привет');
    await page.getByRole('button', { name: 'Готово', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Сбор приостановлен'));
    assert.equal(coordinator.status().phase, 'active');
    await page.waitForFunction(() => { const c = document.querySelector('#screen canvas'); return c && c.width > 500; });
    verified = true; await page.getByRole('button', { name: 'Готово', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('не требуется'));
    assert.equal(coordinator.status().phase, 'idle'); coordinator.assertAutomatic();
    assert.equal(await canvas.count(), 0); assert.deepEqual(failures, []);
  } finally {
    gateway?.disconnectTransport(); broker?.closeManualTransports();
    await uiBrowser?.close(); await remote?.close();
    for (const socket of sockets) socket.destroy();
    for (const server of servers.reverse()) await new Promise(resolve => server.close(resolve));
    for (const process of children.reverse()) {
      if (process.exitCode !== null || process.signalCode !== null) continue;
      const ended = once(process, 'exit'); process.kill('SIGTERM');
      const timer = setTimeout(() => process.kill('SIGKILL'), 2000); await ended; clearTimeout(timer);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
