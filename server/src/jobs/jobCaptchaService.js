const { normalizedAnswer, validAnswer } = require('./jobCaptchaClient');
const { assertJobScope } = require('./jobSchemas');
const { response, button } = require('./jobTelegramViews');
const CAPTION = 'HH CAPTCHA · Ответь на это фото двумя словами с картинки. Ответ означает однократную отправку в HH. Картинка действует 10 минут.';
const refreshButtons = [[button('Обновить картинку', 'captcha_refresh')]];
class JobCaptchaService {
  constructor({ repository, client }) { Object.assign(this, { repository, client }); }
  async request(scope, refresh) {
    await this.repository.request(scope, refresh);
    return response('Проверка HH поставлена в очередь. Если нужна капча, бот пришлёт картинку. Используй «Ответить» на фото.', refreshButtons);
  }
  async handleReply(input, context) {
    if (!input.replyMessageId) return null;
    const denied = () => response('Эта картинка недоступна или уже использована. Открой «Поиск работы → Проверить HH».');
    if (context.user.role !== 'owner' || input.chatType !== 'private' || input.chatId !== input.telegramUserId) return input.captchaReplyHint ? denied() : null;
    const scope = { userId: context.user.id, conversationId: context.conversation.id, chatId: input.chatId, channel: 'telegram' };
    try { await assertJobScope(this.repository.pool, scope); } catch { return denied(); }
    const known = await this.repository.known(scope, input.replyMessageId);
    if (!known) return input.captchaReplyHint ? denied() : null;
    if (known.status !== 'sent' || new Date(known.expires_at).getTime() <= Date.now()) return denied();
    const text = normalizedAnswer(input.text);
    if (input.voice || input.attachment || !validAnswer(text)) return response('Напиши два кириллических слова ответом на это фото.');
    const claimed = await this.repository.consume(scope, input.replyMessageId);
    if (!claimed) return denied();
    let outcome = 'unknown';
    try { outcome = (await this.client.answer({ challengeId: claimed.challenge_id, revision: Number(claimed.revision), operationId: claimed.operation_id, text })).outcome; } catch {}
    await this.repository.finish(scope, claimed.operation_id, outcome);
    if (outcome === 'new_challenge') await this.repository.request(scope, true);
    if (outcome === 'solved') return response('Доступ к HH подтверждён. Включённый поиск продолжит сохранённый прогресс.');
    return response(outcome === 'unknown' ? 'Результат отправки не удалось подтвердить. Этот ответ повторно не отправляется. Запроси новую картинку.'
      : 'Доступ пока не подтверждён. Запроси новую картинку.', refreshButtons);
  }
}
module.exports = { JobCaptchaService, CAPTION, refreshButtons };
