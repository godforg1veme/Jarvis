const { assertJobScope, jobError } = require('./jobSchemas');
const { parseJobCallback } = require('./jobTelegramCallbacks');
const { response, button, homeView, cardView, draftView, listView } = require('./jobTelegramViews');
const { parseSettingsEdit, parseProfileEdit } = require('./jobSettingsService');

function jobScope(context) {
  if (context.user?.role !== 'owner' || context.chatType !== 'private' || String(context.chatId) !== String(context.telegramUserId)) throw jobError('JOB_SCOPE_DENIED');
  return { userId: context.user.id, conversationId: context.conversation.id, chatId: String(context.chatId), channel: 'telegram' };
}
function publicJobFailure(error) {
  const messages = { JOB_SCOPE_DENIED: 'Поиск работы доступен владельцу в личном чате.',
    JOB_PROFILE_UNCONFIRMED: 'Сначала проверь и подтверди профиль фактов в настройках поиска работы.',
    JOB_MODEL_NOT_CONFIGURED: 'Для писем нужно выбрать модель поиска работы и настроить OpenRouter.',
    JOB_MODEL_UNAVAILABLE: 'Модель сейчас недоступна. Предыдущий черновик сохранён.',
    JOB_MODEL_INVALID_OUTPUT: 'Ответ модели не прошёл проверку. Предыдущий черновик сохранён.',
    JOB_MODEL_INVALID_FACTS: 'Модель использовала неподтверждённые сведения. Письмо не принято.',
    JOB_REVISION_CONFLICT: 'Данные изменились. Открой актуальную карточку или черновик.',
    JOB_GENERATION_BUSY: 'Этот запрос уже обрабатывается. Второй вызов модели не запущен.',
    JOB_CONFIRMATION_UNAVAILABLE: 'Подтверждение недоступно, уже использовано или истекло.',
    JOB_NOT_FOUND: 'Эта вакансия или письмо недоступны.', JOB_SENSITIVE_INPUT: 'Не присылай ключи и пароли в профиль.' };
  return response(messages[error?.code] || 'Не удалось завершить действие. Открой актуальный раздел и попробуй снова.', [[button('В поиск работы', 'menu')]]);
}

