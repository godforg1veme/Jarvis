const { jobError } = require('./jobSchemas');
const { assertJobLoginAccess } = require('./jobConnectionSessionService');

function jobLoginUrl(origin, ticket) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || !/^[a-f0-9]{64}$/.test(ticket)) throw jobError('JOB_LOGIN_UNAVAILABLE');
  return `${base.origin}/mini/job-connect/#ticket=${ticket}`;
}

class JobLoginLinkDelivery {
  constructor({ sessions, repository, origin, send }) {
    this.sessions = sessions; this.repository = repository; this.origin = origin; this.send = send;
  }

  async create({ userId, requestId, chatId = null, conversationId = null }) {
    const result = await this.sessions.create({ userId, requestId });
    if (!result.ticket) return { ...result, telegramDelivery: result.status === 'connected' ? 'none' : 'unknown' };
    const url = jobLoginUrl(this.origin, result.ticket);
    let claim;
    try {
      claim = await this.repository.claimTelegramDelivery({ sessionId: result.sessionId, userId, chatId, conversationId,
        authorize: async (client, row) => assertJobLoginAccess({ userId, membershipRevision: row.membership_revision,
          roleId: row.role_id, roleRevision: row.role_revision }, await this.sessions.accessFor(client, userId)) });
    } catch (error) {
      if (error.code === 'JOB_ACCESS_REVOKED') throw error;
      return { ...result, telegramDelivery: 'unknown' };
    }
    if (claim.claimed) {
      let status = 'unknown';
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 8000);
      try {
        await Promise.race([this.send({ chatId: claim.chatId,
          answer: `Ссылка для личного входа HH действует несколько минут:\n${url}`,
          buttons: [[{ text: 'Открыть вход HH', url }]], disableLinkPreview: true, signal: controller.signal }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }))]);
        if (!controller.signal.aborted) status = 'sent';
      } catch { status = 'unknown'; }
      finally { clearTimeout(deadline); }
      try { await this.repository.finishTelegramDelivery({ sessionId: result.sessionId, userId, status }); }
      catch { status = 'unknown'; }
      return { ...result, telegramDelivery: status };
    }
    return { ...result, telegramDelivery: ['sent', 'failed', 'unknown'].includes(claim.status) ? claim.status : 'unknown' };
  }
}

module.exports = { JobLoginLinkDelivery, jobLoginUrl };
