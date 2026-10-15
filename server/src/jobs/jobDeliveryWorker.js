const { cardView } = require('./jobTelegramViews');
class JobDeliveryWorker {
  constructor({ pool, searchRepository, deliveryRepository, send, intervalMs = 2000 }) {
    Object.assign(this, { pool, searchRepository, deliveryRepository, send, intervalMs });
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
        if (delivery.payload?.reason !== 'HH_CAPTCHA') { await this.deliveryRepository.finish({ deliveryId: delivery.id, outcome: 'failed' }); return; }
        view = { answer: 'Поиск работы: автоматическая попытка прохождения капчи HH не подтвердила доступ. Проверьте сессию HH в браузере на VPS; при запросе пройдите капчу вручную. Прогресс поиска сохранён; для этой проверки повторной отправки ответа не будет.', buttons: [], disableLinkPreview: true };
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
