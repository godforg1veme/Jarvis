const { createHash } = require('node:crypto');
const { validInit, validAnswerRequest, readForm, validPictureKey } = require('./captchaProtocol');
const { readSearchPage, readVacancyPage } = require('./hhPageReader');
const { classifyPage } = require('./pageSignals');
const { dispatchCaptcha } = require('./captchaDispatch');
const { parseFields } = require('./submissionProtocol');
const { validTarget, fail } = require('./manualState');
class ManualBrowser {
  constructor({ context, coordinator, journal, dispatch = dispatchCaptcha }) {
    Object.assign(this, { context, coordinator, journal, dispatch });
    this.page = null; this.frozen = null; this.initAllowed = false; this.refreshing = false;
    this.dispatches = new Set();
    this.timer = setInterval(() => { if (coordinator.status().phase === 'active') void this.refresh().catch(() => {}); }, 250);
    this.timer.unref?.();
  }
  async open(target) {
    if (!validTarget(target)) throw fail();
    await this.drain();
    this.frozen = null; this.initAllowed = true;
    if (!this.page || this.page.isClosed()) this.page = this.context.pages().find((p) => p.url() === 'about:blank') || await this.context.newPage();
    await this.page.bringToFront();
    await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.refresh();
  }
  async refresh() {
    if (this.refreshing || !this.page || this.page.isClosed() || this.coordinator.status().phase !== 'active') return;
    this.refreshing = true;
    try {
      const target = this.coordinator.state.target;
      const revision = this.coordinator.status().revision;
      const form = await readForm(this.page, target);
      if (!form) { this.frozen = null; return; }
      const keys = await this.page.locator('img').evaluateAll((nodes) => nodes.slice(0, 50).flatMap((n) => {
        try {
          const u = new URL(n.src);
          return n.getClientRects().length && n.naturalWidth > 0 && n.naturalWidth <= 1024 && n.naturalHeight > 0 && n.naturalHeight <= 256
            && u.origin === 'https://hh.ru' && !u.username && !u.password && !u.hash && u.pathname === '/captcha/picture'
            && u.searchParams.size === 1 ? [u.searchParams.get('key')] : [];
        } catch { return []; }
      }));
      this.frozen = this.coordinator.status().phase === 'active' && this.coordinator.status().revision === revision
        && this.coordinator.state.target === target && keys.length === 1 && validPictureKey(keys[0]) ? { form, key: keys[0], target } : null;
      if (this.frozen && this.coordinator.state.seedRequired) {
        const baseline = createHash('sha256').update(JSON.stringify(['hh-captcha', keys[0]])).digest('hex');
        this.frozen = null;
        void this.coordinator.seedBaseline(baseline, revision).catch(() => {});
      }
    } finally { this.refreshing = false; }
  }
  async permit(route) {
    const req = route.request();
    if (!this.page || this.page.isClosed() || req.frame() !== this.page.mainFrame()
      || !this.coordinator.canInput()) return false;
    const headers = req.headers(), input = { url: req.url(), method: req.method(), contentType: headers['content-type'],
      body: req.postDataBuffer(), csrfToken: headers['x-xsrftoken'], navigation: req.isNavigationRequest(), resourceType: req.resourceType() };
    if (this.initAllowed && validInit(input)) {
      this.initAllowed = false;
      const revision = this.coordinator.status().revision;
      if (!await readForm(this.page, this.coordinator.state.target) || this.coordinator.status().phase !== 'active'
        || this.coordinator.status().revision !== revision) return false;
      await this.dispatch(route); return true;
    }
    if (!this.frozen || this.frozen.target !== this.coordinator.state.target || input.url.length > 24576) return false;
    let answer;
    try { answer = input.body?.length ? parseFields(input)?.get('captchaText') : new URL(input.url).searchParams.get('captchaText'); }
    catch { return false; }
    const { form, key, target } = this.frozen;
    if (!validAnswerRequest(input, form, target, answer, key)) return false;
    const challenge = createHash('sha256').update(JSON.stringify(['hh-captcha', key])).digest('hex');
    await this.coordinator.claim(challenge);
    if (!this.coordinator.canInput()) return false;
    const dispatched = this.dispatch(route); this.dispatches.add(dispatched);
    try { await dispatched; } finally { this.dispatches.delete(dispatched); }
    return true;
  }
  async drain() { await Promise.allSettled([...this.dispatches]); }
  async verify(target, recoveryId) {
    await this.drain();
    if (!this.page || this.page.isClosed() || !validTarget(target)) return false;
    this.frozen = null; this.initAllowed = false;
    const response = await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1500);
    const current = new URL(this.page.url());
    if (current.href !== target || response?.status() !== 200) return false;
    const observation = await this.page.evaluate(() => ({ text: document.body?.innerText?.slice(0, 64000) || '',
      vacancyLinks: document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]').length,
      vacancyContent: Boolean(document.querySelector('[data-qa="vacancy-description"]')),
      iframeSources: [...document.querySelectorAll('iframe')].slice(0, 100).filter((n) => n.getClientRects().length).map((n) => n.src) }));
    const signal = classifyPage({ ...observation, pathname: current.pathname, status: response.status() });
    if (new URL(target).pathname === '/search/vacancy') {
      if (!['search', 'unknown'].includes(signal.state) || current.pathname !== '/search/vacancy') return false;
      await readSearchPage(this.page);
    } else {
      if (signal.state !== 'vacancy' || current.href !== target) return false;
      await readVacancyPage(this.page, current.pathname.split('/').pop());
    }
    if (this.journal) {
      const state = await this.journal.read();
      if (!state || state.operationId !== recoveryId) return false;
      await this.journal.write({ ...state, phase: 'resolved' });
    }
    return true;
  }
  async close() { clearInterval(this.timer); await this.page?.close().catch(() => {}); }
}
module.exports = { ManualBrowser };
