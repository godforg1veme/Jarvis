'use strict';

const { CALLBACK_RE } = require('./service');

const OWNER_ONLY_ANSWER = 'Эта кнопка доступна только владельцу.';
const PRIVATE_CHAT_ANSWER = 'Это подтверждение доступно только в личном чате владельца.';
const INVALID_RUN_ANSWER = 'Этот запрос не найден или уже недействителен.';

class VpnSupervisorCallbackRouter {
  constructor({ repository, services, ownerTelegramId }) {
    if (!repository || typeof repository.find !== 'function') throw new TypeError('VPN Supervisor repository is required');
    if (!Array.isArray(services)) throw new TypeError('VPN Supervisor services must be an array');
    this.repository = repository;
    this.services = [...services];
    this.ownerTelegramId = String(ownerTelegramId);
  }

  async handleCallback(input = {}) {
    const match = CALLBACK_RE.exec(String(input.data || ''));
    if (!match) return null;
    if (String(input.telegramUserId) !== this.ownerTelegramId) return { answer: OWNER_ONLY_ANSWER };
    if (input.telegramChatId === null || input.telegramChatId === undefined
      || String(input.telegramChatId) !== this.ownerTelegramId) {
      return { answer: PRIVATE_CHAT_ANSWER };
    }

    const [, , id] = match;
    const run = await this.repository.find(id);
    if (!run) return { answer: INVALID_RUN_ANSWER };

    let target = null;
    let matches = 0;
    for (const service of this.services) {
      if (!service || typeof service.handleCallback !== 'function'
        || typeof service.hostIdProvider !== 'function') continue;
      const host = await service.hostIdProvider();
      if (host?.id !== run.host_id) continue;
      target = service;
      matches += 1;
    }
    if (matches !== 1) return { answer: INVALID_RUN_ANSWER };

    return target.handleCallback(input);
  }
}

module.exports = { VpnSupervisorCallbackRouter };
