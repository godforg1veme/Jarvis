const { cardView, attentionView } = require('./jobTelegramViews');
const { captchaNoticeView } = require('./jobCaptchaNotices');
const { assertJobScope } = require('./jobSchemas');
class JobDeliveryWorker {
  constructor({ pool, searchRepository, deliveryRepository, send, captchaEnabled = false, intervalMs = 2000 }) {
    Object.assign(this, { pool, searchRepository, deliveryRepository, send, captchaEnabled, intervalMs });
    this.timer = null; this.running = false;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const delivery = await this.deliveryRepository.claim(); if (!delivery) return;
      const search = await this.searchRepository.getSettings({ userId: delivery.user_id });
      let view;
      if (delivery.kind === 'card') {
        const vacancy = await this.searchRepository.getVacancy({ userId: delivery.user_id, vacancyId: delivery.vacancy_id });
        if (!vacancy || vacancy.hidden) { await this.deliveryRepository.finish({ deliveryId: delivery.id, outcome: 'failed' }); return; }
        view = cardView(vacancy);
      } else if (delivery.kind === 'attention') {
        if (delivery.payload?.reason === 'HH_CAPTCHA_STATUS') {
          view = captchaNoticeView(delivery.payload.code);
          const scope = { userId: delivery.user_id, conversationId: delivery.payload.conversationId, chatId: delivery.payload.chatId, channel: 'telegram' };
          const denied = () => Object.assign(new Error('JOB_SCOPE_DENIED'), { code: 'JOB_SCOPE_DENIED' });
          try {
            if (!view || search.conversation_id !== scope.conversationId || search.chat_id !== scope.chatId) throw denied();
            await assertJobScope(this.pool, scope);
            const identity = await this.pool.query("SELECT 1 FROM user_identities WHERE user_id=$1 AND provider='telegram' AND external_id=$2", [scope.userId,scope.chatId]);
            if (!identity.rowCount) throw denied();
            if (delivery.payload.code === 'PREPARATION_DELAYED') {
              const pending = await this.pool.query('SELECT 1 FROM job_captcha_controls WHERE user_id=$1 AND request_id=$2', [scope.userId,delivery.payload.requestId]);
              if (!pending.rowCount) throw denied();
            }
          } catch (error) {
            // No Bot API request has begun. A transient scope-read failure is
            // safe to retry; revoked/malformed scope is terminal.
            const rejected = error?.code === 'JOB_SCOPE_DENIED' || error?.name === 'ZodError';
            await this.deliveryRepository.finish({ deliveryId: delivery.id,
              outcome: !rejected && delivery.attempts < 4 ? 'queued' : 'failed' }); return;
          }
        } else if (delivery.payload?.reason === 'HH_CAPTCHA') view = attentionView(this.captchaEnabled);
        else { await this.deliveryRepository.finish({ deliveryId: delivery.id, outcome: 'failed' }); return; }
      } else if (delivery.kind === 'budget') view = { answer: `Поиск работы: расходы API за ${delivery.payload.month} достигли $${delivery.payload.thresholdUsd}. Работа продолжается.`, buttons: [] };
      else { await this.deliveryRepository.finish({ deliveryId: delivery.id, outcome: 'failed' }); return; }
      try {
        const result = await this.send({ chatId: search.chat_id, ...view });
        await this.deliveryRepository.finish({ deliveryId: delivery.id, outcome: 'sent', telegramMessageId: result.message_id });
      } catch (error) {
        const retry = error?.parameters?.retry_after;
        const known = Number.isInteger(error?.error_code);
        await this.deliveryRepository.finish({ deliveryId: delivery.id,
          outcome: known && error.error_code === 429 && delivery.attempts < 4 ? 'queued' : known ? 'failed' : 'unknown',
          retryAfterMs: Number.isFinite(retry) ? Math.min(Math.max(retry * 1000, 1000), 86400000) : 30000 });
      }
    } finally { this.running = false; }
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(() => {}); }, this.intervalMs); this.timer.unref?.(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async close() { this.stop(); while (this.running) await new Promise((resolve) => setTimeout(resolve, 10)); }
}
module.exports = { JobDeliveryWorker };
