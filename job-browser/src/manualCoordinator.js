const { fail } = require('./manualState');
class ManualCoordinator {
  constructor({ store, open, verify }) {
    Object.assign(this, { store, open, verify }); this.state = null; this.tail = Promise.resolve(); this.listeners = new Set();
  }
  run(fn) { const p = this.tail.then(fn); this.tail = p.catch(() => {}); return p; }
  async load() {
    this.state = await this.store.read();
    if (this.state.phase === 'checking') await this.write({ phase: 'active', revision: this.state.revision + 1 });
    return this.status();
  }
  status() { if (!this.state) throw fail(); return { phase: this.state.phase, revision: this.state.revision }; }
  async write(patch) {
    this.state = await this.store.write({ ...this.state, ...patch });
    for (const fn of this.listeners) { try { fn(this.status()); } catch {} }
    return this.status();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  assertAutomatic() { if (this.status().phase !== 'idle') throw fail('JOB_HH_MANUAL_ACTIVE'); }
  pending({ target, recoveryId, claims = [], seedRequired = false }) {
    return this.run(async () => {
      if (this.state.phase !== 'idle') {
        if (this.state.target === target && this.state.recoveryId === recoveryId) return this.status();
        throw fail('JOB_HH_MANUAL_ACTIVE');
      }
      return this.write({ phase: 'pending', target, recoveryId, claims, seedRequired, revision: this.state.revision + 1,
        lastAction: 'none', lastRevision: this.state.revision });
    });
  }
  replay(action, revision) {
    return Number.isSafeInteger(revision) && this.state.lastAction === action && this.state.lastRevision === revision;
  }
  start(revision) {
    return this.run(async () => {
      if (this.replay('start', revision)) return this.status();
      if (revision !== this.state.revision || !['pending', 'active'].includes(this.state.phase)) throw fail('JOB_MANUAL_REVISION_CONFLICT');
      await this.write({ phase: 'active', revision: revision + 1, lastAction: 'start', lastRevision: revision });
      try { await this.open(this.state.target); }
      catch { return this.write({ phase: 'pending', revision: this.state.revision + 1 }); }
      return this.status();
    });
  }
  finish(revision) {
    return this.run(async () => {
      if (this.replay('finish', revision)) return this.status();
      if (revision !== this.state.revision || this.state.phase !== 'active') throw fail('JOB_MANUAL_REVISION_CONFLICT');
      this.finishing = true;
      await this.write({ phase: 'checking', revision: revision + 1, lastAction: 'finish', lastRevision: revision });
      let verified = false;
      try { verified = await this.verify(this.state.target, this.state.recoveryId) === true; } catch {}
      const result = await this.write(verified ? { phase: 'idle', target: null, recoveryId: null, claims: [], seedRequired: false, revision: this.state.revision + 1 }
        : { phase: 'active', revision: this.state.revision + 1 });
      this.finishing = false;
      return result;
    });
  }
  claim(challengeHash) {
    return this.claimMany([challengeHash]);
  }
  claimMany(hashes) {
    // This method runs from a page route while finish may await navigation;
    // do not queue behind finish (which would deadlock the intercepted request).
    if (!this.canInput()) return Promise.reject(fail('JOB_HH_MANUAL_ACTIVE'));
    const revision = this.state.revision;
    return this.run(async () => {
      if (!this.canInput() || this.state.revision !== revision || this.state.seedRequired
        || !Array.isArray(hashes) || !hashes.length || hashes.some(h => !/^[a-f0-9]{64}$/.test(h) || this.state.claims.includes(h))
        || new Set(hashes).size !== hashes.length || this.state.claims.length + hashes.length > 64) throw fail('JOB_MANUAL_CHALLENGE_ALREADY_ATTEMPTED');
      await this.write({ claims: [...this.state.claims, ...hashes] });
      return true;
    });
  }
  canInput() { return this.state?.phase === 'active' && !this.finishing; }
  seedBaseline(challengeHash, revision) {
    return this.run(async () => {
      if (!this.canInput() || this.state.revision !== revision || !this.state.seedRequired) return false;
      await this.write({ claims: [...new Set([...this.state.claims, challengeHash])], seedRequired: false });
      return true;
    });
  }
}
module.exports = { ManualCoordinator };
