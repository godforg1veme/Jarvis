const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { ApplicationLedger } = require('./applicationLedger');
const { UUID } = require('./rpcProtocol');
const { ID, INTERVAL } = require('./resumeRaiseProtocol');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = () => Object.assign(Error('JOB_BROWSER_LEDGER_UNAVAILABLE'), { code: 'JOB_BROWSER_LEDGER_UNAVAILABLE' });
const OUTCOMES = ['raised','not_due','ineligible','failed','unknown'];
class ResumeRaiseLedger {
  constructor({ root, ownerId, now = Date.now }) { this.store = new ApplicationLedger({ root, ownerId }); this.now = now; }
  identity({ userId, operationId, resumeId }) {
    if (userId !== this.store.ownerId || !UUID.test(operationId || '') || !ID.test(resumeId || '')) throw fail();
    return { userId, operationId, resumeId };
  }
  valid(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'at,operationId,outcome,resumeId,userId'
      || !Number.isSafeInteger(value.at) || value.at < 0 || !OUTCOMES.includes(value.outcome)) throw fail();
    this.identity(value); return value;
  }
  async replaceLast(value) {
    const dest = this.store.location('pair', hash(value.resumeId));
    const tmp = path.join(this.store.root, `.raise-${randomUUID()}`);
    let h;
    try {
      h = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await h.writeFile(JSON.stringify(value)); await h.sync(); await h.close(); h = null;
      await fs.rename(tmp, dest); await this.store.syncDirectory();
    } finally { await h?.close(); await fs.unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw fail(); }); }
  }
  async reserve(input) {
    const identity = this.identity(input); await this.store.directory();
    const digest = hash(identity.operationId), old = await this.store.read('operation', digest);
    if (old) {
      this.valid(old);
      if (old.operationId!==identity.operationId || old.resumeId !== identity.resumeId || old.userId !== identity.userId) throw fail();
      return { execute: false, ...await this.lookup(input) };
    }
    const last = await this.store.read('pair', hash(identity.resumeId));
    if (last) {
      this.valid(last);
      if (last.outcome === 'unknown') return { execute: false, outcome: 'unknown' };
      if (this.now() < last.at + INTERVAL) return { execute: false, outcome: 'not_due', verified: true, nextAllowedAt: new Date(last.at + INTERVAL).toISOString() };
    }
    const claim = { ...identity, at: this.now(), outcome: 'unknown' };
    await this.replaceLast(claim);
    if (!await this.store.write('operation', digest, claim)) return { execute: false, outcome: 'unknown' };
    return { execute: true, outcome: 'unknown' };
  }
  async lookup(input) {
    const identity=this.identity(input);await this.store.directory();const digest=hash(identity.operationId);
    const claim=await this.store.read('operation',digest);if(!claim)return {outcome:'unknown'};this.valid(claim);
    if(claim.operationId!==identity.operationId||claim.userId!==identity.userId||claim.resumeId!==identity.resumeId)throw fail();
    const result=await this.store.read('result',digest);if(!result)return {outcome:'unknown'};this.valid(result);
    if(result.operationId!==identity.operationId||result.userId!==identity.userId||result.resumeId!==identity.resumeId)throw fail();
    return this.publicResult(result);
  }
  publicResult(value) { return { outcome: value.outcome, ...(value.outcome === 'unknown' ? {} : { verified: true }),
    ...(value.outcome === 'raised' ? { nextAllowedAt: new Date(value.at + INTERVAL).toISOString() } : {}) }; }
  async finish(input, outcome) {
    const identity = this.identity(input); if (!OUTCOMES.includes(outcome)) throw fail();
    const digest = hash(identity.operationId), claim = this.valid(await this.store.read('operation', digest));
    if (claim.operationId!==identity.operationId || claim.userId !== identity.userId || claim.resumeId !== identity.resumeId) throw fail();
    const result = { ...claim, outcome };
    await this.store.write('result', digest, result);
    const saved = this.valid(await this.store.read('result', digest));
    await this.replaceLast(saved); return this.publicResult(saved);
  }
}
module.exports = { ResumeRaiseLedger };
