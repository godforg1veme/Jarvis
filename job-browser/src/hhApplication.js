const { readApplicationForm } = require('./hhApplicationForm');
const { allowedRequest } = require('./networkPolicy');

// Prepares only the already inspected page. It never presses the submit button.
async function prepareApplicationPage(page, input) {
  if (typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) {
    return { ready: false, manualRequired: true, reasonCode: 'JOB_INVALID_DRAFT' };
  }
  const blocked = (reasonCode = 'JOB_HH_FORM_CHANGED') => ({ ready: false, manualRequired: true, reasonCode });
  try {
    const readGuard = (route) => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      && allowedRequest(route.request().url()) ? route.fallback() : route.abort();
    await page.route('**/*', readGuard);
    let state = await readApplicationForm(page, input);
    if (state.manualRequired) return blocked(state.reasonCode);
    let field = page.locator('[data-qa="vacancy-response-popup-form-letter-input"]');
    if (await field.count() === 0) await page.locator('[data-qa="vacancy-response-letter-toggle"]').click({ timeout: 5000 });
    state = await readApplicationForm(page, input);
    if (state.manualRequired) return blocked(state.reasonCode);
    field = page.locator('textarea[data-qa="vacancy-response-popup-form-letter-input"]');
    if (await field.count() !== 1 || !await field.isEditable()) return blocked();
    const limit = await field.getAttribute('maxlength');
    if (limit !== null && (!/^\d+$/.test(limit) || input.letter.length > Number(limit))) return blocked('JOB_HH_LETTER_TOO_LONG');
    await field.fill(input.letter, { timeout: 5000 });
    if (await field.inputValue() !== input.letter) return blocked('JOB_HH_LETTER_CHANGED');
    state = await readApplicationForm(page, input);
    if (state.manualRequired) return blocked(state.reasonCode);
    return { ready: true, manualRequired: false, reasonCode: null,
      releaseReadGuard: () => page.unroute('**/*', readGuard) };
  } catch { return blocked(); }
}

module.exports = { prepareApplicationPage };
