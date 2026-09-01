const { spawn: defaultSpawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const path = require('path');
const { encodeControlFrame, encodePcmFrame } = require('./sttFrameProtocol');

const READY_TIMEOUT_MS = 15000;
const MAX_LINE_LENGTH = 16384;

function defaultNodeExecutable() {
  const bundled = process.resourcesPath
    ? path.join(process.resourcesPath, 'node-runtime', 'node.exe')
    : '';
  if (bundled && fs.existsSync(bundled)) return bundled;
  return process.env.JARVIS_WAKE_WORD_NODE || 'node';
}

class NodeWakeWordHost {
  constructor(options = {}) {
    this.spawn = options.spawn || defaultSpawn;
    this.nodeExecutable = options.nodeExecutable || defaultNodeExecutable();
    this.workerPath = options.workerPath || path.join(__dirname, 'voskWorker.js');
    this.onResult = typeof options.onResult === 'function' ? options.onResult : () => {};
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
    this.child = null;
    this.readyPromise = null;
    this.stopping = false;
    this.decoder = null;
    this.textBuffer = '';
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  start() {
    if (this.isRunning()) return this.readyPromise || Promise.resolve();
    this.stopping = false;
    this.decoder = new StringDecoder('utf8');
    this.textBuffer = '';
    this.readyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => {
        settle(reject, new Error('Wake word worker startup timed out.'));
        this.stop();
      }, READY_TIMEOUT_MS);
      try {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        this.child = this.spawn(this.nodeExecutable, [this.workerPath], {
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
          env,
        });
      } catch (error) {
        settle(reject, error);
        return;
      }
      const child = this.child;
      child.stdout.on('data', (chunk) => this._consumeOutput(chunk, { resolve, reject, settle }));
      child.once('error', (error) => {
        settle(reject, error);
        if (!this.stopping) this.onError(error);
      });
      child.once('exit', (code) => {
        const error = new Error(`Wake word worker exited (${code === null ? 'unknown' : code}).`);
        settle(reject, error);
        if (this.child === child) {
          this.child = null;
          this.readyPromise = null;
        }
        if (!this.stopping) this.onError(error);
      });
    });
    return this.readyPromise;
  }

  _consumeOutput(chunk, controls) {
    this.textBuffer += this.decoder.write(Buffer.from(chunk));
    if (this.textBuffer.length > MAX_LINE_LENGTH) {
      controls.settle(controls.reject, new Error('Wake word worker emitted an oversized response.'));
      this.stop();
      return;
    }
    let newline;
    while ((newline = this.textBuffer.indexOf('\n')) >= 0) {
      const line = this.textBuffer.slice(0, newline);
      this.textBuffer = this.textBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (_) { continue; }
      if (!message || typeof message !== 'object') continue;
      if (message.type === 'ready') {
        controls.settle(controls.resolve);
      } else if (message.type === 'error') {
        const error = new Error('Wake word worker failed.');
        controls.settle(controls.reject, error);
        if (!this.stopping) this.onError(error);
      } else if (message.type === 'partial' || message.type === 'final') {
        this.onResult({ partial: message.type === 'partial' ? String(message.text || '') : '', final: message.type === 'final' ? String(message.text || '') : '' });
      }
    }
  }

  sendPcm(buffer) {
    if (!this.isRunning() || !Buffer.isBuffer(buffer) || buffer.length === 0) return false;
    try {
      return this.child.stdin.write(encodePcmFrame(buffer));
    } catch (_) {
      return false;
    }
  }

  stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    if (!child) return;
    try { child.stdin.write(encodeControlFrame({ type: 'stop' })); } catch (_) {}
    try { child.stdin.end(); } catch (_) {}
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try { child.kill(); } catch (_) {}
      }
    }, 1000).unref();
  }
}

module.exports = { NodeWakeWordHost, READY_TIMEOUT_MS, defaultNodeExecutable };
