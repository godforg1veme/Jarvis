const { UUID } = require('./rpcProtocol');

class GuardedSubmission {
  constructor({ ledger, driver, ownerId, primaryResumeId }) {
    if (!ledger || !driver || !UUID.test(ownerId || '') || !/^[a-zA-Z0-9]{1,100}$/.test(primaryResumeId || '')) throw new Error('JOB_BROWSER_CONFIG_INVALID');
    Object.assign(this, { ledger, driver, ownerId, primaryResumeId }); this.tail = Promise.resolve();
  }
  identity(input) {
    if (input?.userId !== this.ownerId || input.resumeId !== this.primaryResumeId || !UUID.test(input.operationId || '')
      || typeof input.externalId !== 'string' || !/^\d{1,20}$/.test(input.externalId)) throw Object.assign(new Error('JOB_BROWSER_ACCESS_DENIED'), { code: 'JOB_BROWSER_ACCESS_DENIED' });
    return { userId: input.userId, operationId: input.operationId, externalId: input.externalId, resumeId: input.resumeId };
  }
  run(fn) { const pending = this.tail.then(fn); this.tail = pending.catch(() => {}); return pending; }
  submit(input) {
    return this.run(async () => {
      const identity = this.identity(input);
      if (typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) throw Object.assign(new Error('JOB_INVALID_DRAFT'), { code: 'JOB_INVALID_DRAFT' });
      const stored = await this.ledger.lookup(input);
      if (stored.outcome !== 'unknown') return stored;
      let prepared;
      try {
        prepared = await this.driver.prepare({ ...identity, letter: input.letter });
        if (prepared?.ready !== true) {
          return { outcome: 'manual_required', verified: true };
        }
        // Read-only preparation finishes first. Durable claims must exist before the final click.
        const reserved = await this.ledger.reserve({ ...identity, letter: input.letter });
        if (!reserved.execute) return reserved;
        const result = await this.driver.clickAndVerify({ ...identity, letter: input.letter, prepared });
        return await this.ledger.finish(identity, result);
      } catch { return { outcome: 'unknown' }; }
      finally { try { await this.driver.close?.(prepared); } catch {} }
    });
  }
  reconcile(input) {
    return this.run(async () => {
      const identity = this.identity(input), stored = await this.ledger.lookup(identity);
      if (stored.outcome !== 'unknown') return stored;
      try {
        const result = await this.driver.readResult(identity);
        return await this.ledger.finish(identity, result);
      } catch { return { outcome: 'unknown' }; }
    });
  }
}
module.exports = { GuardedSubmission };
