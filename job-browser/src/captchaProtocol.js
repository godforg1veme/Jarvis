const { parseFields } = require('./submissionProtocol');
const ORIGIN = 'https://hh.ru';
function validAnswer(value) {
  return typeof value === 'string' && !/[\r\n]/u.test(value) && /^[а-яё]{2,20} [а-яё]{2,20}$/u.test(value);
}
function targetUrl(value) {
  try {
    const u = new URL(value);
    return u.origin === ORIGIN && !u.username && !u.password && !u.hash
      && (/^\/vacancy\/\d{1,20}$/.test(u.pathname) || u.pathname === '/search/vacancy'
        || ['/applicant/negotiations','/applicant/resumes'].includes(u.pathname)&&require('./manualState').validTarget(value)) ? u : null;
  } catch { return null; }
}
function validInit({ url, method, contentType, body }) {
  try {
    const u = new URL(url);
    return method === 'POST' && u.origin === ORIGIN && !u.username && !u.password && !u.hash && u.pathname === '/captcha'
      && u.searchParams.size === 1 && ['RU', 'EN', 'ru', 'en'].includes(u.searchParams.get('lang'))
      && /^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(contentType || '')
      && (body === null || Buffer.isBuffer(body) && body.length === 0);
  } catch { return false; }
}
function validForm(form, target) {
  try {
    if (!targetUrl(target) || !form || typeof form.action !== 'string' || form.action.length > 8192
      || form.method !== 'post' || form.enctype !== 'application/x-www-form-urlencoded' || form.otherControls !== 0
      || !Array.isArray(form.inputs) || form.inputs.length !== 3) return false;
    const u = new URL(form.action);
    if (u.origin !== ORIGIN || u.username || u.password || u.hash || u.pathname !== '/account/captcha'
      || u.searchParams.size !== 2 || !u.searchParams.has('state') || !u.searchParams.has('backurl')
      || !u.searchParams.get('state') || u.searchParams.get('state').length > 4096
      || new URL(u.searchParams.get('backurl'), ORIGIN).href !== target) return false;
    const fields = new Map();
    for (const input of form.inputs) {
      if (!input || fields.has(input.name) || !['_xsrf', 'captchaText', 'isBot'].includes(input.name)
        || typeof input.value !== 'string' || input.value.length > (input.name === '_xsrf' ? 512 : 128)
        || /[\x00-\x1f\x7f]/.test(input.value) || input.type !== (input.name === 'captchaText' ? 'text' : 'hidden')) return false;
      fields.set(input.name, input.value);
    }
    return fields.size === 3 && Boolean(fields.get('_xsrf'));
  } catch { return false; }
}
function sameForm(left, right) {
  return left.action === right.action && left.method === right.method && left.enctype === right.enctype
    && ['_xsrf', 'isBot'].every((name) => left.inputs.find((i) => i.name === name)?.value === right.inputs.find((i) => i.name === name)?.value);
}
function validPictureKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x20\x7f]/.test(value);
}
function validAnswerRequest(input, form, target, answer, pictureKey) {
  if (!validAnswer(answer) || !validForm(form, target) || input.method !== 'POST') return false;
  if (input.url !== form.action) {
    try {
      if (typeof input.url !== 'string' || input.url.length > 24576 || !validPictureKey(pictureKey)
        || input.navigation !== false || input.resourceType !== 'xhr'
        || input.csrfToken !== form.inputs.find((i) => i.name === '_xsrf').value
        || !/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(input.contentType || '')
        || !(input.body === null || Buffer.isBuffer(input.body) && input.body.length === 0)) return false;
      const u = new URL(input.url), action = new URL(form.action), fields = u.searchParams;
      const names = ['captchaText', 'captchaKey', 'captchaState', 'backurl', 'failurl'];
      return u.origin === ORIGIN && !u.username && !u.password && !u.hash && u.pathname === '/account/captcha'
        && fields.size === names.length && names.every((name) => fields.getAll(name).length === 1)
        && fields.get('captchaText') === answer && fields.get('captchaKey') === pictureKey
        && fields.get('captchaState') === action.searchParams.get('state')
        && new URL(fields.get('backurl'), ORIGIN).href === target
        && new URL(fields.get('failurl'), ORIGIN).href === form.action;
    } catch { return false; }
  }
  if (!Buffer.isBuffer(input.body) || input.body.length > 4096) return false;
  const fields = parseFields(input);
  return Boolean(fields && fields.size === 3 && fields.get('captchaText') === answer
    && ['_xsrf', 'isBot'].every((name) => fields.get(name) === form.inputs.find((i) => i.name === name).value));
}
async function readForm(page, target) {
  const current = new URL(page.url());
  if (current.origin !== ORIGIN || current.pathname !== '/account/captcha') return null;
  const form = await page.evaluate(() => {
    const forms = [...document.forms].filter((f) => f.querySelector('input[name="captchaText"]'));
    if (forms.length !== 1) return null;
    const f = forms[0];
    return { action: f.action, method: f.method, enctype: f.enctype,
      inputs: [...f.querySelectorAll('input')].slice(0, 5).map((n) => ({ name: n.name, type: n.type, value: n.value })),
      otherControls: f.querySelectorAll('textarea,select,input:disabled,input[readonly],button[name]:not([name=""]),button[formaction],input[formaction]').length };
  });
  return validForm(form, target) ? form : null;
}
module.exports = { validAnswer, validInit, validForm, sameForm, validPictureKey, validAnswerRequest, readForm, targetUrl };
