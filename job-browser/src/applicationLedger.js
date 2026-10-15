const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { UUID } = require('./rpcProtocol');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const failure = (code = 'JOB_BROWSER_LEDGER_UNAVAILABLE') => Object.assign(new Error(code), { code });
const HASH = /^[a-f\d]{64}$/;

// Immutable claims and results survive restarts. An uncertain claim is never executable again.
class ApplicationLedger {
  constructor({ root, ownerId }) {
    if (process.platform !== 'linux' || !path.isAbsolute(root || '') || !UUID.test(ownerId || '')) throw failure();
    this.root = root; this.ownerId = ownerId;
  }
  async directory() {
    try { await fs.mkdir(this.root, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw failure(); }
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw failure();
  }
  location(kind, digest) {
    if (!['operation', 'pair', 'result'].includes(kind) || !HASH.test(digest)) throw failure();
    return path.join(this.root, `${kind}-${digest}.json`);
  }
  async syncDirectory() {
    const handle = await fs.open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async read(kind, digest) {
    let handle;
    try {
      handle = await fs.open(this.location(kind, digest), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 4096) throw failure();
      const buffer = Buffer.alloc(4097), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) throw failure();
      return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw failure();
    } finally { await handle?.close(); }
  }
  async write(kind, digest, value) {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 4096) throw failure();
    const staging = path.join(this.root, `.pending-${randomUUID()}`);
    let handle, fresh = false;
    try {
      handle = await fs.open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(body, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      // link publishes an already complete file without replacing another process's claim.
      await fs.link(staging, this.location(kind, digest)); fresh = true;
      await this.syncDirectory();
    } catch (error) {
      if (error.code !== 'EEXIST') throw failure();
    } finally {
      await handle?.close();
      await fs.unlink(staging).catch((error) => { if (error.code !== 'ENOENT') throw failure(); });
    }
    return fresh;
  }
  identity({ userId, operationId, externalId, resumeId }) {
    if (userId !== this.ownerId || !UUID.test(operationId || '') || typeof externalId !== 'string'
      || !/^\d{1,20}$/.test(externalId) || typeof resumeId !== 'string' || !/^[a-zA-Z0-9]{1,100}$/.test(resumeId)) throw failure('JOB_BROWSER_ACCESS_DENIED');
    return { version: 1, ownerId: this.ownerId, operationId,
      operationHash: hash(JSON.stringify([this.ownerId, operationId])),
      pairHash: hash(JSON.stringify([this.ownerId, externalId, resumeId])) };
  }
  validateClaim(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'letterHash,operationHash,operationId,ownerId,pairHash,version'
      || value.version !== 1 || value.ownerId !== this.ownerId || !UUID.test(value.operationId || '')
      || !HASH.test(value.pairHash || '') || !HASH.test(value.letterHash || '')
      || value.operationHash !== hash(JSON.stringify([this.ownerId, value.operationId]))) throw failure();
    return value;
  }
  same(left, right) { return ['ownerId', 'operationId', 'operationHash', 'pairHash', 'letterHash'].every((key) => left[key] === right[key]); }
  async result(identity) {
    const result = await this.read('result', identity.operationHash);
    if (!result) return { outcome: 'unknown' };
    if (!this.same(this.validateClaim(result.claim), identity)
      || !['sent', 'failed', 'manual_required', 'already_applied'].includes(result.outcome)
      || (result.outcome === 'sent' && !/^[\w-]{1,128}$/.test(result.externalId || ''))) throw failure();
    return { outcome: result.outcome, verified: true, ...(result.outcome === 'sent' ? { externalId: result.externalId } : {}) };
  }
  async reserve(input) {
    const identity = this.identity(input);
    if (typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) throw failure('JOB_INVALID_DRAFT');
    const claim = { ...identity, letterHash: hash(input.letter) };
    await this.directory();
    const fresh = await this.write('operation', claim.operationHash, claim);
    if (!fresh) {
      const old = this.validateClaim(await this.read('operation', claim.operationHash));
      if (!this.same(old, claim)) throw failure('JOB_BROWSER_OPERATION_CHANGED');
      return { execute: false, ...await this.lookup(input) };
    }
    if (!await this.write('pair', claim.pairHash, claim)) {
      this.validateClaim(await this.read('pair', claim.pairHash));
      return { execute: false, outcome: 'unknown' };
    }
    return { execute: true, outcome: 'unknown' };
  }
  async lookup(input) {
    const identity = this.identity(input); await this.directory();
    const operation = await this.read('operation', identity.operationHash);
    if (!operation) return { outcome: 'unknown' };
    const claim = this.validateClaim(operation);
    if (claim.pairHash !== identity.pairHash) throw failure('JOB_BROWSER_OPERATION_CHANGED');
    if (input.letter !== undefined && (typeof input.letter !== 'string' || hash(input.letter) !== claim.letterHash)) throw failure('JOB_BROWSER_OPERATION_CHANGED');
    const pair = await this.read('pair', identity.pairHash);
    if (!pair) return { outcome: 'unknown' };
    if (!this.same(this.validateClaim(pair), claim)) return { outcome: 'unknown' };
    return this.result(claim);
  }
  async hasClaim(input) {
    const identity = this.identity(input); await this.directory();
    const operation = await this.read('operation', identity.operationHash);
    const pair = await this.read('pair', identity.pairHash);
    if (operation) {
      const claim = this.validateClaim(operation);
      if (claim.pairHash !== identity.pairHash || (input.letter !== undefined && hash(input.letter) !== claim.letterHash)) throw failure('JOB_BROWSER_OPERATION_CHANGED');
    }
    if (pair) this.validateClaim(pair);
    return Boolean(operation || pair);
  }
  async finish(input, result) {
    const identity = this.identity(input); await this.directory();
    const claim = this.validateClaim(await this.read('operation', identity.operationHash));
    const pair = this.validateClaim(await this.read('pair', identity.pairHash));
    if (claim.pairHash !== identity.pairHash || !this.same(claim, pair)) throw failure('JOB_BROWSER_OPERATION_CHANGED');
    if (result?.verified !== true || !['sent', 'failed', 'manual_required', 'already_applied'].includes(result.outcome)
      || (result.outcome === 'sent' && !/^[\w-]{1,128}$/.test(result.externalId || ''))) return { outcome: 'unknown' };
    await this.write('result', claim.operationHash, { claim, outcome: result.outcome,
      ...(result.outcome === 'sent' ? { externalId: result.externalId } : {}) });
    return this.result(claim);
  }
}
module.exports = { ApplicationLedger };
