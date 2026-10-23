const { assertJobScope, jobError } = require('./jobSchemas');
const { parseJobCallback } = require('./jobTelegramCallbacks');
const { response, button, homeView, cardView, draftView, listView } = require('./jobTelegramViews');
const { parseSettingsEdit, parseProfileEdit } = require('./jobSettingsService');
const { JobLetterFlow } = require('./jobLetterFlow');
const { JobSettingsPanel } = require('./jobSettingsPanel');
const { JobResumeTelegram } = require('./jobResumeTelegram');
const { createHash } = require('node:crypto');

function isConfiguredOwner(context, ownerTelegramId) {
  return /^[1-9]\d{0,19}$/.test(String(ownerTelegramId || ''))
    && String(context.telegramUserId) === String(ownerTelegramId);
}

function jobScope(context, ownerTelegramId = null) {
  const hasJobs = context.access
    ? !context.access.blocked && context.access.permissions?.includes('jobs')
    : isConfiguredOwner(context, ownerTelegramId);
  if (!hasJobs || context.chatType !== 'private' || String(context.chatId) !== String(context.telegramUserId)) throw jobError('JOB_SCOPE_DENIED');
  return { userId: context.user.id, conversationId: context.conversation.id, chatId: String(context.chatId), channel: 'telegram' };
}
function publicJobFailure(error) {
  const messages = { JOB_SCOPE_DENIED: 'Поиск работы доступен только в личном чате и при действующем разрешении.',
    revision_conflict: 'Выбор резюме изменился. Открой актуальный список и подтверди заново.',
    operation_unknown: 'Результат исходной попытки пока неизвестен. Проверь его; повтор не отправлен.',
    JOB_RESUME_RAISE_UNAVAILABLE: 'Автоподнятие пока не настроено на сервере. Выбор резюме доступен отдельно.',
    JOB_LOGIN_RESUME_INVALID: 'Выбранное резюме больше недоступно в твоём HH. Обнови список.',
    JOB_SEARCH_QUERIES_REQUIRED: 'Сначала добавь поисковые запросы: «Настройки → Поисковые запросы → Добавить». Пришли фразы одним сообщением, каждую с новой строки. Затем включи поиск.',
    JOB_PROFILE_UNCONFIRMED: 'Сначала проверь и подтверди профиль фактов в настройках поиска работы.',
    JOB_MODEL_NOT_CONFIGURED: 'Автоматическая генерация писем ещё не настроена на сервере.',
    JOB_MODEL_UNAVAILABLE: 'Модель сейчас недоступна. Предыдущий черновик сохранён.',
    JOB_MODEL_INVALID_OUTPUT: 'Ответ модели не прошёл проверку. Предыдущий черновик сохранён.',
    JOB_MODEL_INVALID_FACTS: 'Модель использовала неподтверждённые сведения. Письмо не принято.',
    JOB_REVISION_CONFLICT: 'Данные изменились. Открой актуальную карточку или черновик.',
    JOB_GENERATION_BUSY: 'Этот запрос уже обрабатывается. Второй вызов модели не запущен.',
    JOB_GENERATION_OUTCOME_UNKNOWN: 'Генерация была прервана, её стоимость ещё уточняется. Этот запрос повторно не запускается. Можно отдельно запросить новый вариант письма.',
    JOB_CONFIRMATION_UNAVAILABLE: 'Подтверждение недоступно, уже использовано или истекло.',
    JOB_APPLICANT_API_UNAVAILABLE: 'Доступный канал отправки HH пока не подтверждён. Одного ключа поиска недостаточно. Письмо не отправлено.',
    JOB_HH_NOT_CONNECTED: 'Нужно подключение HH с правом отправки и выбранное основное резюме.',
    JOB_HH_RESUME_UNAVAILABLE: 'Основное резюме недоступно. Другое резюме автоматически не выбрано.',
    JOB_HH_NOT_FOUND: 'Вакансия недоступна или архивирована. Отклик не отправлен.',
    JOB_INVALID_LETTER: 'Пришли непустой текст длиной до 10 000 символов.',
    JOB_NOT_FOUND: 'Эта вакансия или письмо недоступны.', JOB_SENSITIVE_INPUT: 'Не присылай ключи и пароли в профиль.' };
  return response(messages[error?.code] || 'Не удалось завершить действие. Открой актуальный раздел и попробуй снова.', [[button('В поиск работы', 'menu')]]);
}

