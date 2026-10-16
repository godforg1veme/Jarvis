'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { run } = require('../src/displayMain');

function fixture(env) {
  const signals = new EventEmitter();
  const launched = [];
  const logs = [];
  const launch = (command, args, options) => {
    const child = new EventEmitter();
    child.kill = signal => { child.killed = signal; queueMicrotask(() => child.emit('exit', 0)); };
    launched.push({ command, args, options, child });
    return child;
  };
  const done = run({ env, signals, launch, report: code => logs.push(code),
    wait: async (check, alive) => { assert.ok(alive()); assert.equal(await check(), true); }, probe: async () => true });
  return { signals, launched, logs, done };
}
const environment = () => ({ JARVIS_JOB_MANUAL_ENABLED: '1', JARVIS_JOB_MANUAL_TOKEN: 'm'.repeat(40),
  JARVIS_JOB_BROWSER_OWNER_ID: '11111111-1111-4111-8111-111111111111', JARVIS_JOB_BROWSER_TOKEN: 'r'.repeat(40),
  JARVIS_JOB_BROWSER_APPLY_TOKEN: 'a'.repeat(40) });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('disabled manual access launches only the existing browser runtime', async () => {
  const f = fixture({});
  assert.equal(f.launched.length, 1);
  assert.match(f.launched[0].args[0], /browserMain\.js$/);
  assert.equal(f.launched[0].options.shell, false);
  assert.equal(f.launched[0].options.env.DISPLAY, undefined);
  f.signals.emit('SIGTERM');
  assert.equal(await f.done, 0);
});
test('missing or reused credentials never start display children', async () => {
  for (const token of ['', 'short', 'r'.repeat(40), 'a'.repeat(40), 'm'.repeat(257), 'm'.repeat(40) + '\n']) {
    const f = fixture({ ...environment(), JARVIS_JOB_MANUAL_TOKEN: token });
    assert.equal(await f.done, 1);
    assert.equal(f.launched.length, 0);
    assert.deepEqual(f.logs, ['JOB_MANUAL_DISPLAY_FAILED']);
  }
});
test('headed display has no TCP X server and VNC only listens on loopback', async () => {
  const f = fixture(environment());
  await tick();
  assert.equal(f.launched.length, 3);
  assert.equal(f.launched[0].command, '/usr/bin/Xvfb');
  assert.deepEqual(f.launched[0].args.slice(-3), ['-nolisten', 'tcp', '-noreset']);
  assert.equal(f.launched[1].command, '/usr/bin/x11vnc');
  assert.ok(f.launched[1].args.includes('-localhost'));
  assert.equal(f.launched[1].args[f.launched[1].args.indexOf('-listen') + 1], '127.0.0.1');
  assert.ok(f.launched[1].args.includes('-nosel'));
  assert.ok(f.launched[1].args.includes('-noclipboard'));
  assert.ok(f.launched[1].args.includes('-nosetclipboard'));
  assert.ok(f.launched[1].args.includes('-noremote'));
  assert.equal(f.launched[1].args[f.launched[1].args.indexOf('-rfbportv6') + 1], '-1');
  assert.equal(f.launched[1].args[f.launched[1].args.indexOf('-input') + 1], 'KMB');
  assert.ok(!f.launched[1].args.includes('-permitfiletransfer'));
  assert.equal(f.launched[2].options.env.DISPLAY, ':99');
  f.signals.emit('SIGINT');
  assert.equal(await f.done, 0);
  assert.ok(f.launched.every(item => item.child.killed === 'SIGTERM'));
});
test('display failure terminates browser and other display child', async () => {
  const f = fixture(environment());
  await tick();
  f.launched[1].child.emit('exit', 1);
  assert.equal(await f.done, 1);
  assert.equal(f.launched[2].child.killed, 'SIGTERM');
  assert.equal(f.launched[0].child.killed, 'SIGTERM');
  assert.deepEqual(f.logs, ['JOB_MANUAL_CHILD_EXITED']);
});
