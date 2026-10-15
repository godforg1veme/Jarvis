const { classifyPage } = require('./pageSignals');

function inspectForm(raw, { externalId, resumeId, resumes }) {
  let url; try { url = new URL(raw.url); } catch { return { manualRequired: true, reasonCode: 'JOB_HH_FORM_CHANGED' }; }
  const matches = resumes.filter((resume) => resume.id === resumeId);
  const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const selected = matches.length === 1 ? matches[0] : null;
  const uniqueTitle = selected && resumes.filter((resume) => normalize(resume.title) === normalize(selected.title)).length === 1;
  if (!selected || !uniqueTitle) return { resumeAvailable: false, manualRequired: true, reasonCode: 'JOB_HH_RESUME_UNAVAILABLE' };
  const result = { resumeAvailable: true, manualRequired: true, reasonCode: 'JOB_HH_FORM_CHANGED' };
  const signal = classifyPage({ status: 200, pathname: url.pathname, text: raw.text, iframeSources: raw.iframeSources || [] });
  if (signal.state === 'captcha') return { ...result, reasonCode: 'JOB_HH_CAPTCHA_REQUIRED' };
  if (['login_required', 'access_denied'].includes(signal.state)) return result;
  if (url.origin !== 'https://hh.ru' || url.pathname !== '/applicant/vacancy_response'
    || url.searchParams.getAll('vacancyId').length !== 1 || url.searchParams.get('vacancyId') !== externalId) return result;
  if (!Array.isArray(raw.resumeTitles) || raw.resumeTitles.length !== 1 || normalize(raw.resumeTitles[0]) !== normalize(selected.title)) return result;
  if (raw.hiddenResumeWarning) return { ...result, reasonCode: 'JOB_HH_RESUME_HIDDEN' };
  const allowedHidden = new Set(['area', 'from', 'hhtmFromLabel', 'hhtmFrom', '_xsrf']);
  if (!Array.isArray(raw.fields) || raw.fields.length > 100
    || raw.fields.filter((field) => field.tag === 'INPUT' && field.type === 'hidden' && field.name === '_xsrf').length !== 1
    || raw.fields.some((field) => field.tag === 'INPUT'
    ? field.type !== 'hidden' || !allowedHidden.has(field.name)
    : field.tag !== 'TEXTAREA' || field.qa !== 'vacancy-response-popup-form-letter-input')) return result;
  if (raw.submitCount !== 1 || raw.submitDisabled !== false || ![0, 1].includes(raw.letterInputCount)
    || ![0, 1].includes(raw.letterToggleCount)
    || (raw.letterInputCount === 0 && raw.letterToggleCount !== 1)) return result;
  return { resumeAvailable: true, manualRequired: false, reasonCode: null };
}

async function readApplicationForm(page, args) {
  const raw = await page.evaluate(() => ({
    url: location.href,
    text: document.body?.innerText?.slice(0, 64000) || '',
    resumeTitles: [...document.querySelectorAll('[data-qa="resume-title"]')].slice(0, 21).map((node) => node.textContent.slice(0, 500)),
    fields: [...document.querySelectorAll('input,select,textarea')].slice(0, 101).map((node) => ({
      tag: node.tagName, type: node.type, name: node.name, qa: node.getAttribute('data-qa') })),
    submitCount: document.querySelectorAll('[data-qa="vacancy-response-submit-popup"]').length,
    submitDisabled: Boolean(document.querySelector('[data-qa="vacancy-response-submit-popup"]')?.disabled),
    letterInputCount: document.querySelectorAll('[data-qa="vacancy-response-popup-form-letter-input"]').length,
    letterToggleCount: document.querySelectorAll('[data-qa="vacancy-response-letter-toggle"]').length,
  }));
  // A zero-size hidden tooltip still has a client rect in HH. Use actual visibility.
  raw.hiddenResumeWarning = false;
  for (const warning of (await page.locator('[data-qa="hidden-resume-warning"]').all()).slice(0, 20)) {
    if (await warning.isVisible()) { raw.hiddenResumeWarning = true; break; }
  }
  raw.iframeSources = [];
  for (const frame of (await page.locator('iframe').all()).slice(0, 100)) {
    if (await frame.isVisible()) {
      const source = await frame.getAttribute('src');
      if (source) { try { raw.iframeSources.push(new URL(source, raw.url).href); } catch {} }
    }
  }
  return inspectForm(raw, args);
}
module.exports = { inspectForm, readApplicationForm };
