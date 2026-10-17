const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

async function run() {
  const calls = [];
  const handlers = new Map();
  // Execute the actual legacy registrations if present, without booting Electron
  // or running an OS tool. A foreign frame must never reach the executor.
  for (const channel of ['execute-tool', 'confirm-command']) {
    const start = main.indexOf(`  ipcMain.handle('${channel}',`);
    if (start < 0) continue;
    const end = main.indexOf('\n  ipcMain.handle(', start + 1);
    vm.runInNewContext(main.slice(start, end), {
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      ALLOWED_TOOLS: ['powershell'],
      require: () => ({ execute: (...args) => { calls.push(args); return { ok: true }; } }),
      broadcastCoreMode() {}, setTimeout() {},
    });
  }
  for (const handler of handlers.values()) {
    await handler({ sender: { id: 999 }, senderFrame: {} }, {
      tool: 'powershell', args: { command: 'AUDIT_TEST_ONLY', confirmed: true },
    });
  }
  assert.equal(calls.length, 0, 'foreign renderer and forged confirmation must not reach raw OS tools');
  assert.equal(handlers.size, 0, 'retired raw-tool channels must not be registered');
  const legacy = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert(!legacy.includes("invoke('execute-tool'"));
  assert(!legacy.includes("invoke('confirm-command'"));

  const trustedSource = main.match(/function isTrustedMainRenderer\(event\) \{[\s\S]*?\n\}/)[0];
  const frame = {};
  const win = { isDestroyed: () => false, webContents: { id: 10, mainFrame: frame, isDestroyed: () => false } };
  const trusted = vm.runInNewContext(`${trustedSource}; isTrustedMainRenderer`, { mainWindow: win });
  assert.equal(trusted({ sender: win.webContents, senderFrame: frame }), true);
  assert.equal(trusted({ sender: win.webContents, senderFrame: {} }), false, 'subframe denied');
  assert.equal(trusted({ sender: { id: 999 }, senderFrame: frame }), false, 'other window denied');
  assert.equal(trusted({ sender: win.webContents }), false, 'missing frame denied');
  win.isDestroyed = () => true;
  assert.equal(trusted({ sender: win.webContents, senderFrame: frame }), false);

  for (const [name, expected] of Object.entries({
    voiceOverlay: { jarvis: ['onCoreMode'], jarvisVoice: ['onPartial', 'onStatus'] },
    transcriptionBar: { jarvis: ['hideTranscriptionBar'], jarvisVoice: ['getState', 'onPartial', 'onStatus'] },
    hologramWidget: { jarvis: ['moveHologramWindow', 'onCoreMode', 'setHologramPin', 'showMainWindow', 'toggleHologramWidget'] },
  })) {
    const exposed = {};
    const subscriptions = new Map();
    const requests = [];
    const source = fs.readFileSync(path.join(root, 'desktop', 'preload', `${name}.js`), 'utf8');
    vm.runInNewContext(source, { require: () => ({
      contextBridge: { exposeInMainWorld: (key, api) => { exposed[key] = api; } },
      ipcRenderer: {
        invoke: (...args) => { requests.push(args); return Promise.resolve({ ok: true }); },
        send: (...args) => requests.push(args),
        on: (channel, callback) => subscriptions.set(channel, callback),
      },
    }) });
    assert.deepEqual(Object.keys(exposed).sort(), Object.keys(expected).sort());
    for (const [key, methods] of Object.entries(expected)) assert.deepEqual(Object.keys(exposed[key]).sort(), methods.sort());
    const rendererFile = { voiceOverlay: 'voice-overlay.js', transcriptionBar: 'transcription-bar.js', hologramWidget: 'quantum-widget.js' }[name];
    const renderer = fs.readFileSync(path.join(root, 'renderer', rendererFile), 'utf8');
    for (const match of renderer.matchAll(/window\.(jarvisVoice|jarvis)\.(\w+)/g)) {
      assert.equal(typeof exposed[match[1]]?.[match[2]], 'function', `${rendererFile}: required API ${match[0]} remains available`);
    }
    for (const [api, method, channel] of [
      ['jarvis', 'onCoreMode', 'jarvis:core-mode'],
      ['jarvisVoice', 'onPartial', 'voice:partial'],
      ['jarvisVoice', 'onStatus', 'voice:status'],
    ]) {
      if (!exposed[api]?.[method]) continue;
      let received;
      exposed[api][method](payload => { received = payload; });
      const payload = { mode: 'idle', text: 'test' };
      subscriptions.get(channel)({ sender: 'must stay private' }, payload);
      assert.equal(received, payload, 'events forward payload without exposing Electron event');
    }
    if (name === 'transcriptionBar') {
      await exposed.jarvis.hideTranscriptionBar();
      await exposed.jarvisVoice.getState();
      assert.deepEqual(requests, [['hide-transcription-bar'], ['voice:state']]);
    }
    if (name === 'hologramWidget') {
      exposed.jarvis.moveHologramWindow(2, 3);
      await exposed.jarvis.showMainWindow();
      await exposed.jarvis.setHologramPin(true);
      await exposed.jarvis.toggleHologramWidget(false);
      assert.equal(requests[0][0], 'hologram-widget:move');
      assert.equal(requests[0][1].dx, 2);
      assert.equal(requests[0][1].dy, 3);
      assert.equal(requests[1][0], 'show-main-window');
      assert.equal(requests[2][0], 'hologram-widget:set-pin');
      assert.equal(requests[2][1].pinned, true);
      assert.equal(requests[3][0], 'hologram-widget:toggle');
      assert.equal(requests[3][1].visible, false);
    }
    assert(main.includes(`'desktop', 'preload', '${name}.js'`), `${name} is wired to its own preload`);
  }
  assert(!main.includes("preload: path.join(__dirname, 'preload.js')"));
  console.log('Desktop IPC boundary tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
