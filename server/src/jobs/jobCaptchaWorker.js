const { CAPTION, refreshButtons } = require('./jobCaptchaService');
class JobCaptchaWorker {
  constructor({ repository, client, ownerId, sendPhoto, intervalMs = 10000, sendTimeoutMs = 30000,
    now = Date.now, report = code => process.stderr.write(`${code}\n`) }) {
    Object.assign(this, { repository, client, ownerId, sendPhoto, intervalMs, sendTimeoutMs, now, report });
    this.timer = null; this.running = false; this.failures = 0; this.retryAt = 0; this.requestId = null;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    let scope, request;
    try {
      scope = await this.repository.scope(this.ownerId); if (!scope) return;
      request = await this.repository.getRequest(scope);
      if (request && request.request_id !== this.requestId) { this.failures = 0; this.retryAt = 0; this.requestId = request.request_id; }
      if (this.now() < this.retryAt) return;
      await this.repository.recover(scope);
      const acknowledge = () => request && this.repository.ackRequest(scope, request.request_id);
      const refresh = request?.refresh_requested === true;
      const blocker = !refresh && await this.repository.hasUnknownDelivery(scope);
      if (blocker) {
        if (blocker === 'sending' || blocker === 'answer_sending') return;
        await this.repository.notify(scope, blocker === 'answer_unknown' ? 'ANSWER_UNKNOWN' : 'PHOTO_UNKNOWN', request?.request_id); await acknowledge(); return;
      }
      const state = await this.client.status();
      if (state.phase === 'checking') return;
      if (state.phase === 'idle') {
        if (request?.explicit_request) await this.repository.notify(scope, 'NO_CHALLENGE', request.request_id);
        await acknowledge(); this.reset(); return;
      }
      const challenge = await this.client.challenge(refresh);
      if (challenge.outcome === 'refresh_required') {
        await this.repository.notify(scope, 'REFRESH_REQUIRED', request?.request_id); await acknowledge(); this.reset(); return;
      }
      if (challenge.outcome === 'idle') {
        if (request?.explicit_request) await this.repository.notify(scope, 'NO_CHALLENGE', request.request_id);
        await acknowledge(); this.reset(); return;
      }
      await this.repository.enqueue(scope, challenge);
      await acknowledge(); this.reset();
      const photo = await this.repository.claim(scope, challenge.challengeId, request?.request_id); if (!photo) {
        const status = await this.repository.photoState(scope, challenge.challengeId);
        if (status === 'failed') await this.repository.notify(scope, 'PHOTO_FAILED');
        if (status === 'stale') await this.repository.notify(scope, 'REFRESH_REQUIRED');
        return;
      }
      let messageId = null, outcome = 'unknown', retryAfterMs = 0, timer;
      const controller = new AbortController();
      try {
        const sent = await Promise.race([
          Promise.resolve().then(() => this.sendPhoto({ chatId: scope.chatId, png: challenge.png, caption: CAPTION, buttons: refreshButtons, signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('JOB_CAPTCHA_SEND_TIMEOUT')); }, this.sendTimeoutMs); }),
        ]);
        if (/^[1-9]\d{0,19}$/.test(String(sent?.message_id))) { messageId = sent.message_id; outcome = 'sent'; }
      } catch (e) {
        if (Number.isInteger(e?.error_code)) {
          outcome = 'failed';
          if (e.error_code === 429 && photo.attempts < 4) {
            const seconds = e.parameters?.retry_after;
            retryAfterMs = Number.isFinite(seconds) ? Math.min(Math.max(Math.ceil(seconds*1000),1000),86400000) : 30000;
            outcome = 'queued';
          }
        }
      } finally { clearTimeout(timer); }
      await this.repository.delivered(scope, photo.id, messageId, outcome, retryAfterMs);
      if (outcome === 'unknown' || outcome === 'failed') await this.repository.notify(scope, outcome === 'unknown' ? 'PHOTO_UNKNOWN' : 'PHOTO_FAILED');
    } catch {
      this.failures++; this.retryAt = this.now() + Math.min(10000 * 2 ** Math.min(this.failures-1,4), 120000);
      this.report('JOB_CAPTCHA_PREPARATION_FAILED');
      if (scope) {
        try {
          request ||= await this.repository.ensureRequest(scope); this.requestId = request.request_id;
          if (this.failures >= 3) await this.repository.notify(scope, 'PREPARATION_DELAYED', request.request_id);
        } catch { this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE'); }
      }
    } finally { this.running = false; }
  }
  reset() { this.failures = 0; this.retryAt = 0; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(() => this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE')); }, this.intervalMs); this.timer.unref?.(); void this.tick().catch(() => this.report('JOB_CAPTCHA_QUEUE_UNAVAILABLE')); } }
  async close() { clearInterval(this.timer); this.timer = null; while (this.running) await new Promise(r => setTimeout(r, 10)); }
}
module.exports = { JobCaptchaWorker };
