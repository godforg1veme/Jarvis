'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const { run } = require('/home/pwuser/probe/src/displayMain');

test('real Linux display, headed sandboxed Chromium and fail-closed lifecycle', { timeout: 30000 }, async () => {
  const signals = new EventEmitter();
  const children = [];
  let ready;
  const chromiumReady = new Promise(resolve => { ready = resolve; });
  const fixture = `const { chromium }=require('playwright');
    (async()=>{const browser=await chromium.launch({headless:false,chromiumSandbox:true});
      const page=await browser.newPage(); await page.goto('data:text/html,<h1>Isolated fixture</h1>');
      if(await page.locator('h1').innerText()!=='Isolated fixture')process.exit(1);
      process.stdout.write('FIXTURE_CHROMIUM_READY');
      process.on('SIGTERM',async()=>{await browser.close();process.exit(0)});
    })().catch(()=>process.exit(1));`;
  const env = { ...process.env, JARVIS_JOB_MANUAL_ENABLED: '1', JARVIS_JOB_MANUAL_TOKEN: 'm'.repeat(40),
    JARVIS_JOB_BROWSER_TOKEN: 'r'.repeat(40), JARVIS_JOB_BROWSER_OWNER_ID: '11111111-1111-4111-8111-111111111111' };
  const launched = run({ env, signals, report: () => {}, launch(command, args, options) {
    const isBrowser = args[0]?.endsWith('browserMain.js');
    const child = spawn(command, isBrowser ? ['-e', fixture] : args,
      { ...options, stdio: isBrowser ? ['ignore', 'pipe', 'ignore'] : options.stdio });
    if (isBrowser) child.stdout.on('data', data => { if (data.toString().includes('FIXTURE_CHROMIUM_READY')) ready(); });
    children.push(child);
    return child;
  } });
  try {
    await Promise.race([chromiumReady, launched.then(() => { throw new Error('DISPLAY_START_FAILED'); })]);
    assert.equal(children.length, 3);
    const banner = await new Promise((resolve, reject) => {
      const socket = net.connect(5900, '127.0.0.1');
      socket.once('data', data => { socket.destroy(); resolve(data.toString()); });
      socket.once('error', reject);
    });
    assert.match(banner, /^RFB 003\./);
    const tcp = await fs.readFile('/proc/net/tcp', 'utf8');
    const vnc = tcp.split('\n').filter(line => /:170C\s/.test(line) && /\s0A\s/.test(line));
    assert.equal(vnc.length, 1);
    assert.match(vnc[0], /0100007F:170C/);
    assert.ok(!/:17D3\s/.test(tcp)); // X display 99 TCP port 6099 must not exist.
    assert.ok(!/:170C\s/.test(await fs.readFile('/proc/net/tcp6', 'utf8')));
    children[1].kill('SIGKILL');
    assert.equal(await launched, 1);
    assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
  } finally {
    signals.emit('SIGTERM');
    await launched;
  }
});
