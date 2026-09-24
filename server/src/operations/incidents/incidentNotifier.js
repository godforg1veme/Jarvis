const { sendTelegramText } = require('../../telegram/telegramFormatting');
const { incidentImpact } = require('./statusLanguage');

class IncidentNotifier {
  constructor(options) { this.getBot = options.getBot; this.ownerTelegramId = options.ownerTelegramId; this.panelOrigin = options.panelOrigin; this.logger = options.logger; }
  async notify(incident, service) {
    const bot = this.getBot && this.getBot();
    if (!bot || !bot.api) return false;
    const text = `**Ошибка: ${incident.summary}**\n${incidentImpact(service.serviceKey)}\nВремя: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\nПанель: ${this.panelOrigin}/ops/#/incidents`;
    try { await sendTelegramText((chunk, options) => bot.api.sendMessage(this.ownerTelegramId, chunk, options), text); return true; }
    catch (_) { if (this.logger) this.logger.warn({ incidentId: incident.id }, 'operations incident notification failed'); return false; }
  }
}

module.exports = { IncidentNotifier };
