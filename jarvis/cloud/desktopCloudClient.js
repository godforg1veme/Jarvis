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
const VPN_EXPORT_DIR = 'vpn-exports';

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
    this.onLifeProposal = typeof options.onLifeProposal === 'function' ? options.onLifeProposal : () => {};
    this.onLifeReminder = typeof options.onLifeReminder === 'function' ? options.onLifeReminder : () => {};
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
    if (body.vpnArtifact) {
      body.vpnArtifact = this._saveVpnArtifact(body.vpnArtifact);
      body.answer = `${String(body.answer || '').trim()}\nФайл Happ: ${body.vpnArtifact.path}`.trim();
    }
    return body;
  }

  _saveVpnArtifact(artifact) {
    if (!artifact || artifact.kind !== 'happ-vless') throw new Error('Invalid VPN artifact.');
    const filename = String(artifact.filename || '');
    const content = String(artifact.content || '');
    if (!/^[A-Za-zА-Яа-яЁё0-9_. -]{1,80}\.txt$/u.test(filename) || !content.startsWith('vless://') || content.length > 4096) {
      throw new Error('Invalid VPN artifact.');
    }
    const directory = path.join(this.userDataPath, VPN_EXPORT_DIR);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, filename);
    if (path.dirname(target) !== directory) throw new Error('Invalid VPN artifact path.');
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
    return { kind: artifact.kind, filename, path: target };
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

  async transcribeVoice(audio, options = {}) {
    const clientMessageId = options.clientMessageId || createClientMessageId();
    const mimeType = options.mimeType || 'audio/wav';
    const payload = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []);
    return this._request('/v1/desktop/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': mimeType, 'X-Jarvis-Audio-Mime': mimeType, 'X-Jarvis-Client-Message-Id': clientMessageId },
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

  async getLifeBootstrap() { return this._request('/v1/desktop/life/bootstrap'); }
  async getMissionControl() { return this._request('/v1/desktop/life/mission-control'); }
  async getLifeTimeline({ projectId = '', cursor = '', limit = 40 } = {}) {
    const query = new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 40, 1), 100)) });
    if (projectId) query.set('projectId', String(projectId));
    if (cursor) query.set('cursor', String(cursor).slice(0, 512));
    return this._request(`/v1/desktop/life/timeline?${query}`);
  }
  async createLifeProject(input) {
    return this._request('/v1/desktop/life/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async updateLifeProject(projectId, input) {
    return this._request(`/v1/desktop/life/projects/${encodeURIComponent(String(projectId || ''))}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async getLifeProjectContext(projectId) {
    return this._request(`/v1/desktop/life/projects/${encodeURIComponent(String(projectId || ''))}/context`);
  }
  async recordLifeFeedback(eventId, input) {
    return this._request(`/v1/desktop/life/events/${encodeURIComponent(String(eventId || ''))}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async confirmLifeProposal(proposalId, revision) {
    return this._request(`/v1/desktop/life/proposals/${encodeURIComponent(String(proposalId || ''))}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
    });
  }
  async dismissLifeProposal(proposalId, revision) {
    return this._request(`/v1/desktop/life/proposals/${encodeURIComponent(String(proposalId || ''))}/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
    });
  }
  async updateLifeCommitment(commitmentId, revision, status) {
    return this._request(`/v1/desktop/life/commitments/${encodeURIComponent(String(commitmentId || ''))}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, status }),
    });
  }
  async getLifeReminders(state = '') {
    const query = state ? `?state=${encodeURIComponent(String(state))}` : '';
    return this._request(`/v1/desktop/life/reminders${query}`);
  }
  async rescheduleLifeReminder(reminderId, input) {
    return this._request(`/v1/desktop/life/reminders/${encodeURIComponent(String(reminderId || ''))}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async mutateLifeReminder(reminderId, action, revision) {
    return this._request(`/v1/desktop/life/reminders/${encodeURIComponent(String(reminderId || ''))}/${encodeURIComponent(String(action || ''))}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
    });
  }
  async setLifeMissionIntent(action, projectId, input) {
    return this._request(`/v1/desktop/life/missions/${encodeURIComponent(String(projectId || ''))}/${encodeURIComponent(String(action || ''))}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async getLifeMode() { return this._request('/v1/desktop/life/mode'); }
  async setLifeMode(input) {
    return this._request('/v1/desktop/life/mode', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async getLifePreferences() { return this._request('/v1/desktop/life/preferences'); }
  async setLifePreference(key, input) {
    return this._request(`/v1/desktop/life/preferences/${encodeURIComponent(String(key || ''))}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async resetLifePreference(key, revision) {
    return this._request(`/v1/desktop/life/preferences/${encodeURIComponent(String(key || ''))}/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
    });
  }
  async deleteLifePreference(key, revision) {
    return this._request(`/v1/desktop/life/preferences/${encodeURIComponent(String(key || ''))}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
    });
  }
  async getLifePeople(includeArchived = false) { return this._request(`/v1/desktop/life/people?includeArchived=${includeArchived === true}`); }
  async createLifePerson(input) {
    return this._request('/v1/desktop/life/people', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async getLifeRelationships(personId = '') {
    const query = personId ? `?personId=${encodeURIComponent(String(personId))}` : '';
    return this._request(`/v1/desktop/life/relationships${query}`);
  }
  async getLifePersonProjectLinks({ projectId = '', personId = '' } = {}) {
    const query = new URLSearchParams();
    if (projectId) query.set('projectId', String(projectId));
    if (personId) query.set('personId', String(personId));
    return this._request(`/v1/desktop/life/person-project-links${query.size ? `?${query}` : ''}`);
  }
  async getLifeFamilyGrants({ memberUserId = '', includeInactive = false } = {}) {
    const query = new URLSearchParams({ includeInactive: String(includeInactive === true) });
    if (memberUserId) query.set('memberUserId', String(memberUserId));
    return this._request(`/v1/desktop/life/family-grants?${query}`);
  }
  async getLifeFamilyShared() { return this._request('/v1/desktop/life/family/shared'); }
  async createLifeRecoveryPlan(projectId, sourceContextRevision) {
    return this._request(`/v1/desktop/life/projects/${encodeURIComponent(String(projectId || ''))}/recovery-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceContextRevision }),
    });
  }
  async getLifeRecoveryPlan(planId) { return this._request(`/v1/desktop/life/recovery-plans/${encodeURIComponent(String(planId || ''))}`); }
  async proposeLifeRecoveryPlan(planId, revision) {
    return this._request(`/v1/desktop/life/recovery-plans/${encodeURIComponent(String(planId || ''))}/propose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
    });
  }
  async getLifeSources() { return this._request('/v1/desktop/life/sources'); }
  async createLifeSource(input) {
    return this._request('/v1/desktop/life/sources', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async updateLifeSource(sourceId, input) {
    return this._request(`/v1/desktop/life/sources/${encodeURIComponent(String(sourceId || ''))}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }
  async syncLifeSource(sourceId) {
    return this._request(`/v1/desktop/life/sources/${encodeURIComponent(String(sourceId || ''))}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  }

  async createVisionLease({ sources, durationMs }) {
    return this._request('/v1/vision/leases', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources, ...(durationMs ? { durationMs } : {}) }),
    });
  }

  async createVisionCaptureRequest(leaseId, input) {
    return this._request(`/v1/vision/leases/${encodeURIComponent(String(leaseId || ''))}/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  }

  async sendVisionFrame(leaseId, metadata, image, options = {}) {
    const payload = Buffer.isBuffer(image) ? image : Buffer.from(image || []);
    return this._request(`/v1/vision/leases/${encodeURIComponent(String(leaseId || ''))}/frames`, {
      method: 'POST',
      headers: {
        'Content-Type': metadata.contentType,
        'X-Jarvis-Vision-Metadata': Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url'),
      },
      body: payload,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  async stopVisionLease(leaseId) {
    return this._request(`/v1/vision/leases/${encodeURIComponent(String(leaseId || ''))}`, { method: 'DELETE' });
  }

  async setVisionSensitiveConsent(leaseId, sourceId, allow) {
    return this._request(`/v1/vision/leases/${encodeURIComponent(String(leaseId || ''))}/sensitive-consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, allow: allow === true }),
    });
  }

  async listVisionMemories(limit = 50) { return this._request(`/v1/vision/memories?limit=${Math.min(Math.max(Number(limit) || 50, 1), 100)}`); }
  async getVisionMemory(memoryId) { return this._request(`/v1/vision/memories/${encodeURIComponent(String(memoryId || ''))}`); }
  async updateVisionMemory(memoryId, patch) {
    return this._request(`/v1/vision/memories/${encodeURIComponent(String(memoryId || ''))}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
  }
  async deleteVisionMemory(memoryId) { return this._request(`/v1/vision/memories/${encodeURIComponent(String(memoryId || ''))}`, { method: 'DELETE' }); }

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
      } else if (message.type === 'life.proposal') {
        this.onLifeProposal({
          proposalId: message.payload.proposalId,
          title: message.payload.title,
          explanation: message.payload.explanation,
          risk: message.payload.risk,
        });
      } else if (message.type === 'life.reminder') {
        this.onLifeReminder({
          reminderId: message.payload.reminderId,
          title: message.payload.title,
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
  VPN_EXPORT_DIR,
  createClientMessageId,
  normalizeServerUrl,
  toWebSocketUrl,
};
