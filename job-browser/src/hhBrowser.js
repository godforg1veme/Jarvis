const { allowedRequest } = require('./networkPolicy');
const { classifyPage, classifySession } = require('./pageSignals');
const { readSearchPage, readVacancyPage, readResumes } = require('./hhPageReader');
const { readApplicationForm } = require('./hhApplicationForm');
const { readResumePrivacy, readEmployerId, evaluatePrivacy } = require('./hhPrivacy');
const { dispatchCaptcha } = require('./captchaDispatch');
const { bounded } = require('./browserHealth');
const failure = (code) => Object.assign(new Error(code), { code });
const CAPABILITIES = Object.freeze({ dateWindows: false, maxPages: 1000 });

class HhBrowser {
  constructor({ context, now = () => new Date(), primaryResumeId = null, captchaRecovery = null, captchaDispatch = dispatchCaptcha,
    manualCoordinator = null, onManualRequired = null, operationTimeoutMs = 80000, onTimeout = () => {} }) {
    if (!context || typeof context.newPage !== 'function') throw failure('JOB_BROWSER_CONTEXT_REQUIRED');
    this.context = context; this.now = now; this.tail = Promise.resolve(); this.capabilities = CAPABILITIES;
    this.primaryResumeId = primaryResumeId;
    this.captchaRecovery = captchaRecovery;
    this.captchaDispatch = captchaDispatch;
    this.manualCoordinator = manualCoordinator;
    this.onManualRequired = onManualRequired;
    this.operationTimeoutMs = operationTimeoutMs; this.onTimeout = onTimeout;
  }
  // One persistent profile, one active read. A rejected operation must not poison the queue.
  run(fn) {
    const pending = this.tail.then(() => bounded(fn, this.operationTimeoutMs)).catch(error => {
      if (error.code === 'JOB_BROWSER_OPERATION_TIMEOUT') this.onTimeout();
      throw error;
    });
    this.tail = pending.catch(() => {}); return pending;
  }
  connection() {
    return this.run(async () => {
      const resumes = await this.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes);
      const primary = resumes.filter((item) => item.id === this.primaryResumeId);
      if (primary.length !== 1) throw failure('JOB_HH_RESUME_UNAVAILABLE');
      return { resumeId: primary[0].id, title: primary[0].title };
    });
  }
  async open(url, expected) {
    this.manualCoordinator?.assertAutomatic();
    const page = await this.context.newPage(); page.setDefaultTimeout(10000);
    let attempt = null;
    try {
      attempt = this.captchaRecovery && ['search', 'vacancy'].includes(expected)
        ? await this.captchaRecovery.begin(page, url) : null;
      const readGuard = async (route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return allowedRequest(request.url()) ? route.fallback() : route.abort();
        try { if (attempt && await this.captchaRecovery.permit(attempt, request)) return this.captchaDispatch(route); } catch {}
        return route.abort();
      };
      await page.route('**/*', readGuard);
      let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      const observe = async () => {
        const current = new URL(page.url());
        if (current.origin !== 'https://hh.ru') throw failure('JOB_HH_ACCESS_DENIED');
        const observation = await page.evaluate(() => ({
          text: document.body?.innerText?.slice(0, 64000) || '',
          vacancyLinks: document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]').length,
          vacancyContent: Boolean(document.querySelector('[data-qa="vacancy-description"]')),
        }));
        const iframeSources = [];
        for (const frame of (await page.locator('iframe').all()).slice(0, 100)) {
          if (await frame.isVisible()) { const src = await frame.getAttribute('src'); if (src) iframeSources.push(new URL(src, current).href); }
        }
        const input = { ...observation, iframeSources, pathname: current.pathname, status: response?.status() || 0 };
        return { current, signal: expected === 'authenticated' ? classifySession(input) : classifyPage(input) };
      };
      let { current, signal } = await observe();
      if (signal.state === 'captcha' && attempt) {
        response = await this.captchaRecovery.recover(attempt);
        await page.waitForTimeout(1500);
        ({ current, signal } = await observe());
        if (signal.state === 'captcha') throw this.captchaRecovery.manual(attempt);
      }
      const errors = { captcha: 'JOB_HH_CAPTCHA_REQUIRED', rate_limited: 'JOB_HH_RATE_LIMIT',
        access_denied: 'JOB_HH_ACCESS_DENIED', login_required: 'JOB_HH_LOGIN_REQUIRED' };
      if (errors[signal.state]) throw failure(errors[signal.state]);
      if (response?.status() === 404) throw failure('JOB_HH_NOT_FOUND');
      // Empty search is verified by its exact zero heading in the reader, never by missing cards alone.
      const zeroCandidate = expected === 'search' && signal.state === 'unknown'
        && response?.status() === 200 && current.pathname === '/search/vacancy';
      const formCandidate = expected === 'application' && signal.state === 'unknown'
        && response?.status() === 200 && current.pathname === '/applicant/vacancy_response';
      const privacyCandidate = expected === 'resume_privacy' && signal.state === 'unknown'
        && response?.status() === 200 && /^\/resume\/[a-zA-Z0-9]+$/.test(current.pathname);
      if (signal.state !== expected && !zeroCandidate && !formCandidate && !privacyCandidate) throw failure('JOB_HH_DOM_CHANGED');
      return { page, captchaAttempt: attempt, releaseReadGuard: () => page.unroute('**/*', readGuard) };
    } catch (error) {
      await page.close().catch(() => {});
      if (this.onManualRequired && ['search', 'vacancy'].includes(expected)
        && (['JOB_HH_CAPTCHA_REQUIRED', 'JOB_HH_CAPTCHA_MANUAL_REQUIRED'].includes(error.code) || attempt?.permitted === 1)) {
        const recoveryId = await this.onManualRequired(url, error);
        throw Object.assign(failure('JOB_HH_CAPTCHA_MANUAL_REQUIRED'), { recoveryId });
      }
      if (attempt?.permitted === 1) throw this.captchaRecovery.manual(attempt);
      if (/^JOB_[A-Z_]+$/.test(error.code || '')) throw error;
      throw failure('JOB_HH_UNAVAILABLE');
    }
  }
  async read(url, expected, reader) {
    const opened = await this.open(url, expected);
    try {
      const value = await reader(opened.page);
      if (opened.captchaAttempt) await this.captchaRecovery.success(url, opened.captchaAttempt);
      return value;
    } catch (error) {
      if (opened.captchaAttempt?.permitted === 1) {
        if (this.onManualRequired) {
          const recoveryId = await this.onManualRequired(url, error);
          throw Object.assign(failure('JOB_HH_CAPTCHA_MANUAL_REQUIRED'), { recoveryId });
        }
        throw this.captchaRecovery.manual(opened.captchaAttempt);
      }
      throw error;
    } finally { await opened.page.close().catch(() => {}); }
  }
  search({ query, publishedFrom, publishedTo, page = 0 }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(page) || page < 0 || page >= CAPABILITIES.maxPages
      || !Number.isFinite(Date.parse(publishedFrom)) || !Number.isFinite(Date.parse(publishedTo))
      || Date.parse(publishedFrom) > Date.parse(publishedTo)) return Promise.reject(failure('JOB_INVALID_SEARCH'));
    const age = this.now().getTime() - Date.parse(publishedFrom);
    if (age > 30 * 86400000 || age < 0) return Promise.reject(failure('JOB_COLLECTION_WINDOW_EXPIRED'));
    const url = new URL('https://hh.ru/search/vacancy');
    url.search = new URLSearchParams({ text: query, search_period: String(Math.max(1, Math.ceil(age / 86400000))),
      order_by: 'publication_time', items_on_page: '20', page: String(page) }).toString();
    return this.run(() => this.read(url.href, 'search', readSearchPage));
  }
  getVacancy({ externalId }) {
    if (!/^\d{1,20}$/.test(String(externalId))) return Promise.reject(failure('JOB_INVALID_VACANCY'));
    return this.run(() => this.read(`https://hh.ru/vacancy/${externalId}`, 'vacancy', (page) => readVacancyPage(page, externalId)));
  }
  listResumes() { return this.run(() => this.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes)); }
  inspect({ externalId, resumeId }) {
    return this.run(() => this.inspectNow({ externalId, resumeId }));
  }
  async inspectNow({ externalId, resumeId }) {
    if (!/^\d{1,20}$/.test(String(externalId)) || !this.primaryResumeId || resumeId !== this.primaryResumeId) return Promise.reject(failure('JOB_HH_RESUME_UNAVAILABLE'));
    const resumes = await this.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes);
    if (!resumes.some((resume) => resume.id === resumeId)) return { resumeAvailable: false, manualRequired: true,
      reasonCode: 'JOB_HH_RESUME_UNAVAILABLE', vacancy: null };
    const details = await this.read(`https://hh.ru/vacancy/${externalId}`, 'vacancy', async (page) => ({
      vacancy: await readVacancyPage(page, externalId), employerId: await readEmployerId(page),
      alreadyApplied: await page.locator('[data-qa="vacancy-response-link-view-topic"], [data-qa="vacancy-response-link-top-again"]').count() > 0,
    }));
    if (details.alreadyApplied) return { vacancy: details.vacancy, resumeAvailable: true, manualRequired: true, reasonCode: 'JOB_HH_ALREADY_APPLIED' };
    const privacy = await this.read(`https://hh.ru/resume/${resumeId}`, 'resume_privacy', (page) => readResumePrivacy(page, { resumeId }));
    const permission = evaluatePrivacy({ privacy, employerId: details.employerId });
    if (!permission.allowed) return { vacancy: details.vacancy, resumeAvailable: true, manualRequired: true, reasonCode: permission.reasonCode };
    const state = await this.read(`https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`, 'application',
      (page) => readApplicationForm(page, { externalId: String(externalId), resumeId, resumes }));
    return { vacancy: details.vacancy, ...state };
  }
}

module.exports = { HhBrowser, CAPABILITIES };
