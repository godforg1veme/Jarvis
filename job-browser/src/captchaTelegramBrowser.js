const { randomUUID, createHash } = require('node:crypto');
const { validInit, validAnswerRequest, readForm, sameForm, validPictureKey } = require('./captchaProtocol');
const { normalizeAnswer } = require('./captchaTelegramProtocol');
const { readSearchPage, readVacancyPage, readResumes } = require('./hhPageReader');
const {readHistoryPage}=require('./hhHistoryReader');
const { classifyPage, classifySession } = require('./pageSignals');
const { dispatchCaptcha } = require('./captchaDispatch');
const { validTarget, fail } = require('./manualState');
const { bounded } = require('./browserHealth');
const hashKey = key => createHash('sha256').update(JSON.stringify(['hh-captcha', key])).digest('hex');
const hashOperation = id => createHash('sha256').update(JSON.stringify(['hh-telegram-operation', id])).digest('hex');
function validPng(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 33 && bytes.length <= 256 * 1024
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 1024
    && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 256;
}
class CaptchaTelegramBrowser {
  constructor({ context, coordinator, journal, dispatch = dispatchCaptcha, now = Date.now, receiptTimeout = 12000,
    closeTimeoutMs = 2000, onUnhealthy = () => {} }) {
    Object.assign(this, { context, coordinator, journal, dispatch, now, receiptTimeout, closeTimeoutMs, onUnhealthy });
    this.page = null; this.current = null; this.armed = null; this.initAllowed = false; this.dispatches = new Set();
    this.crashed = new WeakSet();
    this.tail = Promise.resolve();
  }
  async open(target) {
    if (!validTarget(target)) throw fail();
    await this.drain(); this.current = null; this.armed = null; this.initAllowed = true;
    // isClosed() remains false for a crashed renderer. Never navigate the old
    // challenge tab again after an OOM or keep its accumulated page resources.
    const old = this.page; this.page = null;
    try {
      if (old) await bounded(() => old.close(), this.closeTimeoutMs);
      this.page = await bounded(() => this.context.newPage(), 5000);
    } catch (error) { this.onUnhealthy(); throw error; }
    const page = this.page; page.once('crash', () => this.crashed.add(page));
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  async picture() {
    if (!this.page || this.page.isClosed() || this.crashed.has(this.page)) return null;
    const target = this.coordinator.state.target, form = await readForm(this.page, target);
    if (!form) return null;
    const images = await this.page.locator('img').evaluateAll(nodes => nodes.slice(0, 50).flatMap((n, index) => {
      try {
        const u = new URL(n.src), r = n.getBoundingClientRect();
        const visible = n.getClientRects().length && r.width > 0 && r.width <= 1024 && r.height > 0 && r.height <= 256
          && [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]].every(([x, y]) => document.elementFromPoint(r.x + r.width * x, r.y + r.height * y) === n);
        return visible && n.complete && n.naturalWidth > 0 && n.naturalWidth <= 1024 && n.naturalHeight > 0 && n.naturalHeight <= 256
          && u.origin === 'https://hh.ru' && !u.username && !u.password && !u.hash && u.pathname === '/captcha/picture'
          && u.searchParams.size === 1 ? [{ index, key: u.searchParams.get('key') }] : [];
      } catch { return []; }
    }));
    return images.length === 1 && validPictureKey(images[0].key) ? { ...images[0], form, target } : null;
  }
  run(fn) { const pending = this.tail.then(fn); this.tail = pending.catch(() => {}); return pending; }
  challenge(refresh) { return this.run(() => this.automatic
    ? this.automatic.challenge(this, refresh) : this.issueChallenge(refresh)); }
  async issueChallenge(refresh) {
    const status = this.coordinator.status();
    if (status.phase === 'idle') { this.current = null; return { outcome: 'idle' }; }
    if (this.current && !refresh) {
      if (!this.current.used && this.current.revision === status.revision && this.current.expires > this.now()
        && this.page && !this.page.isClosed() && !this.crashed.has(this.page)) return this.publicChallenge();
      return { outcome: 'refresh_required' };
    }
    if (status.phase === 'checking') throw fail('JOB_CAPTCHA_BUSY');
    const opened = await this.coordinator.start(status.revision);
    if (opened.phase !== 'active') throw fail('JOB_CAPTCHA_UNAVAILABLE');
    const waitPicture = async () => {
      let picture = null;
      for (let i = 0; i < 80 && !picture; i++) { picture = await this.picture(); if (!picture) await this.page.waitForTimeout(50); }
      return picture;
    };
    let picture = await waitPicture();
    if (!picture) {
      if ((await this.coordinator.finish(this.coordinator.status().revision)).phase === 'idle') return { outcome: 'idle' };
      throw fail('JOB_CAPTCHA_UNAVAILABLE');
    }
    if (this.coordinator.state.seedRequired) {
      await this.coordinator.seedBaseline(hashKey(picture.key), this.coordinator.status().revision);
      // This first baseline was never issued as a human challenge. Obtain one
      // fresh key before initial delivery, never retrying an answer or rotating
      // a picture already given to the owner.
      await this.coordinator.start(this.coordinator.status().revision);
      picture = await waitPicture();
      if (!picture) throw fail('JOB_CAPTCHA_UNAVAILABLE');
    }
    const revision = this.coordinator.status().revision;
    if (this.coordinator.state.claims.includes(hashKey(picture.key))) throw fail('JOB_CAPTCHA_UNAVAILABLE');
    // Export decoded image pixels only. A page/element screenshot can include
    // overlapping account UI or a fractional CSS border around the picture.
    const encoded = await this.page.locator('img').nth(picture.index).evaluate(image => {
      if (!image.complete || !image.naturalWidth || image.naturalWidth > 1024 || !image.naturalHeight || image.naturalHeight > 256) return null;
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const result = canvas.toDataURL('image/png');
      return result.startsWith('data:image/png;base64,') && result.length <= 349550 ? result.slice(22) : null;
    });
    const png = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
    const after = await this.picture();
    if (!validPng(png) || !after || !sameForm(picture.form, after.form) || picture.key !== after.key
      || this.coordinator.status().phase !== 'active' || this.coordinator.status().revision !== revision) throw fail('JOB_CAPTCHA_UNAVAILABLE');
    this.current = { ...picture, revision, png, challengeId: randomUUID(), expires: this.now() + 600000, used: false };
    return this.publicChallenge();
  }
  publicChallenge() {
    const value = this.current;
    return { outcome: 'ready', challengeId: value.challengeId, revision: value.revision,
      pngBase64: value.png.toString('base64'), expiresAt: new Date(value.expires).toISOString() };
  }
  answer(input) { return this.run(() => this.submitAnswer(input)); }
  async submitAnswer(input) {
    this.lastAttemptReceipt = null;
    const text = normalizeAnswer(input.text); if (!text) return { outcome: 'invalid' };
    const operationHash = hashOperation(input.operationId);
    if (this.coordinator.state.claims.includes(operationHash)) return { outcome: 'already_used' };
    const current = this.current;
    if (!current || current.challengeId !== input.challengeId || current.revision !== input.revision
      || this.coordinator.status().revision !== input.revision || this.coordinator.status().phase !== 'active'
      || current.expires <= this.now()) return { outcome: 'stale' };
    if (current.used || this.coordinator.state.claims.includes(hashKey(current.key))) return { outcome: 'already_used' };
    if (!this.page || this.page.isClosed() || this.crashed.has(this.page)) return { outcome: 'stale' };
    const picture = await this.picture();
    if (!picture || picture.key !== current.key || picture.target !== current.target || !sameForm(picture.form, current.form)) return { outcome: 'stale' };
    await this.page.locator('form input[name="captchaText"]').fill(text, { timeout: 3000 });
    const filled = await this.picture();
    if (!filled || filled.key !== current.key || !sameForm(filled.form, current.form)) return { outcome: 'stale' };
    await this.coordinator.claimMany([hashKey(current.key), operationHash]);
    current.used = true;
    const armed = { current, text, permitted: 0, request: null }; this.armed = armed;
    let received = false;
    const receipt = this.page.waitForResponse(response => response.request() === armed.request, { timeout: this.receiptTimeout })
      .then(() => { received = true; }).catch(() => {});
    try {
      await this.page.locator('form').filter({ has: this.page.locator('input[name="captchaText"]') }).locator('button[type="submit"], button:not([type]), input[type="submit"]').first().click({ timeout: 3000 });
      await receipt;
    } catch { /* A lost receipt never authorizes another answer POST. */ }
    finally { this.armed = null; }
    await this.drain();
    const result = await this.coordinator.finish(this.coordinator.status().revision);
    if (result.phase === 'idle') this.current = null;
    const rejected = received && armed.permitted === 1 && (!this.automatic
      || armed.acknowledged === true && this.lastVerification === 'captcha');
    this.lastAttemptReceipt = { received, permitted: armed.permitted, httpStatus: armed.httpStatus || null,
      verification: result.phase === 'idle' ? 'verified' : this.lastVerification === 'captcha' ? 'captcha' : 'unconfirmed' };
    return { outcome: result.phase === 'idle' ? 'solved' : rejected ? 'new_challenge' : 'unknown' };
  }
  async permit(route) {
    const req = route.request();
    if (!this.page || this.page.isClosed() || req.frame() !== this.page.mainFrame() || !this.coordinator.canInput()) return false;
    const headers = req.headers(), input = { url: req.url(), method: req.method(), contentType: headers['content-type'], body: req.postDataBuffer(),
      csrfToken: headers['x-xsrftoken'], navigation: req.isNavigationRequest(), resourceType: req.resourceType() };
    if (this.initAllowed && validInit(input)) {
      this.initAllowed = false;
      const revision = this.coordinator.status().revision;
      if (!await readForm(this.page, this.coordinator.state.target) || !this.coordinator.canInput() || this.coordinator.status().revision !== revision) return false;
      await this.dispatch(route); return true;
    }
    const armed = this.armed;
    if (!armed || armed.permitted || armed.current.revision !== this.coordinator.status().revision
      || !validAnswerRequest(input, armed.current.form, armed.current.target, armed.text, armed.current.key)) return false;
    armed.permitted++; armed.request = req;
    const dispatched = this.dispatch(route); this.dispatches.add(dispatched);
    try {
      const result = await dispatched;
      armed.acknowledged = result?.acknowledged === true;
      armed.httpStatus = Number.isInteger(result?.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599 ? result.httpStatus : null;
    } finally { this.dispatches.delete(dispatched); }
    return true;
  }
  async drain() { await Promise.allSettled([...this.dispatches]); }
  async verify(target, recoveryId) {
    this.lastVerification = null;
    await this.drain(); this.armed = null; this.initAllowed = false;
    if (!validTarget(target)) return false;
    const reader = await this.context.newPage();
    try {
      const response = await reader.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await reader.waitForTimeout(1500);
      const current = new URL(reader.url());
      if (response?.status() !== 200) return false;
      if (await readForm(reader, target)) { this.lastVerification = 'captcha'; return false; }
      if (current.href !== target) return false;
      const observation = await reader.evaluate(() => ({ text: document.body?.innerText?.slice(0, 64000) || '',
        vacancyLinks: document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]').length,
        vacancyContent: Boolean(document.querySelector('[data-qa="vacancy-description"]')),
        iframeSources: [...document.querySelectorAll('iframe')].slice(0, 100).filter(n => n.getClientRects().length).map(n => n.src) }));
      const signal = classifyPage({ ...observation, pathname: current.pathname, status: response.status() });
      if (new URL(target).pathname === '/search/vacancy') {
        if (!['search', 'unknown'].includes(signal.state) || current.pathname !== '/search/vacancy') return false;
        await readSearchPage(reader);
      } else if(current.pathname==='/applicant/negotiations') {
        if(signal.state!=='unknown')return false;
        await readHistoryPage(reader,{section:current.searchParams.get('filter'),page:Number(current.searchParams.get('page'))});
      } else if(current.pathname==='/applicant/resumes') {
        if(!classifySession({...observation,pathname:current.pathname,status:response.status()}).authenticated)return false;
        await readResumes(reader);
      } else {
        if (signal.state !== 'vacancy') return false;
        await readVacancyPage(reader, current.pathname.split('/').pop());
      }
      if (this.journal) {
        const state = await this.journal.read();
        if (!state || state.operationId !== recoveryId) return false;
        await this.journal.write({ ...state, phase: 'resolved' });
      }
      return true;
    } finally { await reader.close().catch(() => {}); }
  }
  async close() { this.current = null; this.armed = null; if (this.page) await bounded(() => this.page.close(), 2000).catch(() => {}); }
}
module.exports = { CaptchaTelegramBrowser, validPng, hashKey, hashOperation };
