const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { parseIntent } = require('./intentParser');
const { executeIntent } = require('../actions/executeIntent');
const defaultTtsService = require('../tts/ttsService');

const COOLDOWN_MS = 2500;
const READY_TIMEOUT_MS = 10000;
const MIC_GRAB_TIME_MS = 2000; // time to show window for getUserMedia
const AUDIO_CAPTURE_START_RETRY_MS = 300;

/**
 * VoiceService — manages Vosk worker lifecycle and background audio capture.
 * Uses a hidden BrowserWindow that is briefly shown to acquire the microphone,
 * then hidden. Audio continues because backgroundThrottling: false.
 */
class VoiceService {
  constructor(options = {}) {
    this.workerProcess = null;
    this.workerReady = false;
    this.stopRequested = false;
    this.readyTimeout = null;
    this.lastCommandTime = 0;
    this._voiceEnabled = false;
    this._workerGeneration = 0;
    this.audioCaptureWindow = null;
    this.audioCaptureStarted = false;
    this.captureStartRetry = null;
    this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
    this.ttsService = options.ttsService || defaultTtsService;
    this.intentOptions = options.intentOptions || {};
  }

  get isVoiceEnabled() { return this._voiceEnabled; }

  notifyStateChange() {
    if (!this.onStateChange) return;
    try {
      this.onStateChange({
        enabled: this._voiceEnabled,
        workerReady: this.workerReady,
        audioCaptureStarted: this.audioCaptureStarted,
      });
    } catch (e) {}
  }

