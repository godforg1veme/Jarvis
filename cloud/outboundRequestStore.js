const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = 'cloud-outbound-requests.json';
// Preserve the existing Desktop clientMessageId wire grammar; default IDs are UUIDs.
const ID_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;
function validId(id) { return typeof id === 'string' && ID_RE.test(id); }
function validEntry(entry) {
  let urlValid = false;
  try {
    const url = new URL(entry?.serverUrl);
    urlValid = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && url.origin !== 'null';
  } catch (_) {}
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).sort().join(',') === 'clientMessageId,createdAt,deviceId,kind,serverUrl'
    && validId(entry.clientMessageId) && ['text', 'voice'].includes(entry.kind)
    && typeof entry.createdAt === 'string' && !Number.isNaN(Date.parse(entry.createdAt))
    && typeof entry.deviceId === 'string' && entry.deviceId.length > 0 && entry.deviceId.length <= 128
    && typeof entry.serverUrl === 'string' && entry.serverUrl.length > 0 && entry.serverUrl.length <= 2048 && urlValid;
}
function digest(entries) { return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'); }

class OutboundRequestStore {
  constructor(userDataPath) {
    this.path = path.join(userDataPath, FILE_NAME);
    this.revision = null;
    this.error = null;
    this.readable = true;
    this.entries = [];
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.entries) || !data.entries.every(validEntry)
        || new Set(data.entries.map((entry) => entry.clientMessageId)).size !== data.entries.length
        || data.checksum !== digest(data.entries)) throw new Error('Corrupt outbound store');
      this.entries = data.entries;
      this.revision = raw;
    } catch (error) {
      if (error.code !== 'ENOENT') { this.error = 'OUTBOUND_STORE_UNAVAILABLE'; this.readable = false; }
    }
  }

  list(serverUrl, deviceId) {
    if (!this.readable) throw Object.assign(new Error(this.error), { code: this.error });
    return this.entries.filter((entry) => entry.serverUrl === serverUrl && entry.deviceId === deviceId)
      .map(({ clientMessageId, kind, createdAt }) => ({ clientMessageId, kind, createdAt }));
  }

  _write(entries) {
    if (this.error) throw Object.assign(new Error(this.error), { code: this.error });
    try {
      let current = null;
      try { current = fs.readFileSync(this.path, 'utf8'); } catch (error) {
        if (error.code !== 'ENOENT' || this.revision !== null) throw error;
      }
      if (current !== this.revision) throw new Error('Store changed');
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
      this.error = 'OUTBOUND_STORE_UNAVAILABLE';
      throw Object.assign(new Error(this.error), { code: this.error });
    }
  }

  claim(entry) {
    if (!validEntry(entry)) throw Object.assign(new Error('INVALID_CLIENT_MESSAGE_ID'), { code: 'INVALID_CLIENT_MESSAGE_ID' });
    if (this.entries.some((item) => item.clientMessageId === entry.clientMessageId)) {
      throw Object.assign(new Error('REQUEST_ID_ALREADY_CLAIMED'), { code: 'REQUEST_ID_ALREADY_CLAIMED' });
    }
    this._write([...this.entries, entry]);
  }

  acknowledge(id, serverUrl, deviceId) {
    if (!validId(id)) throw Object.assign(new Error('INVALID_CLIENT_MESSAGE_ID'), { code: 'INVALID_CLIENT_MESSAGE_ID' });
    const found = this.entries.find((item) => item.clientMessageId === id);
    if (!found || found.serverUrl !== serverUrl || found.deviceId !== deviceId) {
      throw Object.assign(new Error('REQUEST_NOT_FOUND'), { code: 'REQUEST_NOT_FOUND' });
    }
    this._write(this.entries.filter((item) => item.clientMessageId !== id));
  }
}

module.exports = { OutboundRequestStore, validId, FILE_NAME };