class JobTelegramService {
  constructor(options) { Object.assign(this, options); }
  async handleCallback(data, context) {
    const parsed = parseJobCallback(data); if (!parsed) return data.startsWith('job:') ? response('Кнопка недоступна.') : null;
    try { const scope = jobScope(context); await assertJobScope(this.pool, scope);
      if (!['approve', 'confirm'].includes(parsed.action)) await this.pool.query(`UPDATE job_confirmations SET status='cancelled'
        WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND status='pending' AND kind IN ('settings','profile')`,
      [scope.userId, scope.conversationId, scope.chatId]);
      return await this.handle({ scope, context, ...parsed });
    } catch (error) { return publicJobFailure(error); }
  }
  async home(scope) {
    const search = await this.searchRepository.ensure({ scope });
    const usage = await this.usageRepository.getMonth({ userId: scope.userId });
    const connection = (await this.pool.query('SELECT status,resume_id FROM job_connections WHERE user_id=$1', [scope.userId])).rows[0];
    return homeView({ search, usage, connection });
  }
  async begin(scope, kind, targetId, revision, answer) {
    const interaction = await this.interactions.begin({ ...scope, channel: undefined, kind,
      context: { targetId, revision } });
    return response(answer, [[{ text: 'Отмена', data: `flow:cancel:${interaction.id}` }]]);
  }
  async handle({ scope, context, action, targetId, page = 0 }) {
    if (action === 'menu' || action === 'back') return this.home(scope);
    const search = await this.searchRepository.ensure({ scope });
    if (action === 'save' || action === 'hide') {
      await this.searchRepository.mark({ scope, vacancyId: targetId, action });
      return response(action === 'save' ? 'Вакансия сохранена в Jarvis.' : 'Вакансия скрыта в Jarvis.', [[button('В поиск работы', 'menu')]]);
    }
    if (action === 'pause' || action === 'resume') {
      await this.searchRepository.saveSettings({ scope, expectedRevision: search.revision,
        settings: { ...search.settings, paused: action === 'pause', activated: action === 'resume' || search.settings.activated } });
      return this.home(scope);
    }
    if (action === 'check') {
      await this.pool.query('UPDATE job_searches SET next_check_at=now() WHERE user_id=$1', [scope.userId]);
      return response(search.settings.activated && !search.settings.paused ? 'Проверка поставлена в очередь сборщика.' : 'Сначала включи поиск в настройках или возобнови его.');
    }
    if (action === 'saved') return listView(await this.searchRepository.list({ userId: scope.userId, saved: true, page }), page, 'saved');
    if (action === 'applications') {
      const rows = (await this.pool.query(`SELECT v.* FROM job_vacancies v JOIN job_applications a ON a.vacancy_id=v.id
        WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 10 OFFSET $2`, [scope.userId, page * 10])).rows;
      return listView(rows, page, 'applications');
    }
    if (action === 'view' || action === 'prepare') {
      const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId: targetId });
      if (!vacancy) throw jobError('JOB_NOT_FOUND');
      if (action === 'view') return cardView(vacancy);
      const current = await this.draftRepository.current({ userId: scope.userId, vacancyId: targetId });
      return draftView(current || await this.draftService.generate({ scope, vacancyId: targetId, requestId: context.requestId }));
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
    if (action === 'settings') return this.begin(scope, 'job_settings_edit', search.id, search.revision,
      `Настройки поиска\nОриентир: ${search.settings.targetRub} ₽ на руки; офис: ${search.settings.officeCity}.
Проверка: ${search.settings.intervalMs / 60000} минут; история: ${search.settings.historyDays} дней.
Модель: ${search.settings.model || this.defaultModel || 'не выбрана'}; уведомление: $${search.settings.budgetUsd}.
Запросы:\n${search.settings.queries.join('; ')}
Исключения: ${search.settings.exclusions.join('; ') || 'нет'}
Напиши одну или несколько строк:
зарплата = 100000
город = Москва
интервал = 30
период = 14
бюджет = 3
модель = выбранное название модели
удалёнка = да
запрос + новая поисковая фраза
запрос - лишняя фраза
исключение + нежелательная фраза
включить
Изменения применятся после подтверждения.`);
    if (action === 'profile') {
      const profile = await this.profileRepository.ensure({ scope });
      return this.begin(scope, 'job_profile_edit', profile.id, profile.revision,
        `Профиль для писем. Подтверждённых фактов: ${profile.profile.facts.length}.
${profile.profile.facts.map((x) => x.text).join('\n')}
Добавь подтверждённые сведения строками «факт: ...», образцы стиля — «пример: ...».
Укажи роль, задачу и свой вклад. Не присылай внутренние документы, ключи и пароли.
Перед сохранением покажу полный профиль для подтверждения.`);
    }
    if (action === 'approve') { await this.settingsService.approve({ scope, confirmationId: targetId }); return response('Изменения подтверждены и сохранены.', [[button('В поиск работы', 'menu')]]); }
    if (action === 'connect' || action === 'disconnect' || action === 'resume_select') {
      return this.connectionService ? this.connectionService.handle({ scope, action, targetId }) : response('Подключение HH ещё не настроено. Поиск и подготовка писем доступны отдельно.');
    }
    throw jobError('JOB_INVALID_ACTION');
  }
  async handlePendingText(text, context, interaction) {
    if (!interaction.kind.startsWith('job_')) return null;
    try {
      const scope = jobScope(context); await assertJobScope(this.pool, scope);
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
        const summary = kind === 'profile' ? parsed.facts.map((x) => x.text).join('\n') + `\nПримеров писем: ${parsed.examples.length}`
          : `Ориентир: ${parsed.targetRub} ₽; город: ${parsed.officeCity}; удалёнка: ${parsed.remote ? 'да' : 'нет'}.
Интервал: ${parsed.intervalMs / 60000} мин; история: ${parsed.historyDays} дней.
Модель: ${parsed.model || this.defaultModel || 'не выбрана'}; уведомление: $${parsed.budgetUsd}.
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
module.exports = { JobTelegramService, jobScope, publicJobFailure };
