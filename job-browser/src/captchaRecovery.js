const { createHash, randomUUID } = require('node:crypto');
const { validInit, validAnswer, validPictureKey, validAnswerRequest, sameForm, readForm, targetUrl } = require('./captchaProtocol');
const { recognizePng } = require('./ocrClient');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const failure = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
class CaptchaRecovery {
  constructor({ journal, recognize = recognizePng, now = () => Date.now(), responseTimeoutMs = 15000 }) {
    Object.assign(this, { journal, recognize, now, responseTimeoutMs });
  }
  async begin(page, target) {
    if (!targetUrl(target)) return null;
    const state = await this.journal.read();
    return { page, target, state, initCount: 0, permitted: 0, armed: false,
      canInit: state?.phase === 'waiting' && this.now() >= state.retryAt };
  }
  async permit(attempt, request) {
    if (!attempt || request.frame() !== attempt.page.mainFrame()) return false;
    const headers = request.headers();
    const input = { url: request.url(), method: request.method(), contentType: headers['content-type'], body: request.postDataBuffer(),
      csrfToken: headers['x-xsrftoken'], navigation: request.isNavigationRequest(), resourceType: request.resourceType() };
    if (attempt.canInit && !attempt.initCount && validInit(input) && await readForm(attempt.page, attempt.target)) {
      if (attempt.initCount) return false;
      attempt.initCount++;
      attempt.state = await this.journal.write({ ...attempt.state, phase: 'initializing' });
      return true;
    }
    if (attempt.armed && !attempt.permitted && validAnswerRequest(input, attempt.form, attempt.target, attempt.answer, attempt.pictureKey)) {
      // A native form navigation can suspend DOM evaluation. The exact frozen
      // action and hidden values are already rechecked before arming, and the
      // outgoing body or native XHR query must still match them here.
      attempt.permitted++; attempt.request = request; return true;
    }
    return false;
  }
  manual(attempt) { return failure('JOB_HH_CAPTCHA_MANUAL_REQUIRED', attempt.state ? { recoveryId: attempt.state.operationId } : {}); }
  async recover(attempt) {
    if (!attempt) throw failure('JOB_HH_CAPTCHA_REQUIRED');
    if (!attempt.state || attempt.state.phase === 'resolved') {
      const detectedAt = this.now();
      attempt.state = await this.journal.write({ version: 1, ownerId: this.journal.ownerId, operationId: randomUUID(),
        phase: 'waiting', detectedAt, retryAt: detectedAt + 120000, targetHash: hash(attempt.target) });
    }
    if (attempt.state.phase !== 'waiting' && !(attempt.state.phase === 'initializing' && attempt.initCount === 1)) throw this.manual(attempt);
    if (this.now() < attempt.state.retryAt || !attempt.canInit) throw failure('JOB_HH_CAPTCHA_WAITING', {
      retryAfterMs: Math.max(1000, Math.min(120000, attempt.state.retryAt - this.now())) });
    try {
      const form = await readForm(attempt.page, attempt.target);
      if (!form || attempt.initCount !== 1) throw this.manual(attempt);
      const picture = attempt.page.locator('img');
      let image;
      for (const node of (await picture.all()).slice(0, 50)) {
        if (!await node.isVisible()) continue;
        if (await node.evaluate((n) => { try { const u = new URL(n.src); return u.origin === 'https://hh.ru' && u.pathname === '/captcha/picture'
          && u.searchParams.size === 1 && Boolean(u.searchParams.get('key')) && n.naturalWidth > 0 && n.naturalWidth <= 1024 && n.naturalHeight > 0 && n.naturalHeight <= 256; } catch { return false; } })) { if (image) throw this.manual(attempt); image = node; }
      }
      if (!image) throw this.manual(attempt);
      const pictureSource = await image.getAttribute('src');
      const pictureUrl = new URL(pictureSource, attempt.page.url());
      const pictureKey = pictureUrl.searchParams.get('key');
      if (pictureUrl.origin !== 'https://hh.ru' || pictureUrl.pathname !== '/captcha/picture'
        || pictureUrl.username || pictureUrl.password || pictureUrl.hash || pictureUrl.searchParams.size !== 1
        || !validPictureKey(pictureKey)) throw this.manual(attempt);
      const box = await image.boundingBox();
      if (!box || box.width < 1 || box.height < 1 || box.width > 2048 || box.height > 512 || box.width * box.height > 1048576) throw this.manual(attempt);
      const answer = await this.recognize(await image.screenshot({ type: 'png', scale: 'css', timeout: 5000 }));
      if (!validAnswer(answer)) throw this.manual(attempt);
      const fresh = await readForm(attempt.page, attempt.target);
      if (!fresh || !sameForm(form, fresh) || await image.getAttribute('src') !== pictureSource) throw this.manual(attempt);
      attempt.form = fresh; attempt.answer = answer; attempt.pictureKey = pictureKey;
      await attempt.page.locator('input[name="captchaText"]').fill(answer);
      // Persist before arming the only answer POST. An uncertain attempt is never replayed.
      attempt.state = await this.journal.write({ ...attempt.state, phase: 'attempted', challengeHash: hash(JSON.stringify(['hh-captcha', pictureKey])) });
      const receipt = attempt.page.waitForResponse((r) => attempt.request && r.request() === attempt.request, { timeout: this.responseTimeoutMs }).catch(() => null);
      attempt.armed = true;
      await attempt.page.locator('form:has(input[name="captchaText"]) button[type="submit"]').click({ timeout: 5000 }).catch(() => {});
      await receipt;
      attempt.armed = false;
      if (attempt.permitted !== 1) throw this.manual(attempt);
      // Read-only reconciliation also handles a lost POST response; never click again.
      return await attempt.page.goto(attempt.target, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch {
      attempt.armed = false;
      attempt.state = await this.journal.write({ ...attempt.state, phase: 'blocked' });
      throw this.manual(attempt);
    }
  }
  async success(target, attempt) {
    const state = await this.journal.read();
    if (state && state.phase !== 'resolved' && (state.targetHash === hash(target)
      || attempt?.permitted === 1 && state.operationId === attempt.state.operationId)) await this.journal.write({ ...state, phase: 'resolved' });
  }
}
module.exports = { CaptchaRecovery };
