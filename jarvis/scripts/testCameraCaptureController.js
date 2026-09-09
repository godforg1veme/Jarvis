const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const {
  CameraCaptureController,
  RESULT_CHANNEL,
  boundedCaptureOptions,
} = require('../vision/cameraCaptureController');
const { VisualSourceRegistry } = require('../vision/visualSourceRegistry');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.loading = false;
    this.sent = [];
  }
  isLoading() { return this.loading; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
}

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    FakeWindow.instances.push(this);
  }
  loadFile(file) { this.file = file; }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit('closed'); }
}
FakeWindow.instances = [];

const ipcMain = new EventEmitter();
let requestNumber = 0;
const registry = new VisualSourceRegistry({ createId: () => 'source-camo' });
const controller = new CameraCaptureController({
  BrowserWindow: FakeWindow,
  ipcMain,
  sourceRegistry: registry,
  createRequestId: () => `camera-request-${++requestNumber}`,
  timeoutMs: 100,
});

function reply(result, ok = true) {
  const win = FakeWindow.instances[0];
  const sent = win.webContents.sent.at(-1).payload;
  ipcMain.emit(RESULT_CHANNEL, { sender: win.webContents }, {
    requestId: sent.requestId,
    ok,
    ...(ok ? { result } : { errorCode: result }),
  });
}

(async () => {
  assert.deepStrictEqual(boundedCaptureOptions({}), { maxWidth: 1920, maxHeight: 1080, quality: 0.86 });
  assert.throws(() => boundedCaptureOptions({ quality: 1 }), /quality/);

  const listPromise = controller.listCameras();
  const win = FakeWindow.instances[0];
  assert.strictEqual(win.options.show, false);
  assert.strictEqual(win.options.webPreferences.nodeIntegration, false);
  assert.strictEqual(win.options.webPreferences.contextIsolation, true);
  assert.strictEqual(win.options.webPreferences.sandbox, true);
  reply({ cameras: [{ deviceId: 'private-camo-id', label: 'Camo Studio' }] });
  const sources = await listPromise;
  assert.strictEqual(sources[0].label, 'Camo Studio');
  assert.strictEqual(registry.listPublic()[0].label, undefined);

  const startPromise = controller.start('source-camo');
  assert.strictEqual(win.webContents.sent.at(-1).payload.args.deviceId, 'private-camo-id');
  reply({ width: 1920, height: 1080 });
  assert.deepStrictEqual(await startPromise, { sourceId: 'source-camo', width: 1920, height: 1080 });

  const capturePromise = controller.capture({ maxWidth: 1280, maxHeight: 720, quality: 0.8 });
  reply({
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg',
    width: 1280,
    height: 720,
    capturedAt: '2026-09-09T12:00:00.000Z',
  });
  const frame = await capturePromise;
  assert.strictEqual(frame.bytes.length, 4);
  assert.strictEqual(frame.sourceId, 'source-camo');

  const stopPromise = controller.stop();
  reply({ stopped: true });
  await stopPromise;
  assert.strictEqual(controller.activeSourceId, '');

  const deniedPromise = controller.start('source-camo');
  reply('NotAllowedError', false);
  await assert.rejects(() => deniedPromise, /NotAllowedError/);
  assert.strictEqual(controller.activeSourceId, '');

  await controller.close();
  assert.strictEqual(ipcMain.listenerCount(RESULT_CHANNEL), 0);
  console.log('[testCameraCaptureController] camera capture controller tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

