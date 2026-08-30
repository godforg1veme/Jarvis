const crypto = require('crypto');

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed']);
const ALLOWED_CHANNELS = new Set(['text', 'voice']);

class AppRecoveryRegistry {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.randomId = options.randomId || (() => crypto.randomUUID());
    this.candidateTtlMs = options.candidateTtlMs ?? 10 * 60 * 1000;
    this.confirmationTtlMs = options.confirmationTtlMs ?? 30 * 1000;
    this.attempts = new Map();
    this.activeId = null;
  }

  purgeExpired() {
    const now = this.now();
    for (const [recoveryId, attempt] of this.attempts) {
      if (now - attempt.updatedAt <= this.candidateTtlMs) continue;
      if (!TERMINAL_STATES.has(attempt.state)) attempt.abortController.abort('recovery expired');
      this.attempts.delete(recoveryId);
      if (this.activeId === recoveryId) this.activeId = null;
    }
  }

  create(query, inputChannel = 'text') {
    this.purgeExpired();
    if (!ALLOWED_CHANNELS.has(inputChannel)) throw new Error('invalid recovery input channel');
    if (this.activeId) this.cancel(this.activeId, 'superseded by a new command');
    const recoveryId = `recovery-${this.randomId()}`;
    const attempt = {
      recoveryId,
      query: String(query || '').trim(),
      inputChannel,
      state: 'local_search',
      createdAt: this.now(),
      updatedAt: this.now(),
      candidates: new Map(),
      presentedIds: [],
      selectedCandidateId: '',
      match: null,
      progress: null,
      error: '',
      result: null,
      confirmationExpiresAt: 0,
      abortController: new AbortController(),
    };
    this.attempts.set(recoveryId, attempt);
    this.activeId = recoveryId;
    return attempt;
  }

  get(recoveryId, options = {}) {
    this.purgeExpired();
    const attempt = this.attempts.get(String(recoveryId || ''));
    if (!attempt) throw new Error('unknown recoveryId');
    if (options.active !== false && (this.activeId !== attempt.recoveryId || TERMINAL_STATES.has(attempt.state))) {
      throw new Error('recovery is not active');
    }
    return attempt;
  }

  transition(recoveryId, state, patch = {}) {
    const attempt = this.get(recoveryId);
    attempt.state = state;
    attempt.updatedAt = this.now();
    Object.assign(attempt, patch);
    if (TERMINAL_STATES.has(state) && this.activeId === recoveryId) this.activeId = null;
    return attempt;
  }

  addCandidates(recoveryId, candidates) {
    const attempt = this.get(recoveryId);
    for (const candidate of candidates || []) attempt.candidates.set(candidate.candidateId, candidate);
    return attempt;
  }

  present(recoveryId, candidateIds, state) {
    const attempt = this.get(recoveryId);
    const ids = Array.from(new Set(candidateIds || [])).slice(0, 3);
    if (ids.length === 0 || ids.some(id => !attempt.candidates.has(id))) throw new Error('invalid recovery candidate selection');
    attempt.presentedIds = ids;
    attempt.selectedCandidateId = ids.length === 1 ? ids[0] : '';
    attempt.confirmationExpiresAt = state === 'awaiting_confirmation' ? this.now() + this.confirmationTtlMs : 0;
    return this.transition(recoveryId, state);
  }

  select(recoveryId, candidateId) {
    const attempt = this.get(recoveryId);
    if (attempt.state !== 'awaiting_selection') throw new Error('recovery is not awaiting selection');
    if (!attempt.presentedIds.includes(candidateId) || !attempt.candidates.has(candidateId)) throw new Error('candidate is not presented');
    attempt.selectedCandidateId = candidateId;
    attempt.confirmationExpiresAt = this.now() + this.confirmationTtlMs;
    return this.transition(recoveryId, 'awaiting_confirmation');
  }

  confirmedCandidate(recoveryId) {
    const attempt = this.get(recoveryId);
    if (attempt.state !== 'awaiting_confirmation') throw new Error('recovery is not awaiting confirmation');
    if (!attempt.confirmationExpiresAt || this.now() > attempt.confirmationExpiresAt) {
      this.cancel(recoveryId, 'confirmation expired');
      throw new Error('recovery confirmation expired');
    }
    const candidate = attempt.candidates.get(attempt.selectedCandidateId);
    if (!candidate) throw new Error('selected candidate is unavailable');
    return candidate;
  }

  cancel(recoveryId, reason = 'cancelled') {
    const attempt = this.attempts.get(String(recoveryId || ''));
    if (!attempt || TERMINAL_STATES.has(attempt.state)) return attempt || null;
    attempt.abortController.abort(reason);
    attempt.state = 'cancelled';
    attempt.error = reason;
    attempt.updatedAt = this.now();
    if (this.activeId === attempt.recoveryId) this.activeId = null;
    return attempt;
  }

  publicSnapshot(recoveryId) {
    const attempt = this.get(recoveryId, { active: false });
    const candidates = attempt.presentedIds.map(id => attempt.candidates.get(id)).filter(Boolean).map(candidate => ({
      candidateId: candidate.candidateId,
      displayName: candidate.displayName,
      type: candidate.launch.type,
      publisher: candidate.publisher,
      location: candidate.generalizedLocation,
      localScore: candidate.localScore,
    }));
    return {
      recoveryId: attempt.recoveryId,
      query: attempt.query,
      inputChannel: attempt.inputChannel,
      state: attempt.state,
      candidates,
      selectedCandidateId: attempt.selectedCandidateId,
      progress: attempt.progress,
      error: attempt.error,
      result: attempt.result,
      confirmationExpiresAt: attempt.confirmationExpiresAt,
    };
  }
}

module.exports = { TERMINAL_STATES, ALLOWED_CHANNELS, AppRecoveryRegistry };
