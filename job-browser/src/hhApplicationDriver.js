const { allowedRequest } = require('./networkPolicy');
const { readResumes, readVacancyPage } = require('./hhPageReader');
const { readApplicationForm } = require('./hhApplicationForm');
const { readResumePrivacy, readEmployerId, evaluatePrivacy } = require('./hhPrivacy');
const { prepareApplicationPage } = require('./hhApplication');
const { validateSubmissionRequest, normalizeSubmissionReceipt } = require('./submissionProtocol');
const { readApplicationReference, verifyChatLetter } = require('./applicationProof');
const {visibleAppliedAction}=require('./existingApplication');

const unknown = () => ({ outcome: 'unknown' });
const manual = () => ({ outcome: 'manual_required', verified: true });

class HhApplicationDriver {
  constructor({ browser, dispatch = (route) => route.continue(), responseTimeoutMs = 25000 }) {
    if (typeof dispatch !== 'function' || !Number.isInteger(responseTimeoutMs) || responseTimeoutMs < 250 || responseTimeoutMs > 30000) throw new Error('JOB_BROWSER_CONFIG_INVALID');
    this.browser = browser; this.dispatch = dispatch; this.responseTimeoutMs = responseTimeoutMs;
  }
  async prepare(input) {
    const hh = this.browser, inspected = await hh.inspectNow(input);
    if (!inspected.resumeAvailable || inspected.manualRequired || inspected.vacancy.archived) return { ready: false };
    const resumes = await hh.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes);
    const opened = await hh.open(`https://hh.ru/applicant/vacancy_response?vacancyId=${input.externalId}`, 'application');
    try {
      const state = await prepareApplicationPage(opened.page, { ...input, resumes });
      return { ...state, page: opened.page, resumes, releaseNavigationGuard: opened.releaseReadGuard };
    } catch (error) { await opened.page.close().catch(() => {}); throw error; }
  }
  async clickAndVerify({ prepared, ...input }) {
    const hh = this.browser, page = prepared.page;
    if (!page || !prepared.ready) return manual();
    // Refresh the employer and privacy policy before the only permitted mutation.
    const source = await hh.read(`https://hh.ru/vacancy/${input.externalId}`, 'vacancy', async (node) => ({
      vacancy: await readVacancyPage(node, input.externalId), employerId: await readEmployerId(node),
      applied: await visibleAppliedAction(node),
    }));
    if (source.vacancy.archived || source.applied) return manual();
    const privacy = await hh.read(`https://hh.ru/resume/${input.resumeId}`, 'resume_privacy',
      (node) => readResumePrivacy(node, { resumeId: input.resumeId }));
    if (!evaluatePrivacy({ privacy, employerId: source.employerId }).allowed) return manual();
    const state = await readApplicationForm(page, { ...input, resumes: prepared.resumes });
    if (state.manualRequired || await page.locator('textarea[data-qa="vacancy-response-popup-form-letter-input"]').inputValue() !== input.letter) return manual();
    const action = await page.locator('[data-qa="vacancy-response-submit-popup"]').evaluate((button) => {
      const form = button.closest('form'); return form ? { method: form.method, url: form.action } : null;
    });
    let target; try { target = new URL(action?.url); } catch { return manual(); }
    if (action.method !== 'post' || target.origin !== 'https://hh.ru' || target.pathname !== '/applicant/vacancy_response'
      || target.username || target.password || target.hash || target.searchParams.size !== 1
      || target.searchParams.get('vacancyId') !== input.externalId) return manual();

    let approvedRequest = null, permitted = 0, armed = false;
    let sawRequest;
    const requestSeen = new Promise((resolve) => { sawRequest = resolve; });
    const guard = async (route) => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return allowedRequest(request.url()) ? route.fallback() : route.abort();
      try {
        if (!armed || permitted || request.frame() !== page.mainFrame() || !validateSubmissionRequest({
          url: request.url(), method: request.method(), contentType: request.headers()['content-type'], body: request.postDataBuffer(),
        }, input)) return route.abort();
        permitted++; approvedRequest = request;
        sawRequest();
        // A page-level continue bypasses the context's read-only fallback for this exact request only.
        return this.dispatch(route);
      } catch { return route.abort().catch(() => {}); }
    };
    await prepared.releaseReadGuard();
    await prepared.releaseNavigationGuard();
    await page.route('**/*', guard);
    const receipt = page.waitForResponse((response) => approvedRequest !== null && response.request() === approvedRequest, { timeout: this.responseTimeoutMs }).catch(() => null);
    try {
      armed = true;
      await page.locator('[data-qa="vacancy-response-submit-popup"]').click({ timeout: 10000 }).catch(() => {});
      if (!permitted) await Promise.race([requestSeen, page.waitForTimeout(3000)]);
      armed = false;
      if (!permitted) return manual();
      const response = await receipt;
      if (!response || response.status() < 200 || response.status() >= 300) return unknown();
      const headers = response.headers();
      if (!/^application\/json(?:;|$)/i.test(headers['content-type'] || '') || Number(headers['content-length'] || 0) > 1048576) return unknown();
      const bytes = await response.body();
      if (bytes.length > 1048576) return unknown();
      let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return unknown(); }
      return normalizeSubmissionReceipt(value, input);
    } catch { return unknown(); }
    finally { armed = false; await page.unroute('**/*', guard).catch(() => {}); }
  }
  async readResult(input) {
    if (typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) return unknown();
    const opened = await this.browser.open(`https://hh.ru/vacancy/${input.externalId}`, 'vacancy'), page = opened.page;
    try {
      const reference = await readApplicationReference(page, input);
      if (!reference) return unknown();
      const buttons = await page.locator('[data-qa="vacancy-response-link-view-topic"]').all();
      let target = null;
      for (const button of buttons.slice(0, 10)) if (await button.isVisible()) { target = button; break; }
      if (!target) return unknown();
      await target.click({ timeout: 5000 });
      let frame;
      for (let attempt = 0; attempt < 50; attempt++) {
        frame = page.frames().find((candidate) => { try { const url = new URL(candidate.url());
          return url.origin === 'https://chatik.hh.ru' && url.pathname === `/chat/${reference.chatId}`;
        } catch { return false; } });
        if (frame) break;
        await page.waitForTimeout(100);
      }
      if (!frame) return unknown();
      await frame.locator('[data-qa="chat-bubble-title"]').first().waitFor({ state: 'attached', timeout: 5000 });
      return await verifyChatLetter(frame, input) ? { outcome: 'sent', verified: true, externalId: reference.topicId } : unknown();
    } catch { return unknown(); }
    finally { await page.close().catch(() => {}); }
  }
  async close(prepared) { await prepared?.page?.close(); }
}

module.exports = { HhApplicationDriver };
