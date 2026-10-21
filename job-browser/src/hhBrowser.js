const { allowedRequest, isApprovedHhLoginRequest } = require('./networkPolicy');
const { validEvent } = require('./rpcProtocol');
const { classifyPage, classifySession } = require('./pageSignals');
const { readSearchPage, readVacancyPage, readResumes } = require('./hhPageReader');
const { readApplicationForm } = require('./hhApplicationForm');
const { readResumePrivacy, readEmployerId, evaluatePrivacy } = require('./hhPrivacy');
const { dispatchCaptcha } = require('./captchaDispatch');
const { bounded } = require('./browserHealth');
const { readHistoryPage } = require('./hhHistoryReader');
const { readLoginInputFields } = require('./loginInputFields');
const {readExistingApplication,visibleAppliedAction}=require('./existingApplication');
const failure = (code) => Object.assign(new Error(code), { code });
const CAPABILITIES = Object.freeze({ dateWindows: false, maxPages: 1000 });

class HhBrowser {
  constructor({ context, now = () => new Date(), primaryResumeId = null, captchaRecovery = null, captchaDispatch = dispatchCaptcha,
    manualCoordinator = null, onManualRequired = null, onAuthenticated = async () => {},
    operationTimeoutMs = 80000, onTimeout = () => {} }) {
    if (!context || typeof context.newPage !== 'function') throw failure('JOB_BROWSER_CONTEXT_REQUIRED');
    this.context = context; this.now = now; this.tail = Promise.resolve(); this.capabilities = CAPABILITIES;
    this.primaryResumeId = primaryResumeId;
    this.captchaRecovery = captchaRecovery;
    this.captchaDispatch = captchaDispatch;
    this.manualCoordinator = manualCoordinator;
    this.onManualRequired = onManualRequired;
    this.onAuthenticated = onAuthenticated;
    this.operationTimeoutMs = operationTimeoutMs; this.onTimeout = onTimeout;
    this.activeOperations = 0;
    this.loginPage = null; this.loginSessionId = null; this.loginState = 'closed'; this.loginResumes = [];
    this.loginExpiresAt = 0; this.loginNextSequence = 1; this.loginGestureAt = 0; this.loginMainStatus = 0;
    this.loginExpiryTimer = null;
  }
  // One persistent profile, one active read. A rejected operation must not poison the queue.
  run(fn) {
    const pending = this.tail.then(async () => {
      this.activeOperations++;
      try { return await bounded(fn, this.operationTimeoutMs); }
      catch (error) { if (error.code === 'JOB_BROWSER_OPERATION_TIMEOUT') this.onTimeout(); throw error; }
      finally { this.activeOperations--; }
    });
    this.tail = pending.catch(() => {}); return pending;
  }
  isBusy() { return this.activeOperations > 0; }
  hasLoginSession() { return Boolean(this.loginSessionId && ['waiting','captcha','authenticated'].includes(this.loginState)); }

  startLogin({ sessionId }) {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(sessionId || '')) return Promise.reject(failure('JOB_BROWSER_INVALID_REQUEST'));
    return this.run(async () => {
      if (this.loginSessionId === sessionId && ['waiting','captcha','authenticated'].includes(this.loginState)) return { ok: true };
      if (this.loginPage && !this.loginPage.isClosed()) throw failure('JOB_BROWSER_BUSY');
      const page = await this.context.newPage();
      this.loginPage = page; this.loginSessionId = sessionId; this.loginState = 'waiting';
      this.loginResumes = []; this.loginExpiresAt = Date.now() + 600000; this.loginNextSequence = 1; this.loginGestureAt = 0;
      clearTimeout(this.loginExpiryTimer);
      this.loginExpiryTimer = setTimeout(() => { void this.expireLogin(sessionId); }, 600000);
      this.loginExpiryTimer.unref?.();
      this.loginMainStatus = 0;
      page.setViewportSize({ width: 1024, height: 768 }); page.setDefaultTimeout(10000);
      page.on('response', (response) => {
        try { if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) this.loginMainStatus = response.status(); } catch {}
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        const method = request.method();
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return allowedRequest(request.url()) ? route.continue() : route.abort();
        let permitted = false;
        try {
          permitted = this.loginPage === page && ['waiting','captcha'].includes(this.loginState)
            && Date.now() - this.loginGestureAt <= 2000
            && request.frame() === page.mainFrame()
            && isApprovedHhLoginRequest(method, request.resourceType(), request.url());
        } catch {}
        return permitted ? route.continue() : route.abort();
      });
      await page.goto('https://hh.ru/account/login?role=applicant', { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { ok: true };
    });
  }

  expireLogin(sessionId) {
    return this.run(async () => {
      if (this.loginSessionId !== sessionId || Date.now() < this.loginExpiresAt || this.loginState === 'expired') return;
      if (this.loginPage && !this.loginPage.isClosed()) await this.loginPage.close().catch(() => {});
      this.loginPage = null; this.loginState = 'expired'; this.loginResumes = [];
    });
  }

