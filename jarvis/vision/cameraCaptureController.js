const path = require('node:path');
const { MAX_FRAME_BYTES, requiredId } = require('./visionSchemas');

const COMMAND_CHANNEL = 'vision:capture:command';
const RESULT_CHANNEL = 'vision:capture:result';
const DEFAULT_TIMEOUT_MS = 10000;

function boundedCaptureOptions(options = {}) {
  const maxWidth = Number(options.maxWidth || 1920);
  const maxHeight = Number(options.maxHeight || 1080);
  const quality = Number(options.quality === undefined ? 0.86 : options.quality);
  if (!Number.isInteger(maxWidth) || maxWidth < 160 || maxWidth > 7680) throw new Error('camera maxWidth is invalid');
  if (!Number.isInteger(maxHeight) || maxHeight < 120 || maxHeight > 7680) throw new Error('camera maxHeight is invalid');
  if (!Number.isFinite(quality) || quality < 0.4 || quality > 0.95) throw new Error('camera quality is invalid');
  return { maxWidth, maxHeight, quality };
}

class CameraCaptureController {
  constructor(options = {}) {
    if (!options.BrowserWindow) throw new Error('CameraCaptureController requires BrowserWindow');
    if (!options.ipcMain) throw new Error('CameraCaptureController requires ipcMain');
    if (!options.sourceRegistry) throw new Error('CameraCaptureController requires sourceRegistry');
    this.BrowserWindow = options.BrowserWindow;
    this.ipcMain = options.ipcMain;
    this.sourceRegistry = options.sourceRegistry;
    this.captureFile = options.captureFile || path.join(__dirname, '..', 'renderer', 'vision-capture.html');
    this.preloadFile = options.preloadFile || path.join(__dirname, '..', 'renderer', 'visionCapturePreload.js');
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.createRequestId = options.createRequestId || (() => `camera-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    this.window = null;
    this.pending = new Map();
    this.activeSourceId = '';
    this.boundResult = (event, payload) => this._handleResult(event, payload);
    this.ipcMain.on(RESULT_CHANNEL, this.boundResult);
  }

  _ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.window = new this.BrowserWindow({
      width: 640,
      height: 480,
      show: false,
      webPreferences: {
        preload: this.preloadFile,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window.loadFile(this.captureFile);
    this.window.on('closed', () => {
      this.window = null;
      this.activeSourceId = '';
      this._rejectPending(new Error('camera capture window closed'));
    });
    return this.window;
  }

  _rejectPending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  _handleResult(event, payload) {
    if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents) return;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const requestId = String(payload.requestId || '');
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    if (payload.ok !== true) {
      const error = new Error(String(payload.errorCode || 'camera_capture_failed').slice(0, 80));
      error.code = String(payload.errorCode || 'camera_capture_failed').slice(0, 80);
      entry.reject(error);
      return;
    }
    entry.resolve(payload.result || {});
  }

  _command(command, args = {}) {
    const win = this._ensureWindow();
    const requestId = requiredId(this.createRequestId(), 'camera request id');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('camera capture request timed out'));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      const send = () => win.webContents.send(COMMAND_CHANNEL, { requestId, command, args });
      if (win.webContents.isLoading && win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', send);
      } else {
        send();
      }
    });
  }

  async listCameras() {
    const result = await this._command('list');
    const cameras = Array.isArray(result.cameras) ? result.cameras.slice(0, 32) : [];
    const nativeIds = [];
    const sources = cameras.map((camera) => {
      const nativeId = String(camera.deviceId || '').slice(0, 512);
      if (!nativeId) throw new Error('camera returned an invalid device id');
      nativeIds.push(nativeId);
      return this.sourceRegistry.upsert({
        type: 'camera',
        nativeId,
        label: String(camera.label || '').slice(0, 160),
        available: true,
      });
    });
    this.sourceRegistry.markUnavailableMissing('camera', nativeIds);
    return sources;
  }

  async start(sourceId) {
    const source = this.sourceRegistry.requireLocal(sourceId);
    if (source.type !== 'camera' || !source.available || source.protected) throw new Error('camera source is unavailable');
    const result = await this._command('start', { deviceId: source.nativeId });
    this.activeSourceId = source.sourceId;
    return {
      sourceId: source.sourceId,
      width: Number(result.width || 0),
      height: Number(result.height || 0),
    };
  }

  async capture(options = {}) {
    if (!this.activeSourceId) throw new Error('camera is not active');
    const result = await this._command('capture', boundedCaptureOptions(options));
    const bytes = Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes || []);
    if (!bytes.length || bytes.length > MAX_FRAME_BYTES) throw new Error('camera frame bytes are invalid');
    if (String(result.contentType || '') !== 'image/jpeg') throw new Error('camera frame content type is invalid');
    const signature = result.signature instanceof Uint8Array
      ? result.signature
      : Uint8Array.from(result.signature || []);
    if (signature.length < 64 || signature.length > 16384) throw new Error('camera frame signature is invalid');
    return {
      sourceId: this.activeSourceId,
      bytes,
      contentType: 'image/jpeg',
      width: Number(result.width || 0),
      height: Number(result.height || 0),
      capturedAt: String(result.capturedAt || ''),
      signature,
    };
  }

  async stop() {
    if (!this.window || this.window.isDestroyed()) {
      this.activeSourceId = '';
      return { stopped: true };
    }
    try {
      return await this._command('stop');
    } finally {
      this.activeSourceId = '';
    }
  }

  async close() {
    try { await this.stop(); } catch (_) {}
    this._rejectPending(new Error('camera capture controller closed'));
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this.ipcMain.removeListener(RESULT_CHANNEL, this.boundResult);
  }
}

module.exports = {
  COMMAND_CHANNEL,
  DEFAULT_TIMEOUT_MS,
  RESULT_CHANNEL,
  CameraCaptureController,
  boundedCaptureOptions,
};
