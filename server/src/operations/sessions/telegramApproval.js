function parseApprovalCallback(value) {
  const match = /^ops:(allow|deny):([a-f0-9-]{36})$/i.exec(String(value || ''));
  return match ? { approved: match[1] === 'allow', id: match[2] } : null;
}
function createTelegramApprovalHandler({ service, ownerTelegramId }) {
  return async (ctx) => {
    const parsed = parseApprovalCallback(ctx.callbackQuery && ctx.callbackQuery.data);
    const sender = String(ctx.from && ctx.from.id || '');
    if (!parsed || sender !== String(ownerTelegramId)) return ctx.answerCallbackQuery({ text: 'Недоступно.', show_alert: true });
    const decided = await service.decide(parsed);
    await ctx.answerCallbackQuery({ text: decided ? (parsed.approved ? 'Браузер одобрен.' : 'Отклонено.') : 'Запрос уже недействителен.' });
  };
}
module.exports = { createTelegramApprovalHandler, parseApprovalCallback };
