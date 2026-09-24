const crypto = require('node:crypto');
const {
  assertVisionLeaseTransition,
  requiredId,
  validateVisionSource,
} = require('./visionSchemas');

const SHORT_LEASE_MS = 30 * 1000;
const ACTIVE_IDLE_MS = 5 * 60 * 1000;
const HARD_LEASE_MS = 60 * 60 * 1000;

function publicState(controller) {
  return {
    leaseId: controller.leaseId,
    ownerId: controller.ownerId,
    state: controller.state,
    kind: controller.kind,
    sourceIds: [...controller.sourceIds],
    startedAt: controller.startedAt ? new Date(controller.startedAt).toISOString() : null,
    idleExpiresAt: controller.idleExpiresAt ? new Date(controller.idleExpiresAt).toISOString() : null,
    hardExpiresAt: controller.hardExpiresAt ? new Date(controller.hardExpiresAt).toISOString() : null,
    stopReason: controller.stopReason,
  };
}

class VisionPrivacyController {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || (() => `lease-${crypto.randomUUID()}`);
    this.openSources = options.openSources || (async () => {});
    this.closeSources = options.closeSources || (async () => {});
    this.onState = typeof options.onState === 'function' ? options.onState : () => {};
    this.shortLeaseMs = Number(options.shortLeaseMs || SHORT_LEASE_MS);
    this.activeIdleMs = Number(options.activeIdleMs || ACTIVE_IDLE_MS);
    this.hardLeaseMs = Number(options.hardLeaseMs || HARD_LEASE_MS);
    this.state = 'off';
    this.leaseId = '';
    this.ownerId = '';
    this.kind = '';
    this.sourceIds = [];
    this.startedAt = 0;
    this.idleExpiresAt = 0;
    this.hardExpiresAt = 0;
    this.stopReason = '';
  }

  getState() {
    return publicState(this);
  }

  _setState(next, reason = '') {
    assertVisionLeaseTransition(this.state, next);
    this.state = next;
    if (reason) this.stopReason = String(reason).slice(0, 80);
    const snapshot = this.getState();
    this.onState(snapshot);
    return snapshot;
  }

  _clearLease() {
    this.leaseId = '';
    this.ownerId = '';
    this.kind = '';
    this.sourceIds = [];
    this.startedAt = 0;
    this.idleExpiresAt = 0;
    this.hardExpiresAt = 0;
  }

  async startLocal(input = {}) {
    if (input.explicitIntent !== true) throw new Error('explicit local visual intent is required');
    const ownerId = requiredId(input.ownerId, 'vision owner id');
    const kind = input.kind === 'short' ? 'short' : 'active';
    if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > 4) {
      throw new Error('vision sources are invalid');
    }
    const sources = input.sources.map(validateVisionSource);
    const cameraCount = sources.filter((source) => source.type === 'camera').length;
    if (cameraCount > 1) throw new Error('only one camera may be active');
    if (sources.some((source) => !source.available || source.protected)) {
      throw new Error('vision source is unavailable');
    }

    if (this.state !== 'off') throw new Error('vision lease is already active');
    this.leaseId = requiredId(input.leaseId || this.createId(), 'vision lease id');
    this.ownerId = ownerId;
    this.kind = kind;
    this.sourceIds = sources.map((source) => source.sourceId);
    this.stopReason = '';
    this._setState('starting');
    try {
      await this.openSources({ leaseId: this.leaseId, sources });
      const startedAt = this.now();
      this.startedAt = startedAt;
      this.hardExpiresAt = startedAt + this.hardLeaseMs;
      this.idleExpiresAt = startedAt + (kind === 'short' ? this.shortLeaseMs : this.activeIdleMs);
      return this._setState('active');
    } catch (error) {
      try { await this.closeSources({ leaseId: this.leaseId, reason: 'start_failed' }); } catch (_) {}
      this._setState('error', 'start_failed');
      this._setState('off');
      this._clearLease();
      throw error;
    }
  }

  use({ ownerId, origin = 'local' } = {}) {
    if (this.state !== 'active') throw new Error('vision lease is not active');
    if (requiredId(ownerId, 'vision owner id') !== this.ownerId) throw new Error('vision owner mismatch');
    const now = this.now();
    if (now >= this.hardExpiresAt || now >= this.idleExpiresAt) {
      throw new Error('vision lease is expired');
    }
    if (origin === 'local' && this.kind === 'active') {
      this.idleExpiresAt = Math.min(this.hardExpiresAt, now + this.activeIdleMs);
      this.onState(this.getState());
    }
    return this.getState();
  }

  markAnswerComplete({ ownerId } = {}) {
    if (this.state !== 'active' || this.kind !== 'short') return this.getState();
    if (requiredId(ownerId, 'vision owner id') !== this.ownerId) throw new Error('vision owner mismatch');
    this.idleExpiresAt = Math.min(this.hardExpiresAt, this.now() + this.shortLeaseMs);
    this.onState(this.getState());
    return this.getState();
  }

  async checkExpiry() {
    if (this.state !== 'active') return this.getState();
    const now = this.now();
    if (now < this.hardExpiresAt && now < this.idleExpiresAt) return this.getState();
    return this.stop(now >= this.hardExpiresAt ? 'hard_expiry' : 'idle_expiry', 'expired');
  }

  async interrupt(reason = 'connection_lost') {
    if (this.state === 'off') return this.getState();
    return this.stop(reason, 'interrupted');
  }

  async stop(reason = 'user_stop', terminalState = 'off') {
    if (this.state === 'off') return this.getState();
    const closingLeaseId = this.leaseId;
    if (this.state === 'active') this._setState('stopping', reason);
    try {
      await this.closeSources({ leaseId: closingLeaseId, reason });
    } finally {
      if (this.state === 'stopping') {
        this._setState(terminalState, reason);
      } else if (this.state === 'starting') {
        this._setState(terminalState === 'expired' ? 'error' : terminalState, reason);
      }
      if (this.state !== 'off') this._setState('off');
      this._clearLease();
      this.onState(this.getState());
    }
    return this.getState();
  }
}

module.exports = {
  ACTIVE_IDLE_MS,
  HARD_LEASE_MS,
  SHORT_LEASE_MS,
  VisionPrivacyController,
};

