const { classifyPage } = require('./pageSignals');
const { normalizeQuestionnaire } = require('../../shared/jobQuestionnaire');

function inspectNativeTest(raw) {
  const native = raw.nativeTest;
  const blocked = { resumeAvailable: true, manualRequired: true, reasonCode: 'JOB_HH_TEST_REQUIRED' };
  if (native?.externalLink) return {...blocked,reasonCode:'JOB_HH_EXTERNAL_ACTION'};
  if (!native || native.submitCount !== 1 || native.unsupportedMedia || !Array.isArray(native.fields)
    || native.fields.length > 100
    || !Array.isArray(native.tasks) || native.tasks.length < 1 || native.tasks.length > 20) return blocked;
  const hidden = (name) => { const matches = native.fields.filter(field => field.name === name);
    return matches.length === 1 && matches[0].tag === 'INPUT' && matches[0].type === 'hidden' ? matches[0].value : null; };
  const uidPk = hidden('uidPk'), guid = hidden('guid'), startTime = hidden('startTime');
  const testRequired = hidden('testRequired');
  if (!['true', 'false'].includes(testRequired) || !startTime || startTime.length > 100) return blocked;
  const questions = [];
  const allowed = new Set(['uidPk', 'guid', 'startTime', 'testRequired', '_xsrf', 'area', 'from', 'hhtmFrom', 'hhtmFromLabel']);
  for (const task of native.tasks) {
    if (!/^task_[1-9]\d{0,19}$/.test(task.name || '') || !task.label || task.label.length > 1000
      || !Array.isArray(task.controls) || task.controls.length < 1 || task.controls.length > 21
      || task.controls.some(control => control.name !== task.name && control.name !== `${task.name}_text`)) return blocked;
    const choices = task.controls.filter(control => control.name === task.name);
    const texts = task.controls.filter(control => control.name === `${task.name}_text`);
    if (choices.length === 0 && texts.length === 1 && texts[0].tag === 'TEXTAREA') {
      const id = `${task.name}_text`;
      questions.push({ id, label: task.label, type: 'text', required: true,
        maxLength: Math.min(2000, texts[0].maxLength || 2000), options: [] });
      allowed.add(id);
    } else if (choices.length >= 2 && choices.length <= 20 && texts.length === 0
      && choices.every(control => control.tag === 'INPUT' && control.type === choices[0].type
        && ['radio', 'checkbox'].includes(control.type)
        && control.value !== 'open' && control.label && control.label.length <= 1000)) {
      questions.push({ id: task.name, label: task.label, type: choices[0].type === 'checkbox' ? 'multiple' : 'single',
        required: true, maxLength: null,
        options: choices.map(control => ({ id: control.value, label: control.label })) });
      allowed.add(task.name);
    } else return blocked;
  }
  const taskControls = native.tasks.flatMap(task => task.controls);
  if (taskControls.length !== native.fields.filter(field => /^task_\d+(?:_text)?$/.test(field.name)).length
    || taskControls.some(control => native.fields.filter(field => field.name === control.name
      && field.tag === control.tag && field.type === control.type && field.value === control.value).length !== 1)) return blocked;
  if (native.fields.some(field => !(allowed.has(field.name)
      || field.tag === 'TEXTAREA' && field.qa === 'vacancy-response-popup-form-letter-input')
    || field.type === 'file'
    || (['uidPk', 'guid', 'startTime', 'testRequired', '_xsrf', 'area', 'from', 'hhtmFrom', 'hhtmFromLabel'].includes(field.name)
      && (field.tag !== 'INPUT' || field.type !== 'hidden')))) return blocked;
  try { return { resumeAvailable: true, manualRequired: true, reasonCode: 'JOB_HH_QUESTIONS_REQUIRED',
    questionnaire: normalizeQuestionnaire({ native: { uidPk, guid, testRequired: testRequired === 'true' }, questions }) }; }
  catch { return blocked; }
}

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
  if (!Array.isArray(raw.resumeTitles) || raw.resumeTitles.length !== 1 || normalize(raw.resumeTitles[0]) !== normalize(selected.title)) return result;
  if (raw.hiddenResumeWarning) return { ...result, reasonCode: 'JOB_HH_RESUME_HIDDEN' };
  if (url.origin === 'https://hh.ru' && (url.pathname === '/applicant/vacancy_response/test'
      || (url.pathname === '/applicant/vacancy_response' && raw.nativeTest))
    && url.searchParams.getAll('vacancyId').length === 1
    && url.searchParams.get('vacancyId') === externalId) {
    return inspectNativeTest(raw);
  }
  if (url.origin !== 'https://hh.ru' || url.pathname !== '/applicant/vacancy_response'
    || url.searchParams.getAll('vacancyId').length !== 1 || url.searchParams.get('vacancyId') !== externalId) return result;
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
    nativeTest: (() => {
      const description = document.querySelector('[data-qa="test-description"]');
      const form = description?.closest('form') || document.querySelector('form:has([data-qa="task-body"])');
      if (!description || !form) return null;
      const tasks = [...form.querySelectorAll('[data-qa="task-body"]')].slice(0, 21).map(node => ({
        label: node.querySelector('[data-qa="task-question"]')?.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 1001) || '',
        name: ([...node.querySelectorAll('input[name],textarea[name]')].map(control => control.name)
          .find(name => /^task_\d+(?:_text)?$/.test(name)) || '').replace(/_text$/, ''),
        controls: [...node.querySelectorAll('input[name],textarea[name]')].slice(0, 22).map(control => ({
          tag: control.tagName, type: control.type, name: control.name, value: control.value.slice(0,2101),
          label: control.closest('label')?.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 1001) || '',
          maxLength: control.maxLength > 0 ? control.maxLength : null })),
      }));
      return { tasks, submitCount: form.querySelectorAll('[data-qa="vacancy-response-submit-popup"]').length,
        externalLink: [...form.querySelectorAll('[data-qa="task-body"] a[href]')].some(link => { try { return new URL(link.href).origin !== 'https://hh.ru'; } catch { return true; } }),
        unsupportedMedia: Boolean(form.querySelector('[data-qa="task-body"] img,[data-qa="task-body"] video,[data-qa="task-body"] audio,[data-qa="task-body"] iframe,[data-qa="task-body"] canvas,[data-qa="task-body"] object,[data-qa="task-body"] embed')),
        fields: [...form.querySelectorAll('input[name],textarea[name],select[name]')].slice(0, 101).map(node => ({
          tag: node.tagName, type: node.type, name: node.name, value: node.value.slice(0,2101),
          qa: node.getAttribute('data-qa') })) };
    })(),
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
