const { trackWorker } = require('../lifecycle');
const { CAPTION, AUTOMATIC_CAPTION, refreshButtons } = require('./jobCaptchaService');

class JobCaptchaWorker {
  constructor({ repository, client, ownerId = null, sendPhoto, automatic = false, intervalMs = 10000, sendTimeoutMs = 30000,
    now = Date.now, report = code => process.stderr.write(`${code}\n`) }) {
    Object.assign(this, { repository, client, ownerId, sendPhoto, automatic, intervalMs, sendTimeoutMs, now, report });
    this.timer = null; this.running = false; this.cursor = 0; this.states = new Map();
    trackWorker(this, 'tick');
  }

  stateFor(userId) {
    let state = this.states.get(userId);
    if (!state) { state = { failures: 0, retryAt: 0, requestId: null }; this.states.set(userId, state); }
    return state;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const users = typeof this.repository.activeUsers === 'function' ? await this.repository.activeUsers() : this.ownerId ? [this.ownerId] : [];
      if (!users.length) { this.cursor = 0; this.states.clear(); return; }
      const activeUsers = new Set(users);
      for (const userId of this.states.keys()) if (!activeUsers.has(userId)) this.states.delete(userId);
      const count = Math.min(2, users.length);
      const batch = Array.from({ length: count }, (_, offset) => users[(this.cursor + offset) % users.length]);
      this.cursor = (this.cursor + count) % users.length;
      for (const userId of batch) await this.tickUser(userId);
    } catch { this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE'); }
    finally { this.running = false; }
  }

  async tickUser(userId) {
    const state = this.stateFor(userId);
    let scope, request;
    try {
      scope = await this.repository.scope(userId); if (!scope) { this.states.delete(userId); return; }
      request = await this.repository.getRequest(scope);
      if (request && request.request_id !== state.requestId) { state.failures = 0; state.retryAt = 0; state.requestId = request.request_id; }
      if (this.now() < state.retryAt) return;
      await this.repository.recover(scope);
      const acknowledge = () => request && this.repository.ackRequest(scope, request.request_id);
      const refresh = request?.refresh_requested === true;
      const blocker = !refresh && await this.repository.hasUnknownDelivery(scope);
      if (blocker) {
        if (blocker === 'sending' || blocker === 'answer_sending') return;
        await this.repository.notify(scope, blocker === 'answer_unknown' ? 'ANSWER_UNKNOWN' : 'PHOTO_UNKNOWN', request?.request_id);
        await acknowledge(); return;
      }
      const status = await this.client.status(userId);
      if (status.phase === 'checking') return;
      if (status.phase === 'idle') {
        if (request?.explicit_request) await this.repository.notify(scope, 'NO_CHALLENGE', request.request_id);
        await acknowledge(); this.reset(state); return;
      }
      const challenge = await this.client.challenge(userId, refresh);
      if (challenge.outcome === 'preparing') { this.reset(state); return; }
      if (challenge.outcome === 'refresh_required') {
        await this.repository.notify(scope, 'REFRESH_REQUIRED', request?.request_id); await acknowledge(); this.reset(state); return;
      }
      if (challenge.outcome === 'idle') {
        if (request?.explicit_request) await this.repository.notify(scope, 'NO_CHALLENGE', request.request_id);
        await acknowledge(); this.reset(state); return;
      }
      await this.repository.enqueue(scope, challenge);
      await acknowledge(); this.reset(state);
      const photo = await this.repository.claim(scope, challenge.challengeId, request?.request_id);
      if (!photo) {
        const photoStatus = await this.repository.photoState(scope, challenge.challengeId);
        if (photoStatus === 'failed') await this.repository.notify(scope, 'PHOTO_FAILED');
        if (photoStatus === 'stale') await this.repository.notify(scope, 'REFRESH_REQUIRED');
        return;
      }
      let messageId = null, outcome = 'unknown', retryAfterMs = 0, timer;
      const controller = new AbortController();
      try {
        const sent = await Promise.race([
          Promise.resolve().then(() => this.sendPhoto({ chatId: scope.chatId, png: challenge.png,
            caption: this.automatic ? AUTOMATIC_CAPTION : CAPTION, buttons: refreshButtons, signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('JOB_CAPTCHA_SEND_TIMEOUT')); }, this.sendTimeoutMs); }),
        ]);
        if (/^[1-9]\d{0,19}$/.test(String(sent?.message_id))) { messageId = sent.message_id; outcome = 'sent'; }
      } catch (error) {
        if (Number.isInteger(error?.error_code)) {
          outcome = 'failed';
          if (error.error_code === 429 && photo.attempts < 4) {
            const seconds = error.parameters?.retry_after;
            retryAfterMs = Number.isFinite(seconds) ? Math.min(Math.max(Math.ceil(seconds * 1000), 1000), 86400000) : 30000;
            outcome = 'queued';
          }
        }
      } finally { clearTimeout(timer); }
      await this.repository.delivered(scope, photo.id, messageId, outcome, retryAfterMs);
      if (outcome === 'unknown' || outcome === 'failed') await this.repository.notify(scope, outcome === 'unknown' ? 'PHOTO_UNKNOWN' : 'PHOTO_FAILED');
    } catch {
      state.failures++;
      state.retryAt = this.now() + Math.min(10000 * 2 ** Math.min(state.failures - 1, 4), 120000);
      this.report('JOB_CAPTCHA_PREPARATION_FAILED');
      if (scope) {
        try {
          request ||= await this.repository.ensureRequest(scope); state.requestId = request.request_id;
          if (state.failures >= 3) await this.repository.notify(scope, 'PREPARATION_DELAYED', request.request_id);
        } catch { this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE'); }
      }
    }
  }

  reset(state) { state.failures = 0; state.retryAt = 0; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(() => this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE')); }, this.intervalMs); this.timer.unref?.(); void this.tick().catch(() => this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE')); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  close() { return this.stop(); }
}
module.exports = { JobCaptchaWorker };
