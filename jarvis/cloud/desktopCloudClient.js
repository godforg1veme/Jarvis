const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createRemoteMessage, validateRemoteMessage } = require('../agents/remoteProtocol');

const PUBLIC_STATE_FILE = 'cloud-device.json';
const SECRET_FILE = 'cloud-device.token';
const HEARTBEAT_MS = 30000;
const MAX_RECONNECT_MS = 30000;
const AUTHENTICATION_TIMEOUT_MS = 10000;
const DEFAULT_CLOUD_SERVER_URL = 'https://jarvis.rilora.ru';
const COMMAND_JOURNAL_FILE = 'cloud-command-journal.json';
const MAX_COMMAND_JOURNAL_ENTRIES = 100;

function normalizeServerUrl(value, options = {}) {
  const url = new URL(String(value || '').trim());
  const allowHttp = options.allowHttp === true;
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Server URL must use HTTPS.');
  if (url.protocol === 'http:' && !allowHttp && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Server URL must use HTTPS.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function createClientMessageId() {
  return crypto.randomUUID();
}

function toWebSocketUrl(serverUrl) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/desktop/session`;
  return url.toString();
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

class DesktopCloudClient {
  constructor(options) {
    this.userDataPath = options.userDataPath;
    this.safeStorage = options.safeStorage;
    this.fetch = options.fetch || globalThis.fetch;
    this.WebSocket = options.WebSocket || globalThis.WebSocket;
    this.allowHttp = options.allowHttp === true;
    this.defaultServerUrl = normalizeServerUrl(options.defaultServerUrl || DEFAULT_CLOUD_SERVER_URL, {
      allowHttp: this.allowHttp,
    });
    this.onState = typeof options.onState === 'function' ? options.onState : () => {};
    this.onWorkflowUpdate = typeof options.onWorkflowUpdate === 'function' ? options.onWorkflowUpdate : () => {};
    this.capabilities = options.capabilities || { wakeWord: true, localTts: true, protocolVersion: 1 };
    this.executeRemoteCommand = typeof options.executeRemoteCommand === 'function' ? options.executeRemoteCommand : null;
    this.publicPath = path.join(this.userDataPath, PUBLIC_STATE_FILE);
    this.secretPath = path.join(this.userDataPath, SECRET_FILE);
    this.commandJournalPath = path.join(this.userDataPath, COMMAND_JOURNAL_FILE);
    this.commandJournal = this._readCommandJournal();
    this.publicState = this._readPublicState();
    this.socket = null;
    this.heartbeat = null;
    this.authenticationTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.manuallyStopped = false;
    this.connection = 'unpaired';
  }

  _readPublicState() {
    try {
      const value = safeJsonParse(fs.readFileSync(this.publicPath, 'utf8'), {});
      if (!value || typeof value !== 'object') return {};
      if (!value.serverUrl || !value.deviceId) return {};
      return {
        serverUrl: normalizeServerUrl(value.serverUrl, { allowHttp: this.allowHttp }),
        deviceId: String(value.deviceId).slice(0, 128),
        deviceName: String(value.deviceName || 'Jarvis Desktop').slice(0, 100),
      };
    } catch (_) {
      return {};
    }
  }

  _readToken() {
    try {
      if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) return '';
      const encrypted = fs.readFileSync(this.secretPath);
      return this.safeStorage.decryptString(encrypted);
    } catch (_) {
      return '';
    }
  }

  _readCommandJournal() {
    try {
      const value = safeJsonParse(fs.readFileSync(this.commandJournalPath, 'utf8'), {});
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value)
        .filter(([key, item]) => (/^[a-f0-9-]{36}$/i.test(key) || /^cmd-[a-zA-Z0-9_.:-]{1,128}$/.test(key)) && item && typeof item === 'object')
        .slice(-MAX_COMMAND_JOURNAL_ENTRIES));
    } catch (_) {
      return {};
    }
  }

  _writeCommandJournal() {
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const entries = Object.entries(this.commandJournal).slice(-MAX_COMMAND_JOURNAL_ENTRIES);
    const temporary = `${this.commandJournalPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(Object.fromEntries(entries))}\n`, 'utf8');
    fs.renameSync(temporary, this.commandJournalPath);
  }

  _rememberCommand(commandId, entry) {
    this.commandJournal[commandId] = entry;
    const entries = Object.entries(this.commandJournal).slice(-MAX_COMMAND_JOURNAL_ENTRIES);
    this.commandJournal = Object.fromEntries(entries);
    this._writeCommandJournal();
  }

  _writeCredentials({ serverUrl, device, token }) {
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure Windows credential storage is unavailable.');
    }
    const state = {
      serverUrl: normalizeServerUrl(serverUrl, { allowHttp: this.allowHttp }),
      deviceId: String(device.id),
      deviceName: String(device.name || 'Jarvis Desktop').slice(0, 100),
    };
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const temporaryState = `${this.publicPath}.${process.pid}.tmp`;
    const temporaryToken = `${this.secretPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryState, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.writeFileSync(temporaryToken, this.safeStorage.encryptString(String(token)));
    fs.renameSync(temporaryState, this.publicPath);
    fs.renameSync(temporaryToken, this.secretPath);
    this.publicState = state;
  }

  _emitState(extra = {}) {
    this.onState({
      paired: this.isPaired(),
      connection: this.connection,
      serverUrl: this.publicState.serverUrl || '',
      defaultServerUrl: this.defaultServerUrl,
      deviceId: this.publicState.deviceId || '',
      deviceName: this.publicState.deviceName || '',
      ...extra,
    });
  }

  isPaired() {
    return Boolean(this.publicState.serverUrl && this.publicState.deviceId && this._readToken());
  }

  getState() {
    return {
      paired: this.isPaired(),
      connection: this.connection,
      serverUrl: this.publicState.serverUrl || '',
      defaultServerUrl: this.defaultServerUrl,
      deviceId: this.publicState.deviceId || '',
      deviceName: this.publicState.deviceName || '',
    };
  }

  async _request(urlPath, options = {}) {
    const token = this._readToken();
    if (!token || !this.publicState.serverUrl) throw new Error('Desktop is not paired.');
    const response = await this.fetch(`${this.publicState.serverUrl}${urlPath}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const body = safeJsonParse(await response.text(), {});
    if (!response.ok || !body.ok) {
      const error = new Error(body && body.code ? body.code : 'Cloud request failed.');
      error.code = body && body.code;
      error.statusCode = response.status;
      throw error;
    }
    return body;
  }

  async pair({ serverUrl, pairingCode, capabilities }) {
    const normalizedUrl = normalizeServerUrl(serverUrl, { allowHttp: this.allowHttp });
    const response = await this.fetch(`${normalizedUrl}/v1/desktop/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: String(pairingCode || '').trim(), capabilities: capabilities || this.capabilities }),
    });
    const body = safeJsonParse(await response.text(), {});
    if (!response.ok || !body.ok || !body.token || !body.device) {
      const error = new Error(body && body.code ? body.code : 'Pairing failed.');
      error.code = body && body.code;
      throw error;
    }
    this._writeCredentials({ serverUrl: normalizedUrl, device: body.device, token: body.token });
    this.connection = 'offline';
    this.manuallyStopped = false;
    this._emitState();
    this.startSession();
    return this.getState();
  }

  async sendText(text, clientMessageId = createClientMessageId()) {
    const body = await this._request('/v1/desktop/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientMessageId, text: String(text || '').trim() }),
    });
    return body;
  }

  async sendVoice(audio, options = {}) {
    const clientMessageId = options.clientMessageId || createClientMessageId();
    const mimeType = options.mimeType || 'audio/wav';
    const payload = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []);
    return this._request('/v1/desktop/voice', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Jarvis-Audio-Mime': mimeType,
        'X-Jarvis-Client-Message-Id': clientMessageId,
      },
      body: payload,
    });
  }

  async createRemoteCommand({ deviceId, action, args = {} }) {
    return this._request('/v1/desktop/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, action, args }),
    });
  }

  async getRemoteCommand(commandId) {
    return this._request(`/v1/desktop/commands/${encodeURIComponent(String(commandId || ''))}`);
  }

  async approveRemoteCommand(commandId) {
    return this._request(`/v1/desktop/commands/${encodeURIComponent(String(commandId || ''))}/approve`, { method: 'POST' });
  }

  async rejectRemoteCommand(commandId) {
    return this._request(`/v1/desktop/commands/${encodeURIComponent(String(commandId || ''))}/reject`, { method: 'POST' });
  }

  _clearSessionTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.authenticationTimer) clearTimeout(this.authenticationTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.authenticationTimer = null;
    this.reconnectTimer = null;
  }

  _sendSessionMessage(type, payload) {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(createRemoteMessage(type, payload)));
  }

  startSession() {
    this.manuallyStopped = false;
    this._clearSessionTimers();
    if (!this.isPaired() || !this.WebSocket) {
      this.connection = this.isPaired() ? 'offline' : 'unpaired';
      this._emitState();
      return;
    }
    this.connection = 'connecting';
    this._emitState();
    try {
      this.socket = new this.WebSocket(toWebSocketUrl(this.publicState.serverUrl));
    } catch (_) {
      this._scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => {
      const token = this._readToken();
      if (!token) {
        try { this.socket.close(1008, 'missing device credential'); } catch (_) {}
        return;
      }
      this._sendSessionMessage('device.hello', {
        deviceId: this.publicState.deviceId,
        token,
        name: this.publicState.deviceName,
      });
      this.authenticationTimer = setTimeout(() => {
        if (this.socket) {
          try { this.socket.close(1008, 'authentication timeout'); } catch (_) {}
        }
      }, AUTHENTICATION_TIMEOUT_MS);
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try {
        message = validateRemoteMessage(safeJsonParse(String(event.data || ''), null));
      } catch (_) {
        this._emitState({ lastError: 'INVALID_REMOTE_MESSAGE' });
        return;
      }
      if (message.type === 'device.welcome' && message.payload && message.payload.deviceId === this.publicState.deviceId) {
        if (this.authenticationTimer) clearTimeout(this.authenticationTimer);
        this.authenticationTimer = null;
        this.connection = 'online';
        this.reconnectDelay = 1000;
        this._emitState();
        this._sendSessionMessage('device.capabilities', { actions: this.capabilities.localActions || [] });
        this._sendSessionMessage('device.heartbeat', {});
        this.heartbeat = setInterval(() => this._sendSessionMessage('device.heartbeat', {}), HEARTBEAT_MS);
      } else if (message.type === 'command.execute') {
        void this._handleRemoteCommand(message);
      } else if (message.type === 'command.cancel') {
        this._emitState({ lastError: 'REMOTE_COMMAND_CANCEL_REQUESTED' });
      } else if (message.type === 'workflow.update') {
        this.onWorkflowUpdate({
          workflowId: message.payload.workflowId,
          status: message.payload.status,
          answer: message.payload.answer,
        });
      } else if (message.type === 'server.error') {
        this._emitState({ lastError: message.payload && message.payload.code });
      }
    });
    this.socket.addEventListener('close', () => {
      this.socket = null;
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.authenticationTimer) clearTimeout(this.authenticationTimer);
      this.heartbeat = null;
      this.authenticationTimer = null;
      if (!this.manuallyStopped) this._scheduleReconnect();
    });
    this.socket.addEventListener('error', () => {});
  }

  async _handleRemoteCommand(message) {
    const payload = message.payload || {};
    const commandId = payload.commandId;
    const cached = this.commandJournal[commandId];
    if (cached) {
      const result = cached.status === 'completed'
        ? cached.result
        : { ok: false, executionUnknown: true, error: 'Previous command execution state is unknown.' };
      this._sendSessionMessage('command.result', { commandId, result });
      return;
    }

    const actions = Array.isArray(this.capabilities.localActions) ? this.capabilities.localActions : [];
    if (!actions.includes(payload.action)) {
      const result = { ok: false, action: payload.action, error: 'Action is not available on this Desktop.' };
      this._rememberCommand(commandId, { status: 'completed', result });
      this._sendSessionMessage('command.result', { commandId, result });
      return;
    }

    try {
      this._rememberCommand(commandId, { status: 'running', action: payload.action });
    } catch (_) {
      const result = {
        ok: false,
        action: payload.action,
        error: 'Desktop command journal is unavailable; command was not executed.',
      };
      this._sendSessionMessage('command.result', { commandId, result });
      return;
    }
    let result;
    try {
      if (!this.executeRemoteCommand) throw new Error('Desktop command executor is unavailable.');
      result = await this.executeRemoteCommand({
        requestId: commandId,
        action: payload.action,
        args: payload.args || {},
      }, {
        confirmed: payload.confirmed === true,
        strongConfirmed: payload.strongConfirmed === true,
      });
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        result = { ok: false, action: payload.action, error: 'Desktop returned an invalid command result.' };
      }
      if (result.requiresConfirmation || result.requiresStrongConfirmation) {
        result = { ok: false, action: payload.action, error: 'Server confirmation did not satisfy local policy.' };
      }
    } catch (error) {
      result = { ok: false, action: payload.action, error: String(error && error.message || 'Desktop command failed').slice(0, 500) };
    }
    try {
      this._rememberCommand(commandId, { status: 'completed', action: payload.action, result });
    } catch (_) {
      result = {
        ok: false,
        action: payload.action,
        executionUnknown: true,
        error: 'Command completed but its local journal could not be updated.',
      };
    }
    this._sendSessionMessage('command.result', { commandId, result });
  }

  _scheduleReconnect() {
    if (this.manuallyStopped || this.reconnectTimer) return;
    this.connection = 'offline';
    this._emitState();
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(MAX_RECONNECT_MS, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startSession();
    }, delay);
  }

  stopSession() {
    this.manuallyStopped = true;
    this._clearSessionTimers();
    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
      this.socket = null;
    }
    this.connection = this.isPaired() ? 'offline' : 'unpaired';
    this._emitState();
  }
}

module.exports = {
  DEFAULT_CLOUD_SERVER_URL,
  DesktopCloudClient,
  HEARTBEAT_MS,
  MAX_RECONNECT_MS,
  AUTHENTICATION_TIMEOUT_MS,
  COMMAND_JOURNAL_FILE,
  createClientMessageId,
  normalizeServerUrl,
  toWebSocketUrl,
};