  async observeLogin() {
    if (this.loginSessionId && Date.now() >= this.loginExpiresAt) {
      if (this.loginPage && !this.loginPage.isClosed()) await this.loginPage.close().catch(() => {});
      this.loginPage = null; this.loginState = 'expired'; this.loginResumes = [];
      return { state: 'expired', resumes: [], nextSequence: this.loginNextSequence };
    }
    if (this.loginState === 'authenticated') return { state: 'authenticated', resumes: this.loginResumes, nextSequence: this.loginNextSequence };
    if (!this.loginPage || this.loginPage.isClosed() || Date.now() >= this.loginExpiresAt) {
      this.loginState = Date.now() >= this.loginExpiresAt ? 'expired' : 'closed';
      return { state: this.loginState, resumes: [], nextSequence: this.loginNextSequence };
    }
    const current = await this.loginPage.evaluate(() => ({ pathname: location.pathname,
      text: document.body?.innerText?.slice(0, 64000) || '',
      iframeSources: [...document.querySelectorAll('iframe')].slice(0, 100).filter(node => node.getClientRects().length).map(node => node.src) }));
    const result = classifySession({ ...current, status: this.loginMainStatus });
    if (result.state === 'captcha') this.loginState = 'captcha';
    else if (result.authenticated) {
      const resumes = await readResumes(this.loginPage);
      if (!Array.isArray(resumes) || resumes.length < 1 || resumes.length > 20) throw failure('JOB_HH_DOM_CHANGED');
      this.loginResumes = resumes.map(({ id, title }) => ({ id, title }));
      this.loginState = 'authenticated';
      await this.onAuthenticated();
      await this.loginPage.close().catch(() => {});
      this.loginPage = null;
    } else this.loginState = 'waiting';
    return { state: this.loginState, resumes: this.loginState === 'authenticated' ? this.loginResumes : [], nextSequence: this.loginNextSequence };
  }

  loginFrame({ sessionId }) {
    return this.run(async () => {
      if (sessionId !== this.loginSessionId || !this.loginPage || this.loginPage.isClosed()) throw failure('JOB_LOGIN_SESSION_INVALID');
      const state = await this.observeLogin();
      if (state.state !== 'waiting' && state.state !== 'captcha') throw failure('JOB_LOGIN_SESSION_INVALID');
      const frame = await this.loginPage.screenshot({ type: 'jpeg', quality: 60, animations: 'disabled', caret: 'hide' });
      if (frame.length > 512 * 1024) throw failure('JOB_BROWSER_RESPONSE_TOO_LARGE');
      const inputFields = await readLoginInputFields(this.loginPage);
      return { state: state.state, mimeType: 'image/jpeg', frameBase64: frame.toString('base64'), width: 1024, height: 768, inputFields };
    });
  }

  loginInput({ sessionId, sequence, event }) {
    return this.run(async () => {
      if (sessionId !== this.loginSessionId || !this.loginPage || this.loginPage.isClosed()
        || this.loginState === 'authenticated' || !Number.isSafeInteger(sequence) || sequence < 1) throw failure('JOB_LOGIN_SESSION_INVALID');
      if (sequence < this.loginNextSequence) {
        const state = await this.observeLogin();
        return { state: state.state, nextSequence: this.loginNextSequence };
      }
      if (sequence !== this.loginNextSequence) throw failure('JOB_BROWSER_INVALID_REQUEST');
      if (!validEvent(event)) throw failure('JOB_BROWSER_INVALID_REQUEST');
      const page = this.loginPage;
      const coordinate = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;
      this.loginGestureAt = Date.now();
      // Consume the sequence before dispatch. If the response is lost, a retry
      // cannot repeat a text insertion or a submit click.
      this.loginNextSequence++;
      if (event?.type === 'pointer' && Object.keys(event).sort().join(',') === 'action,button,type,x,y'
        && ['move','down','up','click'].includes(event.action) && ['left','middle','right'].includes(event.button)
        && coordinate(event.x, 1024) && coordinate(event.y, 768)) {
        await page.mouse.move(event.x, event.y);
        if (event.action === 'down') await page.mouse.down({ button: event.button });
        else if (event.action === 'up') await page.mouse.up({ button: event.button });
        else if (event.action === 'click') await page.mouse.click(event.x, event.y, { button: event.button });
      } else if (event?.type === 'wheel' && Object.keys(event).sort().join(',') === 'deltaX,deltaY,type,x,y'
        && coordinate(event.x, 1024) && coordinate(event.y, 768) && Number.isFinite(event.deltaX) && Math.abs(event.deltaX) <= 1000
        && Number.isFinite(event.deltaY) && Math.abs(event.deltaY) <= 1000) {
        await page.mouse.move(event.x, event.y); await page.mouse.wheel(event.deltaX, event.deltaY);
      } else if (event?.type === 'key' && Object.keys(event).sort().join(',') === 'action,key,type'
        && ['press','down','up'].includes(event.action) && /^[A-Za-z0-9_+\-]{1,24}$/.test(event.key)
        && ['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Shift','Control','Alt','Meta',
          '0','1','2','3','4','5','6','7','8','9'].includes(event.key)) {
        if (event.action === 'press') await page.keyboard.press(event.key);
        else if (event.action === 'down') await page.keyboard.down(event.key);
        else await page.keyboard.up(event.key);
      } else if (event?.type === 'text' && Object.keys(event).sort().join(',') === 'type,value'
        && typeof event.value === 'string' && event.value.length > 0 && event.value.length <= 64
        && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(event.value)) {
        await page.keyboard.insertText(event.value);
      } else throw failure('JOB_BROWSER_INVALID_REQUEST');
      const state = await this.observeLogin();
      return { state: state.state, nextSequence: this.loginNextSequence };
    });
  }

