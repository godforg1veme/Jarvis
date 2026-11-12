const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_NAME = 'cloud-workspace-pending.json';
const MAX_ENTRIES = 500;
const KINDS = Object.freeze(['memory', 'personal-documents', 'personal-devices', 'personal-life',
  'job-resumes', 'job-login']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function failure(code, details = {}) { return Object.assign(new Error(code), { code, ...details }); }

function validServerUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && url.origin !== 'null';
  } catch (_) { return false; }
}

function validScope(serverUrl, deviceId) {
  return validServerUrl(serverUrl) && typeof deviceId === 'string'
    && /^[A-Za-z0-9_.:-]{1,128}$/.test(deviceId);
}

function validEntry(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).sort().join(',') === 'deviceId,id,kind,serverUrl'
    && validScope(entry.serverUrl, entry.deviceId)
    && KINDS.includes(entry.kind) && typeof entry.id === 'string' && UUID.test(entry.id);
}

function key(entry) { return `${entry.serverUrl}\n${entry.deviceId}\n${entry.kind}`; }
function digest(entries) { return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'); }

class WorkspacePendingStore {
  constructor(userDataPath) {
    this.path = path.join(userDataPath, FILE_NAME);
    this.revision = null;
    this.entries = [];
    this.error = null;
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'checksum,entries,version'
        || value.version !== 1 || !Array.isArray(value.entries)
        || value.entries.length > MAX_ENTRIES || !value.entries.every(validEntry)
        || new Set(value.entries.map(key)).size !== value.entries.length
        || value.checksum !== digest(value.entries)) throw new Error('Invalid pending store');
      this.entries = value.entries;
      this.revision = raw;
    } catch (error) {
      if (error.code !== 'ENOENT') this.error = 'WORKSPACE_PENDING_STORE_UNAVAILABLE';
    }
  }

  _checkFresh() {
    if (this.error) throw failure(this.error);
    try {
      let current = null;
      try { current = fs.readFileSync(this.path, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT' || this.revision !== null) throw error; }
      if (current !== this.revision) throw new Error('Store changed');
    } catch (_) {
      this.error = 'WORKSPACE_PENDING_STORE_UNAVAILABLE';
      throw failure(this.error);
    }
  }

  _write(entries) {
    this._checkFresh();
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      const raw = `${JSON.stringify({ version: 1, entries, checksum: digest(entries) })}\n`;
      const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, raw, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, this.path);
      } finally { try { fs.unlinkSync(temporary); } catch (_) {} }
      this.revision = raw;
      this.entries = entries;
    } catch (_) {
      this.error = 'WORKSPACE_PENDING_STORE_UNAVAILABLE';
      throw failure(this.error);
    }
  }

  list(serverUrl, deviceId) {
    if (!validScope(serverUrl, deviceId)) throw failure('INVALID_WORKSPACE_SCOPE');
    this._checkFresh();
    return this.entries.filter((entry) => entry.serverUrl === serverUrl && entry.deviceId === deviceId)
      .map(({ kind, id }) => ({ kind, id }));
  }

  claim(serverUrl, deviceId, kind, id) {
    const entry = { serverUrl, deviceId, kind, id };
    if (!validEntry(entry)) throw failure('INVALID_WORKSPACE_OPERATION');
    this._checkFresh();
    const previous = this.entries.find((item) => key(item) === key(entry));
    if (previous) {
      if (previous.id === id) return;
      throw failure('PENDING_OPERATION_EXISTS', { pendingId: previous.id });
    }
    if (this.entries.length >= MAX_ENTRIES) throw failure('WORKSPACE_PENDING_STORE_FULL');
    this._write([...this.entries, entry]);
  }

  settle(serverUrl, deviceId, kind, id) {
    const entry = { serverUrl, deviceId, kind, id };
    if (!validEntry(entry)) throw failure('INVALID_WORKSPACE_OPERATION');
    this._checkFresh();
    const exists = this.entries.some((item) => key(item) === key(entry) && item.id === id);
    if (!exists) return;
    this._write(this.entries.filter((item) => !(key(item) === key(entry) && item.id === id)));
  }
}

module.exports = { WorkspacePendingStore, FILE_NAME, MAX_ENTRIES, KINDS };