class JobTelegramService {
  constructor(options) { Object.assign(this, options); this.letterFlow = new JobLetterFlow(this); this.settingsPanel = new JobSettingsPanel(this);
    this.resumePanel=options.resumeService?new JobResumeTelegram({service:options.resumeService}):null; }
  async handleCallback(data, context) {
    const parsed = parseJobCallback(data); if (!parsed) return data.startsWith('job:') ? response('Кнопка недоступна.') : null;
    try { const scope = jobScope(context, this.ownerTelegramId); await assertJobScope(this.pool, scope, this.accessService);
      if (!['approve', 'confirm', 'cfg_ok'].includes(parsed.action)) await this.pool.query(`UPDATE job_confirmations SET status='cancelled'
        WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND status='pending' AND kind IN ('settings','profile')`,
      [scope.userId, scope.conversationId, scope.chatId]);
      if(!['rs_ok','rs_status'].includes(parsed.action))await this.pool.query(`UPDATE job_confirmations SET status='cancelled'
        WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND kind='resume' AND frozen->>'purpose'='change' AND status='pending'`,
      [scope.userId,scope.conversationId,scope.chatId]);
      if (['menu', 'back', 'draft', 'cancel', 'regenerate', 'edit', 'translate', 'prepare', 'base_letter', 'base', 'improved', 'custom', 'custom_ai'].includes(parsed.action)) await this.pool.query(`UPDATE job_confirmations SET status='cancelled'
        WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND kind='apply' AND status='pending'`,
      [scope.userId, scope.conversationId, scope.chatId]);
      return await this.handle({ scope, context, ...parsed });
    } catch (error) { return publicJobFailure(error); }
  }
  async home(scope) {
    const search = await this.searchRepository.ensure({ scope });
    const usage = await this.usageRepository.getMonth({ userId: scope.userId });
    const connection = (await this.pool.query('SELECT status,resume_id FROM job_connections WHERE user_id=$1', [scope.userId])).rows[0];
    return homeView({ search, usage, connection, captchaEnabled: Boolean(this.captchaService), resumeEnabled:Boolean(this.resumePanel) });
  }
  async begin(scope, kind, targetId, revision, answer) {
    const interaction = await this.interactions.begin({ ...scope, channel: undefined, kind,
      context: { targetId, revision } });
    return response(answer, [[{ text: 'Отмена', data: `flow:cancel:${interaction.id}` }]]);
  }
  async handle({ scope, context, action, targetId, field, revision, index, page = 0 }) {
    if (action === 'captcha' || action === 'captcha_refresh') return this.captchaService ? this.captchaService.request(scope, action === 'captcha_refresh') : response('Проверка HH через Telegram не настроена.');
    if (action === 'menu' || action === 'back') return this.home(scope);
    const resume=this.resumePanel&&await this.resumePanel.handle({scope,context,action,targetId,index});
    if(resume)return resume;
    const search = await this.searchRepository.ensure({ scope });
    const settings = await this.settingsPanel.handle({scope,action,targetId,field,revision,index,page});
    if (settings) return settings;
    const letter = await this.letterFlow.handle({ scope, context, action, targetId });
    if (letter) return letter;
    const history=this.historyService&&await this.historyService.handle({scope,action,targetId,page});
    if(history)return history;
    if (action === 'save' || action === 'hide') {
      await this.searchRepository.mark({ scope, vacancyId: targetId, action });
      return response(action === 'save' ? 'Вакансия сохранена в Jarvis.' : 'Вакансия скрыта в Jarvis.', [[button('В поиск работы', 'menu')]]);
    }
    if (action === 'pause' || action === 'resume') {
      await this.searchRepository.setEnabled({ scope, expectedRevision: search.revision, enabled: action === 'resume' });
      return this.home(scope);
    }
    if (action === 'check') {
      await this.pool.query('UPDATE job_searches SET next_check_at=now() WHERE user_id=$1', [scope.userId]);
      return response(search.settings.activated && !search.settings.paused ? 'Проверка поставлена в очередь сборщика.' : 'Сначала нажми «Включить поиск».',
        [[button('В поиск работы', 'menu')]]);
    }
    if (action === 'saved') return listView(await this.searchRepository.list({ userId: scope.userId, saved: true, page }), page, 'saved');
    if (action === 'applications') {
      const rows = (await this.pool.query(`SELECT v.* FROM job_vacancies v JOIN job_applications a ON a.vacancy_id=v.id
        WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 10 OFFSET $2`, [scope.userId, page * 10])).rows;
      return listView(rows, page, 'applications');
    }
    if (action === 'view') {
      const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId: targetId });
      if (!vacancy) throw jobError('JOB_NOT_FOUND');
      return cardView(vacancy);
    }
    if (action === 'regenerate' || action === 'edit' || action === 'translate' || action === 'draft' || action === 'send' || action === 'cancel') {
      const draft = await this.draftRepository.get({ userId: scope.userId, draftId: targetId });
      if (!draft?.current) throw jobError('JOB_NOT_FOUND');
      if (action === 'cancel') return response('Письмо не отправлено. Черновик сохранён.', [[button('В поиск работы', 'menu')]]);
      if (action === 'draft') return draftView(draft);
      if (action === 'regenerate') return draftView(await this.draftService.generate({ scope, vacancyId: draft.vacancy_id,
        parentDraftId: draft.id, requestId: context.requestId }));
      if (action === 'edit' || action === 'translate') return this.begin(scope, `job_draft_${action === 'edit' ? 'edit' : 'translate'}`,
        draft.id, 1, action === 'edit' ? `Правка письма к выбранной вакансии:\n\n${draft.text}\n\nНапиши, что изменить.` : 'На какой язык перевести письмо? Напиши «русский» или «английский».');
      if (!this.applicationService) return response('Отправка требует подключения HH. Письмо не отправлено.');
      return this.applicationService.prepareConfirmation({ scope, draftId: draft.id });
    }
    if (action === 'confirm') return this.applicationService ? this.applicationService.confirm({ scope, confirmationId: targetId }) : response('Отправка HH не настроена.');
    if (action === 'profile') {
      const profile = await this.profileRepository.ensure({ scope });
      return this.begin(scope, 'job_profile_edit', profile.id, profile.revision,
        `Профиль для писем (необязательно). AI учитывает заполненные факты и примеры. Подтверждённых фактов: ${profile.profile.facts.length}.
${profile.profile.facts.map((x) => x.text).join('\n')}
Добавь подтверждённые сведения строками «факт: ...», образцы стиля — «пример: ...».
Укажи роль, задачу и свой вклад. Не присылай внутренние документы, ключи и пароли.
Перед сохранением покажу полный профиль для подтверждения.`);
    }
    if (action === 'approve') { await this.settingsService.approve({ scope, confirmationId: targetId }); return response('Изменения подтверждены и сохранены.', [[button('В поиск работы', 'menu')]]); }
    if (action === 'connect' || action === 'disconnect' || action === 'resume_select') {
      if (action === 'connect' && this.loginLinkDelivery) {
        const digest = createHash('sha256').update(String(context.requestId)).digest('hex');
        const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        const result = await this.loginLinkDelivery.create({ userId: scope.userId, requestId,
          chatId: scope.chatId, conversationId: scope.conversationId });
        if (result.status === 'connected') return response('HH уже подключён. Основное резюме сохранено.', [[button('В поиск работы', 'menu')]]);
        if (result.telegramDelivery === 'sent') return response('Личная ссылка для входа HH отправлена отдельным сообщением. После входа вернись в Mini App и выбери основное резюме.', [[button('В поиск работы', 'menu')]]);
        return response('Ссылка доступна в личном Mini App. Telegram не подтвердил доставку; открой текущую сессию там.', [[button('В поиск работы', 'menu')]]);
      }
      const isOwner = context.access?.level === 'owner' || isConfiguredOwner(context, this.ownerTelegramId);
      if (action === 'connect' && !isOwner) {
        const href = this.jobPublicOrigin ? new URL('/mini/', this.jobPublicOrigin).href : null;
        return href ? response('Открой личное подключение HH в Mini App. Войди в свой профиль и выбери основное резюме.',
          [[{ text: 'Открыть подключение HH', webApp: href }]])
          : response('Открой личное подключение HH через раздел «Поиск работы» в Jarvis Mini App.');
      }
      return this.connectionService ? this.connectionService.handle({ scope, action, targetId }) : response('Подключение HH ещё не настроено. Поиск и подготовка писем доступны отдельно.');
    }
    throw jobError('JOB_INVALID_ACTION');
  }
  async handlePendingText(text, context, interaction) {
    if (!interaction.kind.startsWith('job_')) return null;
    try {
      const scope = jobScope(context, this.ownerTelegramId); await assertJobScope(this.pool, scope, this.accessService);
      const setting = await this.settingsPanel.handlePendingText(text, {scope,interaction});
      if (setting) return setting;
      const letter = await this.letterFlow.handlePendingText(text, { scope, context, interaction });
      if (letter) return letter;
      const value = String(text).trim();
      if (!value || value.length > 10000) return response('Введи текст длиной до 10 000 символов.');
      const { targetId, revision } = interaction.context;
      let parsed, current;
      if (interaction.kind === 'job_settings_edit') {
        current = await this.searchRepository.getSettings({ userId: scope.userId });
        if (current.id !== targetId || current.revision !== revision) throw jobError('JOB_REVISION_CONFLICT');
        try { parsed = parseSettingsEdit(value, current.settings); }
        catch { return response('Не удалось разобрать настройки. Исправь формат строк и повтори ввод.'); }
      } else if (interaction.kind === 'job_profile_edit') {
        current = await this.profileRepository.get({ userId: scope.userId });
        if (current?.id !== targetId || current.revision !== revision) throw jobError('JOB_REVISION_CONFLICT');
        try { parsed = parseProfileEdit(value, current.profile); }
        catch (error) { return error.code === 'JOB_SENSITIVE_INPUT' ? publicJobFailure(error) : response('Каждая строка должна начинаться с «факт:» или «пример:». Проверь текст и повтори.'); }
      } else if (interaction.kind === 'job_draft_translate') {
        parsed = /^(русский|ru)$/iu.test(value) ? 'ru' : /^(английский|en)$/iu.test(value) ? 'en' : null;
        if (!parsed) return response('Напиши «русский» или «английский».');
      } else if (interaction.kind !== 'job_draft_edit') throw jobError('JOB_INVALID_ACTION');
      const consumed = await this.interactions.consume({ id: interaction.id, ...scope });
      if (!consumed) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
      if (interaction.kind === 'job_settings_edit' || interaction.kind === 'job_profile_edit') {
        const kind = interaction.kind === 'job_settings_edit' ? 'settings' : 'profile';
        const confirmation = await this.settingsService.preview({ scope, kind, targetId, revision, value: parsed });
        const summary = kind === 'profile' ? `Факты:\n${parsed.facts.map((x) => x.text).join('\n') || 'пока нет'}\n\nПримеры стиля:\n${parsed.examples.map((x, index) => `${index + 1}. ${x}`).join('\n\n') || 'пока нет'}`
          : `Ориентир: ${parsed.targetRub} ₽; город: ${parsed.officeCity}; удалёнка: ${parsed.remote ? 'да' : 'нет'}.
Интервал: ${parsed.intervalMs / 60000} мин; история: ${parsed.historyDays} дней.
Уведомление: $${parsed.budgetUsd}.
Запросы: ${parsed.queries.join('; ')}\nИсключения: ${parsed.exclusions.join('; ') || 'нет'}.
Поиск ${parsed.activated ? 'включён' : 'не включён'}; ${parsed.paused ? 'на паузе' : 'без паузы'}.`;
        return response(`Проверь изменения:\n${summary}\n\nСохранить?`, [[button('Подтвердить', 'approve', confirmation.id), button('Отмена', 'menu')]]);
      }
      const draft = await this.draftRepository.get({ userId: scope.userId, draftId: targetId });
      if (!draft?.current) throw jobError('JOB_REVISION_CONFLICT');
      return draftView(await this.draftService.generate({ scope, vacancyId: draft.vacancy_id, parentDraftId: draft.id,
        requestId: context.requestId, instruction: interaction.kind === 'job_draft_edit' ? value : 'Translate the existing letter; preserve facts.', language: parsed || 'auto' }));
    } catch (error) { return publicJobFailure(error); }
  }
}
module.exports = { JobTelegramService, jobScope, isConfiguredOwner, publicJobFailure };
