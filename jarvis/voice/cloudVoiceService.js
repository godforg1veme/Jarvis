const path = require('path');
const { pcm16ToWav } = require('../cloud/pcmWav');
const { createTtsService } = require('../tts/ttsService');
const { NodeWakeWordHost } = require('./nodeWakeWordHost');
const { getSttSettings } = require('./sttSettings');

const MAX_WAKE_BUFFER_BYTES = 16 * 32000;
const MAX_UTTERANCE_BYTES = 15 * 32000;
const SILENCE_MS = 900;
const START_RMS = 0.012;
const WAKE_ALIASES = ['джарвис', 'жарвис', 'джервис', 'ярвис', 'jarvis'];

function normalizeSpeech(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/giu, ' ').replace(/\s+/g, ' ').trim();
}

function containsWakeWord(value) {
  const text = normalizeSpeech(value);
  return WAKE_ALIASES.some((alias) => text.includes(alias));
}

function durationMs(buffer) {
  return Math.round((Buffer.byteLength(buffer) / 32000) * 1000);
}

function pcmRms(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return 0;
  let sum = 0;
  const samples = Math.floor(buffer.length / 2);
  for (let index = 0; index < samples; index += 1) {
    const value = buffer.readInt16LE(index * 2) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

class CloudVoiceService {
  constructor(options) {
    const electron = options.electron || require('electron');
    this.BrowserWindow = options.BrowserWindow || electron.BrowserWindow;
    this.ipcMain = options.ipcMain || electron.ipcMain;
    this.cloudClient = options.cloudClient;
    this.ttsService = options.ttsService || createTtsService({
      settings: process.platform === 'win32'
        ? { enabled: true, provider: 'windows-sapi', fallbackProvider: false, speakVoiceResults: true }
        : { enabled: false, fallbackProvider: false },
    });
    this.settings = options.settings || getSttSettings();
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.onResponse = typeof options.onResponse === 'function' ? options.onResponse : () => {};
    this.wakeWordHost = options.wakeWordHost || new NodeWakeWordHost({
      onResult: (result) => this._onWakeResult(result),
      onError: () => this._onWakeError(),
    });
    this.audioCaptureWindow = null;
    this.enabled = false;
    this.phase = 'off';
    this.wakeChunks = [];
    this.wakeBytes = 0;
    this.utteranceChunks = [];
    this.utteranceBytes = 0;
    this.speechSeen = false;
    this.silenceMs = 0;
    this.pending = false;
  }

  get isVoiceEnabled() { return this.enabled; }

  _emit(type, message, extra = {}) {
    this.onStatus({ type, message, enabled: this.enabled, phase: this.phase, ...extra });
  }

  _clearBuffers() {
    this.wakeChunks = [];
    this.wakeBytes = 0;
    this.utteranceChunks = [];
    this.utteranceBytes = 0;
    this.speechSeen = false;
    this.silenceMs = 0;
  }

  async _startWakeDetector() {
    await this.wakeWordHost.start();
  }

  _onWakeResult(result) {
    if (!this.enabled || this.phase !== 'wake') return;
    if (containsWakeWord(result && result.partial) || containsWakeWord(result && result.final)) this._activate();
  }

  _onWakeError() {
    if (!this.enabled) return;
    this.enabled = false;
    this.phase = 'off';
    this._emit('error', 'Локальный детектор wake word недоступен.');
  }

  _appendWake(buffer) {
    const copy = Buffer.from(buffer);
    this.wakeChunks.push(copy);
    this.wakeBytes += copy.length;
    while (this.wakeBytes > MAX_WAKE_BUFFER_BYTES && this.wakeChunks.length) {
      this.wakeBytes -= this.wakeChunks.shift().length;
    }
  }

  _appendUtterance(buffer) {
    const copy = Buffer.from(buffer);
    this.utteranceChunks.push(copy);
    this.utteranceBytes += copy.length;
  }

  _activate() {
    this.phase = 'listening';
    this.wakeWordHost.stop();
    this.utteranceChunks = this.wakeChunks.map((chunk) => Buffer.from(chunk));
    this.utteranceBytes = this.wakeBytes;
    this.wakeChunks = [];
    this.wakeBytes = 0;
    this.speechSeen = true;
    this.silenceMs = 0;
    this._emit('listening', 'Слушаю…');
  }

  async _finishUtterance() {
    if (this.pending || this.utteranceBytes === 0) return;
    this.pending = true;
    this.phase = 'transcribing';
    const pcm = Buffer.concat(this.utteranceChunks);
    this._clearBuffers();
    this._emit('transcribing', 'Распознаю…');
    try {
      const response = await this.cloudClient.sendVoice(pcm16ToWav(pcm), { mimeType: 'audio/wav' });
      this._emit('responding', 'Отвечаю…', { transcript: response.transcript || '' });
      this.onResponse({ source: 'voice', transcript: response.transcript || '', answer: response.answer || '' });
      if (response.answer && this.ttsService && typeof this.ttsService.speak === 'function') {
        this._emit('speaking', 'Говорю…', { answer: response.answer });
        await this.ttsService.speak(response.answer);
      }
      this._emit('ready', 'Скажите: «Джарвис»');
    } catch (error) {
      this._emit('error', 'Не удалось распознать голосовой запрос.');
    } finally {
      pcm.fill(0);
      this.pending = false;
      if (this.enabled) {
        this.phase = 'wake';
        try { await this._startWakeDetector(); } catch (error) {
          this._emit('error', 'Локальный детектор wake word недоступен.');
          this.enabled = false;
          this.phase = 'off';
        }
      }
    }
  }

  onPcm(input) {
    if (!this.enabled || this.pending) return;
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
    if (!buffer.length || buffer.length % 2) return;
    if (this.phase === 'wake') {
      this._appendWake(buffer);
      this.wakeWordHost.sendPcm(buffer);
      return;
    }
    if (this.phase !== 'listening') return;
    this._appendUtterance(buffer);
    const chunkMs = durationMs(buffer);
    if (pcmRms(buffer) >= START_RMS) {
      this.speechSeen = true;
      this.silenceMs = 0;
    } else if (this.speechSeen) {
      this.silenceMs += chunkMs;
    }
    if (this.utteranceBytes >= MAX_UTTERANCE_BYTES || (this.speechSeen && this.silenceMs >= SILENCE_MS)) {
      void this._finishUtterance();
    }
  }

  createAudioCaptureWindow() {
    if (this.audioCaptureWindow && !this.audioCaptureWindow.isDestroyed()) return;
    this.audioCaptureWindow = new this.BrowserWindow({
      width: 300,
      height: 200,
      show: false,
      skipTaskbar: true,
      frame: false,
      resizable: false,
      backgroundThrottling: false,
      webPreferences: {
        preload: path.join(__dirname, 'cloudAudioCapturePreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.audioCaptureWindow.loadFile(path.join(__dirname, 'cloudAudioCaptureWindow.html'));
    const start = () => {
      if (!this.enabled || !this.audioCaptureWindow || this.audioCaptureWindow.isDestroyed()) return;
      this.audioCaptureWindow.show();
      this.audioCaptureWindow.webContents.send('cloud-voice:audio-capture-command', {
        command: 'start',
        settings: this.settings.capture || {},
      });
      setTimeout(() => {
        if (this.audioCaptureWindow && !this.audioCaptureWindow.isDestroyed()) this.audioCaptureWindow.hide();
      }, 1500);
    };
    this.audioCaptureWindow.once('ready-to-show', start);
    this.audioCaptureWindow.once('did-finish-load', () => setTimeout(start, 100));
    this.audioCaptureWindow.on('closed', () => { this.audioCaptureWindow = null; });
  }

  async enable() {
    if (this.enabled) return { ok: true, enabled: true };
    if (!this.cloudClient || !this.cloudClient.isPaired()) {
      this._emit('offline', 'Сначала подключите Jarvis Desktop к серверу.');
      return { ok: false, error: 'Desktop is not paired.' };
    }
    try {
      await this._startWakeDetector();
      this.enabled = true;
      this.phase = 'wake';
      this.createAudioCaptureWindow();
      this._emit('ready', 'Скажите: «Джарвис»');
      return { ok: true, enabled: true };
    } catch (error) {
      this.enabled = false;
      this.phase = 'off';
      this._emit('error', 'Локальный детектор wake word недоступен.');
      return { ok: false, error: 'Wake word detector is unavailable.' };
    }
  }

  disable() {
    this.enabled = false;
    this.phase = 'off';
    this.pending = false;
    this._clearBuffers();
    this.wakeWordHost.stop();
    if (this.audioCaptureWindow && !this.audioCaptureWindow.isDestroyed()) {
      try { this.audioCaptureWindow.webContents.send('cloud-voice:audio-capture-command', 'stop'); } catch (_) {}
      try { this.audioCaptureWindow.close(); } catch (_) {}
    }
    this.audioCaptureWindow = null;
    this._emit('stopped', 'Голос выключен.');
    return { ok: true, enabled: false };
  }

  shutdown() {
    this.disable();
  }

  registerIpcHandlers(isTrustedRenderer) {
    this.ipcMain.handle('cloud-voice:start', (event) => {
      if (!isTrustedRenderer(event)) return { ok: false, error: 'Access denied.' };
      return this.enable();
    });
    this.ipcMain.handle('cloud-voice:stop', (event) => {
      if (!isTrustedRenderer(event)) return { ok: false, error: 'Access denied.' };
      return this.disable();
    });
    this.ipcMain.handle('cloud-voice:state', (event) => {
      if (!isTrustedRenderer(event)) return { ok: false, error: 'Access denied.' };
      return { ok: true, enabled: this.enabled, phase: this.phase };
    });
    this.ipcMain.on('cloud-voice:audio-capture-pcm', (_event, buffer) => this.onPcm(buffer));
    this.ipcMain.on('cloud-voice:audio-capture-error', (_event, message) => {
      this._emit('error', `Микрофон: ${String(message || 'недоступен').slice(0, 160)}`);
    });
  }
}

module.exports = {
  CloudVoiceService,
  MAX_UTTERANCE_BYTES,
  MAX_WAKE_BUFFER_BYTES,
  containsWakeWord,
  normalizeSpeech,
  pcmRms,
};
