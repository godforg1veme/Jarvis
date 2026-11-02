const { readApplicationForm } = require('./hhApplicationForm');
const { allowedRequest } = require('./networkPolicy');
const { normalizeQuestionnaire, normalizeAnswers } = require('../../shared/jobQuestionnaire');

// Prepares only the already inspected page. It never presses the submit button.
async function prepareApplicationPage(page, input) {
  if (typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) {
    return { ready: false, manualRequired: true, reasonCode: 'JOB_INVALID_DRAFT' };
  }
  const blocked = (reasonCode = 'JOB_HH_FORM_CHANGED') => ({ ready: false, manualRequired: true, reasonCode });
  let questionnaire = null, answers = null;
  try {
    if (input.questionnaire !== undefined || input.answers !== undefined) {
      questionnaire = normalizeQuestionnaire(input.questionnaire);
      answers = normalizeAnswers(questionnaire, input.answers);
    }
  } catch { return blocked('JOB_HH_FORM_CHANGED'); }
  const compatible = (state) => questionnaire
    ? state.reasonCode === 'JOB_HH_QUESTIONS_REQUIRED' && state.questionnaire?.hash === questionnaire.hash
    : !state.manualRequired;
  try {
    const readGuard = (route) => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      && allowedRequest(route.request().url()) ? route.fallback() : route.abort();
    await page.route('**/*', readGuard);
    let state = await readApplicationForm(page, input);
    if (!compatible(state)) return blocked(state.reasonCode);
    let field = page.locator('[data-qa="vacancy-response-popup-form-letter-input"]');
    if (await field.count() === 0) await page.locator('[data-qa="vacancy-response-letter-toggle"]').click({ timeout: 5000 });
    state = await readApplicationForm(page, input);
    if (!compatible(state)) return blocked(state.reasonCode);
    field = page.locator('textarea[data-qa="vacancy-response-popup-form-letter-input"]');
    if (await field.count() !== 1 || !await field.isEditable()) return blocked();
    const limit = await field.getAttribute('maxlength');
    if (limit !== null && (!/^\d+$/.test(limit) || input.letter.length > Number(limit))) return blocked('JOB_HH_LETTER_TOO_LONG');
    await field.fill(input.letter, { timeout: 5000 });
    if (await field.inputValue() !== input.letter) return blocked('JOB_HH_LETTER_CHANGED');
    if (questionnaire) {
      const form = page.locator('form:has([data-qa="vacancy-response-submit-popup"])');
      if (await form.count() !== 1) return blocked();
      for (const answer of answers) {
        const question = questionnaire.questions.find((item) => item.id === answer.id);
        const selector = `[name="${answer.id}"]`;
        const control = form.locator(selector);
        if (question.type === 'text') {
          if (await control.count() !== 1) return blocked();
          await control.fill(answer.value, { timeout: 5000 });
          if (await control.inputValue() !== answer.value) return blocked();
        } else if (question.type === 'multiple') {
          for (const option of question.options) {
            const checkbox = form.locator(`input[type="checkbox"]${selector}[value="${option.id}"]`);
            if (await checkbox.count() !== 1) return blocked();
            if (answer.value.includes(option.id)) await checkbox.check({ timeout: 5000 });
            else await checkbox.uncheck({ timeout: 5000 });
            if (await checkbox.isChecked() !== answer.value.includes(option.id)) return blocked();
          }
        } else if (await form.locator(`select${selector}`).count() === 1) {
          await form.locator(`select${selector}`).selectOption(answer.value, { timeout: 5000 });
          if (await form.locator(`select${selector}`).inputValue() !== answer.value) return blocked();
        } else {
          const chosen = form.locator(`input[type="radio"]${selector}[value="${answer.value}"]`);
          if (await chosen.count() !== 1) return blocked();
          await chosen.check({ timeout: 5000 });
          if (!await chosen.isChecked()) return blocked();
        }
      }
    }
    state = await readApplicationForm(page, input);
    if (!compatible(state)) return blocked(state.reasonCode);
    let nativeStartTime;
    if (questionnaire) {
      const start = page.locator('form:has([data-qa="vacancy-response-submit-popup"]) input[name="startTime"]');
      if (await start.count() !== 1) return blocked();
      nativeStartTime = await start.inputValue();
      if (!nativeStartTime || nativeStartTime.length > 100) return blocked();
    }
    return { ready: true, manualRequired: false, reasonCode: null, ...(questionnaire ? { questionnaire } : {}),
      ...(questionnaire ? { nativeStartTime } : {}),
      releaseReadGuard: () => page.unroute('**/*', readGuard) };
  } catch { return blocked(); }
}

module.exports = { prepareApplicationPage };
