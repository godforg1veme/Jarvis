'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { UUID } = require('./rpcProtocol');

function reachable(options) {
  return new Promise(resolve => {
    const socket = net.createConnection(options);
    const finish = result => { socket.destroy(); resolve(result); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

async function waitFor(check, alive) {
  for (let i = 0; i < 100; i += 1) {
    if (!alive()) throw new Error('JOB_MANUAL_DISPLAY_FAILED');
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('JOB_MANUAL_DISPLAY_FAILED');
}

// No runtime command strings or configurable executables: every child is fixed.
async function run({ env = process.env, launch = spawn, signals = process,
  probe = reachable, wait = waitFor, report = code => process.stderr.write(`${code}\n`) } = {}) {
  const children = new Set();
  let stopping = false;
  let result = 0;
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  const stop = code => {
    if (stopping) return;
    stopping = true;
    result = code;
    for (const child of children) child.kill('SIGTERM');
    if (!children.size) complete();
    const killTimer = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 5000);
    killTimer.unref();
    finished.then(() => clearTimeout(killTimer));
  };
  const onSignal = () => stop(0);
  signals.on('SIGTERM', onSignal);
  signals.on('SIGINT', onSignal);
  function start(command, args, childEnv, stdio) {
    const child = launch(command, args, { env: childEnv, stdio, shell: false });
    children.add(child);
    child.once('error', () => { report('JOB_MANUAL_CHILD_FAILED'); stop(1); });
    child.once('exit', () => {
      children.delete(child);
      if (!stopping) { report('JOB_MANUAL_CHILD_EXITED'); stop(1); }
      if (stopping && !children.size) complete();
    });
    // Failed spawn emits error without exit on supported Node versions.
    child.once('close', () => {
      children.delete(child);
      if (stopping && !children.size) complete();
    });
    return child;
  }
  try {
    const manual = env.JARVIS_JOB_MANUAL_ENABLED === '1';
    const childEnv = { ...env };
    if (manual) {
      // Refuse display startup before any authenticated broker can be configured.
      const token = env.JARVIS_JOB_MANUAL_TOKEN;
      if (!/^[\x21-\x7e]{32,256}$/.test(token || '') || token === env.JARVIS_JOB_BROWSER_TOKEN ||
          token === env.JARVIS_JOB_BROWSER_APPLY_TOKEN || !UUID.test(env.JARVIS_JOB_BROWSER_OWNER_ID || '')) {
        throw new Error('JOB_MANUAL_CONFIG_INVALID');
      }
      childEnv.DISPLAY = ':99';
      start('/usr/bin/Xvfb', [':99', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-noreset'], childEnv, 'ignore');
      await wait(() => probe({ path: '/tmp/.X11-unix/X99' }), () => !stopping);
      if (!stopping) start('/usr/bin/x11vnc', ['-display', ':99', '-listen', '127.0.0.1', '-localhost',
        '-rfbport', '5900', '-rfbportv6', '-1', '-forever', '-shared', '-nopw', '-nosel', '-noclipboard',
        '-nosetclipboard', '-nosetprimary', '-input', 'KMB', '-no6', '-noipv6', '-norc', '-noremote', '-noxdamage', '-quiet'], childEnv, 'ignore');
      await wait(() => probe({ host: '127.0.0.1', port: 5900 }), () => !stopping);
    }
    if (!stopping) start(process.execPath, [path.join(__dirname, 'browserMain.js')], childEnv, 'inherit');
  } catch {
    if (!stopping) report('JOB_MANUAL_DISPLAY_FAILED');
    stop(1);
  }
  await finished;
  signals.removeListener('SIGTERM', onSignal);
  signals.removeListener('SIGINT', onSignal);
  return result;
}

if (require.main === module) run().then(code => { process.exitCode = code; });
module.exports = { run, reachable, waitFor };
