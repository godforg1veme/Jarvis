const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID } = require('./rpcProtocol');
const { validPng } = require('./captchaTelegramBrowser');
const { normalizeAnswer } = require('./captchaTelegramProtocol');
const { MAX_AUTOMATIC_ATTEMPTS } = require('./captchaLimits');
const MAX_RECORDS = 64, TTL_MS = 48 * 3600000, MAX_BYTES = 354000;
const PHASES = ['image_saved', 'answer_saved', 'ocr_invalid', 'ocr_failed', 'dispatch_started', 'solved',
  'new_challenge', 'unknown', 'stale', 'already_used', 'submission_failed'];
const VERIFICATIONS = ['captcha', 'verified', 'unconfirmed'];
const denied = () => Object.assign(new Error('JOB_CAPTCHA_EVIDENCE_UNAVAILABLE'), { code: 'JOB_CAPTCHA_EVIDENCE_UNAVAILABLE' });
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function validate(v, ownerId) {
  if (!exact(v, ['version', 'ownerId', 'id', 'recoveryId', 'attempt', 'createdAt', 'updatedAt', 'pngBase64', 'answer', 'phase', 'receipt'])
    || v.version !== 1 || v.ownerId !== ownerId || !UUID.test(v.id || '') || !UUID.test(v.recoveryId || '')
    || !Number.isInteger(v.attempt) || v.attempt < 1 || v.attempt > MAX_AUTOMATIC_ATTEMPTS
    || !Number.isSafeInteger(v.createdAt) || v.createdAt < 0 || !Number.isSafeInteger(v.updatedAt) || v.updatedAt < v.createdAt
    || !PHASES.includes(v.phase) || v.answer !== null && (typeof v.answer !== 'string' || normalizeAnswer(v.answer) !== v.answer)
    || typeof v.pngBase64 !== 'string' || v.pngBase64.length > 349528) throw denied();
  const png = Buffer.from(v.pngBase64, 'base64');
  if (png.toString('base64') !== v.pngBase64 || !validPng(png)) throw denied();
  if (v.receipt !== null && (!exact(v.receipt, ['received', 'permitted', 'httpStatus', 'verification'])
    || typeof v.receipt.received !== 'boolean' || ![0, 1].includes(v.receipt.permitted)
    || v.receipt.httpStatus !== null && (!Number.isInteger(v.receipt.httpStatus) || v.receipt.httpStatus < 100 || v.receipt.httpStatus > 599)
    || !VERIFICATIONS.includes(v.receipt.verification))) throw denied();
  return v;
}
class CaptchaAttemptStore {
  constructor({ root, ownerId, now = Date.now }) {
    if (process.platform !== 'linux' || !path.isAbsolute(root || '') || !UUID.test(ownerId || '')) throw denied();
    Object.assign(this, { root, ownerId, now }); this.tail = Promise.resolve();
  }
  run(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async directory() {
    await fs.mkdir(this.root, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw denied(); });
    const s = await fs.lstat(this.root);
    if (!s.isDirectory() || s.uid !== process.getuid() || s.mode & 0o077) throw denied();
    // The owner binding is required even for an otherwise empty archive.
    const binding = path.join(this.root, 'owner.json');
    await fs.writeFile(binding, JSON.stringify({ ownerId: this.ownerId }), { flag: 'wx', mode: 0o600 })
      .catch(e => { if (e.code !== 'EEXIST') throw denied(); });
    const bytes = await this.readFile(binding, 256);
    const value = JSON.parse(bytes.toString('utf8'));
    if (!exact(value, ['ownerId']) || value.ownerId !== this.ownerId) throw denied();
  }
  async readFile(file, max = MAX_BYTES) {
    let h;
    try {
      h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const s = await h.stat();
      if (!s.isFile() || s.uid !== process.getuid() || s.mode & 0o077 || s.size > max) throw denied();
      const b = Buffer.alloc(max + 1), r = await h.read(b, 0, b.length, 0);
      if (r.bytesRead > max) throw denied();
      return b.subarray(0, r.bytesRead);
    } finally { await h?.close(); }
  }
  file(id) { if (!UUID.test(id || '')) throw denied(); return path.join(this.root, `${id}.json`); }
  async read(id) {
    const value = validate(JSON.parse((await this.readFile(this.file(id))).toString('utf8')), this.ownerId);
    if (value.id !== id) throw denied();
    return value;
  }
  async records() {
    await this.directory();
    const names = await fs.readdir(this.root);
    if (names.length > MAX_RECORDS * 2 + 2) throw denied();
    const records = [];
    for (const name of names) {
      if (name === 'owner.json') continue;
      if (name.startsWith('.pending-') && UUID.test(name.slice(9))) {
        // An export may overlap the writer. Never unlink an in-flight file.
        await this.readFile(path.join(this.root, name));
        continue;
      }
      if (!UUID.test(name.slice(0, -5)) || !name.endsWith('.json')) throw denied();
      records.push(await this.read(name.slice(0, -5)));
    }
    return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  async pruneRecords(reserve = 0) {
    const records = await this.records(), cutoff = this.now() - TTL_MS;
    for (const name of await fs.readdir(this.root)) {
      if (!name.startsWith('.pending-') || !UUID.test(name.slice(9))) continue;
      const file = path.join(this.root, name), stat = await fs.lstat(file);
      if (stat.mtimeMs <= cutoff) await fs.unlink(file);
    }
    const keep = records.filter(v => v.createdAt > cutoff).slice(-(MAX_RECORDS - reserve));
    const ids = new Set(keep.map(v => v.id));
    for (const v of records) if (!ids.has(v.id)) await fs.unlink(this.file(v.id));
    return keep;
  }
  async write(value) {
    validate(value, this.ownerId);
    const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > MAX_BYTES) throw denied();
    const temp = path.join(this.root, `.pending-${randomUUID()}`); let h;
    try {
      h = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await h.writeFile(bytes); await h.sync(); await h.close(); h = null;
      await fs.rename(temp, this.file(value.id));
      const dir = await fs.open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await dir.sync(); } finally { await dir.close(); }
    } finally { await h?.close(); await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw denied(); }); }
    return value;
  }
  async start({ recoveryId, attempt, pngBase64 }) {
    return this.run(async () => {
    await this.pruneRecords(1);
    const createdAt = this.now();
    return this.write({ version: 1, ownerId: this.ownerId, id: randomUUID(), recoveryId, attempt,
      createdAt, updatedAt: createdAt, pngBase64, answer: null, phase: 'image_saved', receipt: null });
    });
  }
  async update(id, patch) {
    return this.run(async () => {
    if (!patch || Object.keys(patch).some(k => !['answer', 'phase', 'receipt'].includes(k))) throw denied();
    await this.directory();
    const value = await this.read(id);
    return this.write({ ...value, ...patch, updatedAt: Math.max(value.createdAt, this.now()) });
    });
  }
  async prune() { return this.run(() => this.pruneRecords()); }
  async export() {
    return this.run(async () => (await this.records()).filter(v => v.createdAt > this.now() - TTL_MS).slice(-MAX_RECORDS));
  }
}
module.exports = { CaptchaAttemptStore, validate, MAX_RECORDS, TTL_MS, MAX_BYTES };
