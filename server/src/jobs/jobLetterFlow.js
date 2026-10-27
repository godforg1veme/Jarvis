const { jobError } = require('./jobSchemas');
const { response, button, draftView, letterModeView } = require('./jobTelegramViews');

const LETTER_KINDS = new Set(['job_base_letter_edit', 'job_custom_letter', 'job_custom_letter_ai']);
function validateLetterText(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > 10000) throw jobError('JOB_INVALID_LETTER');
  if (/\b(?:sk-[\w-]{16,}|Bearer\s+[\w.-]{16,})|(?:пароль|password|api[_ -]?key|токен)\s*[:=]\s*\S+/iu.test(text)) throw jobError('JOB_SENSITIVE_INPUT');
  return text;
}

class JobLetterFlow {
  constructor(jobs) { this.jobs = jobs; }
  async handle({ scope, context, action, targetId }) {
    const j = this.jobs;
    if (action === 'base_letter') {
      const profile = await j.profileRepository.ensure({ scope });
      return j.begin(scope, 'job_base_letter_edit', profile.id, profile.revision,
        `Базовое сопроводительное\n\n${profile.profile.baseLetter || 'Базовое письмо ещё не задано.'}\n\nПришли новый текст целиком, до 10 000 символов. Можно несколько абзацев, без «факт:» и «пример:».\nПеред сохранением покажу текст для подтверждения.`);
    }
    if (!['prepare', 'base', 'improved', 'custom', 'custom_ai'].includes(action)) return null;
    const vacancy = await j.searchRepository.getVacancy({ userId: scope.userId, vacancyId: targetId });
    if (!vacancy) throw jobError('JOB_NOT_FOUND');
    const current = await j.draftRepository.current({ userId: scope.userId, vacancyId: targetId });
    if (action === 'prepare') return letterModeView(vacancy, current);
    if (action === 'custom' || action === 'custom_ai') return j.begin(scope,
      action === 'custom' ? 'job_custom_letter' : 'job_custom_letter_ai', vacancy.id, vacancy.revision,
      `Сопроводительное для «${vacancy.snapshot.title}»\nПришли свой текст до 10 000 символов.\n${action === 'custom' ? 'Текст останется без изменений AI.' : 'AI адаптирует текст под вакансию с учётом имеющихся фактов и примеров.'}\nОбщее базовое письмо не изменится. Перед отправкой покажу результат.`);
    const profile = await j.profileRepository.ensure({ scope });
    const source = profile.profile.baseLetter;
    if (!source) return response('Базовое письмо ещё не задано. Добавь его или выбери кастомное письмо для этой вакансии.',
      [[button('Редактировать базовое сопроводительное', 'base_letter')], [button('Выбрать вариант', 'prepare', vacancy.id)]]);
    const options = { scope, vacancyId: vacancy.id, replaceCurrentDraftId: current?.id || null, mode: action,
      expectedProfileRevision: profile.revision, expectedVacancyRevision: vacancy.revision };
    return draftView(action === 'base' ? await j.draftService.createManual({ ...options, text: source })
      : await j.draftService.generate({ ...options, sourceText: source, requestId: context.requestId }));
  }
  async handlePendingText(text, { scope, context, interaction }) {
    if (interaction.kind === 'job_draft_manual_edit') {
      let value;
      try { value = validateLetterText(text); } catch (error) {
        if (error.code === 'JOB_INVALID_LETTER') return response('Пришли новый текст целиком, до 10 000 символов.');
        throw error;
      }
      const draft = await this.jobs.draftService.replaceManual({ scope, draftId: interaction.context.targetId,
        text: String(text), interactionId: interaction.id, interactions: this.jobs.interactions });
      return draftView(draft);
    }
    if (!LETTER_KINDS.has(interaction.kind)) return null;
    const j = this.jobs, value = validateLetterText(text);
    const { targetId, revision } = interaction.context;
    let profile, vacancy;
    if (interaction.kind === 'job_base_letter_edit') {
      profile = await j.profileRepository.get({ userId: scope.userId });
      if (profile?.id !== targetId || profile.revision !== revision) throw jobError('JOB_REVISION_CONFLICT');
    } else {
      vacancy = await j.searchRepository.getVacancy({ userId: scope.userId, vacancyId: targetId });
      if (!vacancy || vacancy.revision !== revision) throw jobError('JOB_REVISION_CONFLICT');
    }
    const consumed = await j.interactions.consume({ id: interaction.id, ...scope });
    if (!consumed) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
    if (profile) {
      const confirmation = await j.settingsService.preview({ scope, kind: 'profile', targetId, revision,
        value: { ...profile.profile, baseLetter: value } });
      return response(`Базовое сопроводительное:\n\n${value}\n\nСохранить вместо прежнего базового письма?`,
        [[button('Подтвердить', 'approve', confirmation.id), button('Отмена', 'menu')]]);
    }
    const current = await j.draftRepository.current({ userId: scope.userId, vacancyId: targetId });
    const options = { scope, vacancyId: targetId, replaceCurrentDraftId: current?.id || null, expectedVacancyRevision: revision };
    return draftView(interaction.kind === 'job_custom_letter'
      ? await j.draftService.createManual({ ...options, mode: 'custom', text: value })
      : await j.draftService.generate({ ...options, mode: 'custom_ai', sourceText: value, requestId: context.requestId }));
  }
}
module.exports = { JobLetterFlow, validateLetterText };