  loginStatus({ sessionId }) {
    return this.run(async () => {
      if (sessionId !== this.loginSessionId) throw failure('JOB_LOGIN_SESSION_INVALID');
      return this.observeLogin();
    });
  }

  closeLogin({ sessionId, preserveProfile = false, complete = false }) {
    return this.run(async () => {
      if (sessionId !== this.loginSessionId) throw failure('JOB_LOGIN_SESSION_INVALID');
      if (this.loginPage && !this.loginPage.isClosed()) await this.loginPage.close().catch(() => {});
      this.loginPage = null;
      if (!preserveProfile || complete) {
        clearTimeout(this.loginExpiryTimer); this.loginExpiryTimer = null;
        this.loginState = 'closed'; this.loginResumes = [];
        if (complete) this.loginSessionId = null;
      }
      return { ok: true };
    });
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
      const historyCandidate = expected === 'history' && signal.state === 'unknown'
        && response?.status() === 200 && current.pathname === '/applicant/negotiations';
      if (signal.state !== expected && !zeroCandidate && !formCandidate && !privacyCandidate && !historyCandidate) throw failure('JOB_HH_DOM_CHANGED');
      return { page, captchaAttempt: attempt, releaseReadGuard: () => page.unroute('**/*', readGuard) };
    } catch (error) {
      await page.close().catch(() => {});
      if (this.onManualRequired && ['search', 'vacancy', 'history', 'authenticated'].includes(expected)
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
  history({ section, page }) {
    if (!['active','archived'].includes(section) || !Number.isInteger(page) || page < 0 || page >= 1000) return Promise.reject(failure('JOB_INVALID_SEARCH'));
    return this.run(async () => {
      const resumes = await this.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes);
      if (!this.primaryResumeId || !resumes.some(r => r.id === this.primaryResumeId)) throw failure('JOB_HH_RESUME_UNAVAILABLE');
      return this.read(`https://hh.ru/applicant/negotiations?filter=${section}&page=${page}`, 'history', p => readHistoryPage(p, {section,page}));
    });
  }
  inspect({ externalId, resumeId }) {
    return this.run(() => this.inspectNow({ externalId, resumeId }));
  }
  async inspectNow({ externalId, resumeId }) {
    if (!/^\d{1,20}$/.test(String(externalId)) || !this.primaryResumeId || resumeId !== this.primaryResumeId) return Promise.reject(failure('JOB_HH_RESUME_UNAVAILABLE'));
    const resumes = await this.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes);
    if (!resumes.some((resume) => resume.id === resumeId)) return { resumeAvailable: false, manualRequired: true,
      reasonCode: 'JOB_HH_RESUME_UNAVAILABLE', vacancy: null };
    const details = await this.read(`https://hh.ru/vacancy/${externalId}`, 'vacancy', async page => {
      const vacancy=await readVacancyPage(page,externalId);
      return{vacancy,employerId:await readEmployerId(page),existing:await readExistingApplication(page,{externalId:String(externalId),resumeId,vacancy}),visibleApplied:await visibleAppliedAction(page)};
    });
    if(details.existing)return{vacancy:details.vacancy,resumeAvailable:true,manualRequired:true,reasonCode:'JOB_HH_ALREADY_APPLIED',existingApplicationId:details.existing.topicId,existingApplication:details.existing};
    if(details.visibleApplied)return{vacancy:details.vacancy,resumeAvailable:true,manualRequired:true,reasonCode:'JOB_HH_FORM_CHANGED'};
    const privacy = await this.read(`https://hh.ru/resume/${resumeId}`, 'resume_privacy', (page) => readResumePrivacy(page, { resumeId }));
    const permission = evaluatePrivacy({ privacy, employerId: details.employerId });
    if (!permission.allowed) return { vacancy: details.vacancy, resumeAvailable: true, manualRequired: true, reasonCode: permission.reasonCode };
    const state = await this.read(`https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`, 'application',
      (page) => readApplicationForm(page, { externalId: String(externalId), resumeId, resumes }));
    return { vacancy: details.vacancy, ...state };
  }
}

module.exports = { HhBrowser, CAPABILITIES };
