const { CAPTION, refreshButtons } = require('./jobCaptchaService');
class JobCaptchaWorker {
  constructor({ repository, client, ownerId, sendPhoto, intervalMs = 10000 }) {
    Object.assign(this, { repository, client, ownerId, sendPhoto, intervalMs }); this.timer = null; this.running = false;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const scope = await this.repository.scope(this.ownerId); if (!scope) return;
      const refresh = await this.repository.consumeRefresh(scope);
      if (!refresh && await this.repository.hasUnknownDelivery(scope)) return;
      const state = await this.client.status(); if (state.phase === 'idle' || state.phase === 'checking') return;
      const challenge = await this.client.challenge(refresh); if (challenge.outcome !== 'ready') return;
      await this.repository.enqueue(scope, challenge);
      const photo = await this.repository.claim(scope, challenge.challengeId); if (!photo) return;
      let messageId = null, outcome = 'unknown';
      try {
        const sent = await this.sendPhoto({ chatId: scope.chatId, png: challenge.png, caption: CAPTION, buttons: refreshButtons });
        if (/^[1-9]\d{0,19}$/.test(String(sent?.message_id))) { messageId = sent.message_id; outcome = 'sent'; }
      } catch (e) { if (Number.isInteger(e?.error_code)) outcome = 'failed'; }
      await this.repository.delivered(scope, photo.id, messageId, outcome);
    } finally { this.running = false; }
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(() => {}); }, this.intervalMs); this.timer.unref?.(); void this.tick().catch(() => {}); } }
  async close() { clearInterval(this.timer); this.timer = null; while (this.running) await new Promise(r => setTimeout(r, 10)); }
}
module.exports = { JobCaptchaWorker };