  broadcastStatus(type, message, extra = {}) {
    const payload = { type, message, ...extra };
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('voice:status', payload);
        }
      } catch (e) {}
    }
  }

  _clearReadyTimeout() {
    if (this.readyTimeout) { clearTimeout(this.readyTimeout); this.readyTimeout = null; }
  }

  // --- Worker lifecycle ---

  startWorker() {
    if (this.workerProcess) {
      this.broadcastStatus('error', 'Worker already running.');
      return false;
    }
    this.workerReady = false;
    this.stopRequested = false;
    this._workerGeneration++;
    const gen = this._workerGeneration;

    const workerPath = path.join(__dirname, 'voskWorker.js');
    let resolvedNode = process.env.JARVIS_NODE_EXE || 'node';
    if (resolvedNode === 'node') {
      try {
        const { execSync } = require('child_process');
        resolvedNode = execSync('where node', { encoding: 'utf8' }).trim().split('\n')[0];
      } catch (e) { resolvedNode = 'node'; }
    }

    try {
      this.workerProcess = spawn(resolvedNode, [workerPath], {
        cwd: path.join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      this.broadcastStatus('error', `Failed to spawn worker: ${e.message}.`);
      this.workerProcess = null;
      return false;
    }

    this.workerProcess.stdout.setEncoding('utf8');
    let stdoutBuffer = '';
    this.workerProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        this._handleWorkerMessage(msg);
      }
    });

    this.workerProcess.stderr.on('data', (data) => {
      const text = data.toString('utf8').trim();
      if (text) console.error('[voice-worker]:', text);
    });

    this.workerProcess.on('exit', (code, signal) => {
      if (gen !== this._workerGeneration) return;
      this._clearReadyTimeout();
      this.workerProcess = null;
      this.workerReady = false;
      if (!this.stopRequested && code !== 0) {
        console.log(`[voiceService] Worker exited (code=${code}). Auto-restarting in 3s...`);
        setTimeout(() => {
          if (this._voiceEnabled && !this.stopRequested && gen === this._workerGeneration) {
            this.startWorker();
          }
        }, 3000);
      }
    });

    this.workerProcess.on('error', (err) => {
      this._clearReadyTimeout();
      console.error('[voiceService] Worker error:', err);
      this.workerProcess = null;
      this.workerReady = false;
    });

    this.readyTimeout = setTimeout(() => {
      if (!this.workerReady && this.workerProcess && gen === this._workerGeneration) {
        this.broadcastStatus('error', 'Worker timeout: Vosk model took too long to load.');
        try { this.workerProcess.kill(); } catch (e) {}
      }
    }, READY_TIMEOUT_MS);

    return true;
  }

  stopWorker() {
    this.stopRequested = true;
    this._clearReadyTimeout();
    if (this.workerProcess) {
      try {
        if (this.workerProcess.stdin && this.workerProcess.stdin.writable) {
          this.workerProcess.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
        }
        setTimeout(() => {
          if (this.workerProcess) { try { this.workerProcess.kill(); } catch (e) {} }
        }, 2000);
      } catch (e) {}
    } else {
      this.workerReady = false;
    }
  }

  sendPcmToWorker(pcmBuffer) {
    if (!this.workerProcess || !this.workerReady || !this.workerProcess.stdin.writable) return;
    try {
      const base64 = Buffer.from(pcmBuffer).toString('base64');
      this.workerProcess.stdin.write(JSON.stringify({ type: 'pcm', base64 }) + '\n');
    } catch (e) {}
  }

  // --- Message handling ---

  _handleWorkerMessage(msg) {
    if (msg.type === 'ready') {
      this.workerReady = true;
      this._clearReadyTimeout();
      this.broadcastStatus('ready', 'Готово. Скажите: джарвис включи доту');
      return;
    }
    if (msg.type === 'partial') {
      this.broadcastStatus('partial', '', { text: msg.text });
      for (const win of BrowserWindow.getAllWindows()) {
        try { if (win.webContents && !win.webContents.isDestroyed()) win.webContents.send('voice:partial', { text: msg.text }); } catch (e) {}
      }
      return;
    }
    if (msg.type === 'final') { this._handleFinalResult(msg.text); return; }
    if (msg.type === 'error') { this.broadcastStatus('error', msg.message || 'Worker error'); return; }
    if (msg.type === 'stopped') { this.broadcastStatus('stopped', 'Voice worker stopped.'); return; }
  }

  async _handleFinalResult(text) {
    const now = Date.now();
    if (now - this.lastCommandTime < COOLDOWN_MS) { this.broadcastStatus('ignored', 'Cooldown'); return; }
    if (!text || text.trim().length === 0) { this.broadcastStatus('ignored', 'Empty'); return; }
    this.broadcastStatus('recognized', text);
    const intent = parseIntent(text);
    if (!intent.ok) { this.broadcastStatus('ignored', `Not recognized: ${intent.reason}`); return; }
    this.broadcastStatus('intent', JSON.stringify(intent));
    try {
      const result = await executeIntent(intent, this.intentOptions);
      this.broadcastStatus('result', result.message || JSON.stringify(result), { result });
      this.lastCommandTime = Date.now();
      await this._speakVoiceResult(result);
    } catch (e) {
      this.broadcastStatus('error', `executeIntent failed: ${e.message}`);
    }
  }

  async _speakVoiceResult(result) {
    const message = String(result?.message || '').trim();
    if (!message || !this.ttsService || typeof this.ttsService.speak !== 'function') return;

    try {
      const settings = typeof this.ttsService.getSettings === 'function'
        ? this.ttsService.getSettings()
        : {};
      if (settings.speakVoiceResults === false) return;

      await this.ttsService.speak(message);
    } catch (e) {
      console.error('[voiceService] TTS failed:', e);
      this.broadcastStatus('error', `TTS failed: ${e.message}`);
    }
  }

  async _prepareTts() {
    if (!this.ttsService || typeof this.ttsService.prepare !== 'function') return;

    try {
      const settings = typeof this.ttsService.getSettings === 'function'
        ? this.ttsService.getSettings()
        : {};
      if (settings.speakVoiceResults === false) return;

      await this.ttsService.prepare();
    } catch (e) {
      console.error('[voiceService] TTS prepare failed:', e);
    }
  }

  // --- Hidden audio capture window ---

  createAudioCaptureWindow() {
    if (this.audioCaptureWindow && !this.audioCaptureWindow.isDestroyed()) return;

    this.audioCaptureWindow = new BrowserWindow({
      width: 300, height: 200,
      show: false,
      skipTaskbar: true,
      frame: false,
      resizable: false,
      backgroundThrottling: false,
      webPreferences: {
        preload: path.join(__dirname, 'audioCapturePreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.audioCaptureWindow.loadFile(path.join(__dirname, 'audioCaptureWindow.html'));

    // Briefly show this hidden window to allow getUserMedia, then hide it.
    // The hidden window owns microphone capture so it keeps working even when the main UI is hidden.
    let shownForMic = false;
    const showForMic = () => {
      if (shownForMic || !this.audioCaptureWindow || this.audioCaptureWindow.isDestroyed()) return;
      shownForMic = true;

      console.log('[voiceService] Showing audio capture window briefly for getUserMedia...');
      this.audioCaptureWindow.show();
      this.startAudioCapture();

      setTimeout(() => {
        if (this.audioCaptureWindow && !this.audioCaptureWindow.isDestroyed()) {
          this.audioCaptureWindow.hide();
          console.log('[voiceService] Audio capture window hidden, capture continues in background.');
        }
      }, MIC_GRAB_TIME_MS);
    };

    this.audioCaptureWindow.once('ready-to-show', showForMic);
    this.audioCaptureWindow.once('did-finish-load', () => {
      setTimeout(showForMic, 100);
    });

    this.audioCaptureWindow.on('closed', () => {
      this.audioCaptureWindow = null;
      this.audioCaptureStarted = false;
    });
  }

  _clearCaptureStartRetry() {
    if (this.captureStartRetry) {
      clearTimeout(this.captureStartRetry);
      this.captureStartRetry = null;
    }
  }

  _scheduleAudioCaptureStart() {
    if (!this._voiceEnabled) return;
    this._clearCaptureStartRetry();
    this.captureStartRetry = setTimeout(() => {
      this.captureStartRetry = null;
      this.startAudioCapture();
    }, AUDIO_CAPTURE_START_RETRY_MS);
  }

  startAudioCapture() {
    if (!this._voiceEnabled) return;

    const win = this.audioCaptureWindow;
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
      this.audioCaptureStarted = false;
      return;
    }

    try {
      win.webContents.send('voice:audio-capture-command', 'start');
      this.audioCaptureStarted = true;
    } catch (e) {
      this.audioCaptureStarted = false;
    }
  }

  stopAudioCapture() {
    const win = this.audioCaptureWindow;
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      try {
        win.webContents.send('voice:audio-capture-command', 'stop');
      } catch (e) {}
    }
    this.audioCaptureStarted = false;
    this._clearCaptureStartRetry();
  }

  destroyAudioCaptureWindow() {
    this.stopAudioCapture();
    if (this.audioCaptureWindow && !this.audioCaptureWindow.isDestroyed()) {
      try { this.audioCaptureWindow.close(); } catch (e) {}
    }
    this.audioCaptureWindow = null;
  }

  // --- Public API ---

  enable(startResultCallback) {
    if (this._voiceEnabled) {
      if (startResultCallback) startResultCallback({ ok: false, error: 'Already enabled.' });
      return;
    }
    this._voiceEnabled = true;
    if (!this.startWorker()) {
      this._voiceEnabled = false;
      if (startResultCallback) startResultCallback({ ok: false, error: 'Failed to start worker.' });
      return;
    }
    this.createAudioCaptureWindow();
    this.startAudioCapture();
    this._scheduleAudioCaptureStart();
    this._prepareTts();
    console.log('[voiceService] Voice enabled.');
    this.notifyStateChange();
    if (startResultCallback) startResultCallback({ ok: true });
  }

  disable() {
    this._voiceEnabled = false;
    this.stopAudioCapture();
    this.stopWorker();
    this.destroyAudioCaptureWindow();
    console.log('[voiceService] Voice disabled.');
    this.notifyStateChange();
  }

  toggle() {
    if (this._voiceEnabled) this.disable(); else this.enable();
    return this._voiceEnabled;
  }

  shutdown() {
    this._voiceEnabled = false;
    this.stopRequested = true;
    this.stopAudioCapture();
    this.stopWorker();
    this.destroyAudioCaptureWindow();
    this._clearReadyTimeout();
    this.workerProcess = null;
    this.workerReady = false;
    console.log('[voiceService] Shutdown complete.');
  }

  registerIpcHandlers() {
    ipcMain.handle('voice:start', async () => new Promise((r) => this.enable(r)));
    ipcMain.handle('voice:stop', async () => { this.disable(); return { ok: true }; });
    ipcMain.on('voice:pcm', (event, buf) => this.sendPcmToWorker(buf));
    ipcMain.on('voice:audio-capture-pcm', (event, buf) => this.sendPcmToWorker(buf));
    ipcMain.on('voice:audio-capture-error', (event, message) => {
      const text = String(message || 'Неизвестная ошибка микрофона');
      console.error('[voiceService] Audio capture error:', text);
      this.broadcastStatus('error', `Микрофон: ${text}`);
    });
    ipcMain.handle('voice:state', async () => ({
      enabled: this._voiceEnabled,
      workerReady: this.workerReady,
      audioCaptureStarted: this.audioCaptureStarted,
    }));
    ipcMain.handle('voice:toggle', async () => ({ ok: true, enabled: this.toggle() }));
  }
}

module.exports = { VoiceService };
