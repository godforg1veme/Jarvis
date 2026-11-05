const { allowedRequest } = require('./networkPolicy');
const { readResumes, readVacancyPage } = require('./hhPageReader');
const { readApplicationForm } = require('./hhApplicationForm');
const { readResumePrivacy, readEmployerId, evaluatePrivacy } = require('./hhPrivacy');
const { prepareApplicationPage } = require('./hhApplication');
const { validateSubmissionRequest } = require('./submissionProtocol');
const { captureSubmissionReceipt } = require('./submissionReceipt');
const { dispatchApplication } = require('./applicationDispatch');
const { readApplicationReference, verifyChatLetter } = require('./applicationProof');
const { verifyChatData } = require('./chatApplicationProof');
const {visibleAppliedAction}=require('./existingApplication');
const { normalizeQuestionnaire, normalizeAnswers, STOP_REASONS }=require('../../shared/jobQuestionnaire');

const unknown = (reasonCode) => ({ outcome: 'unknown', ...(reasonCode ? { reasonCode } : {}) });
const manual = (reasonCode = 'JOB_HH_FORM_CHANGED') => ({ outcome: 'manual_required', verified: true,
  reasonCode: STOP_REASONS.has(reasonCode) ? reasonCode : 'JOB_HH_FORM_CHANGED' });

class HhApplicationDriver {
  constructor({ browser, dispatch = dispatchApplication, responseTimeoutMs = 25000 }) {
    if (typeof dispatch !== 'function' || !Number.isInteger(responseTimeoutMs) || responseTimeoutMs < 250 || responseTimeoutMs > 30000) throw new Error('JOB_BROWSER_CONFIG_INVALID');
    this.browser = browser; this.dispatch = dispatch; this.responseTimeoutMs = responseTimeoutMs;
  }
  async prepare(input) {
    const hh = this.browser, inspected = await hh.inspectNow(input);
    const questionnaireMatches = (() => {
      try { return input.questionnaire !== undefined && inspected.questionnaire?.hash === normalizeQuestionnaire(input.questionnaire).hash
        && !!normalizeAnswers(input.questionnaire, input.answers); } catch { return false; }
    })();
    if (!inspected.resumeAvailable || (inspected.manualRequired && !(inspected.reasonCode === 'JOB_HH_QUESTIONS_REQUIRED' && questionnaireMatches))
      || inspected.vacancy.archived) return { ready: false, reasonCode: inspected.reasonCode || 'JOB_HH_FORM_CHANGED' };
    if (!inspected.manualRequired && input.questionnaire !== undefined) return { ready: false, reasonCode: 'JOB_HH_FORM_CHANGED' };
    const resumes = await hh.read('https://hh.ru/applicant/resumes', 'authenticated', readResumes);
    const formUrl = inspected.vacancy.manualRequired
      ? `https://hh.ru/applicant/vacancy_response/test?vacancyId=${input.externalId}`
      : `https://hh.ru/applicant/vacancy_response?vacancyId=${input.externalId}`;
    const opened = await hh.open(formUrl, 'application');
    try {
      const state = await prepareApplicationPage(opened.page, { ...input, resumes });
      return { ...state, page: opened.page, resumes, releaseNavigationGuard: opened.releaseReadGuard };
    } catch (error) { await opened.page.close().catch(() => {}); throw error; }
  }
  async clickAndVerify({ prepared, ...input }) {
    const hh = this.browser, page = prepared.page;
    if (!page || !prepared.ready) return manual(prepared.reasonCode);
    // Refresh the employer and privacy policy before the only permitted mutation.
    const source = await hh.read(`https://hh.ru/vacancy/${input.externalId}`, 'vacancy', async (node) => ({
      vacancy: await readVacancyPage(node, input.externalId), employerId: await readEmployerId(node),
      applied: await visibleAppliedAction(node),
    }));
    if (source.vacancy.archived || source.applied) return manual(source.applied ? 'JOB_HH_ALREADY_APPLIED' : 'JOB_HH_NOT_FOUND');
    if (source.vacancy.manualRequired && input.questionnaire === undefined) return manual('JOB_HH_TEST_REQUIRED');
    const privacy = await hh.read(`https://hh.ru/resume/${input.resumeId}`, 'resume_privacy',
      (node) => readResumePrivacy(node, { resumeId: input.resumeId }));
    const permission = evaluatePrivacy({ privacy, employerId: source.employerId });
    if (!permission.allowed) return manual(STOP_REASONS.has(permission.reasonCode) ? permission.reasonCode : 'JOB_HH_PRIVACY_DENIED');
    const state = await readApplicationForm(page, { ...input, resumes: prepared.resumes });
    if (input.questionnaire === undefined ? state.manualRequired
      : state.reasonCode !== 'JOB_HH_QUESTIONS_REQUIRED' || state.questionnaire?.hash !== input.questionnaire.hash)
      return manual(state.reasonCode);
    if (await page.locator('textarea[data-qa="vacancy-response-popup-form-letter-input"]').inputValue() !== input.letter)
      return manual('JOB_HH_LETTER_CHANGED');
    const action = await page.locator('[data-qa="vacancy-response-submit-popup"]').evaluate((button) => {
      const form = button.closest('form'); return form ? { method: form.method, url: form.action, present: true } : null;
    });
    let target; try { target = new URL(action?.url); } catch { return manual(); }
    if (!action?.present || (!input.questionnaire && action.method !== 'post') || target.origin !== 'https://hh.ru'
      || (input.questionnaire ? !['/applicant/vacancy_response/test','/applicant/vacancy_response'].includes(target.pathname)
        || target.pathname !== new URL(page.url()).pathname : target.pathname !== '/applicant/vacancy_response')
      || target.username || target.password || target.hash || target.searchParams.size !== 1
      || target.searchParams.get('vacancyId') !== input.externalId) return manual();

    let approvedRequest = null, permitted = 0, armed = false, blockedMutation = false;
    let sawRequest;
    const requestSeen = new Promise((resolve) => { sawRequest = resolve; });
    let dispatched;
    const dispatchResult = new Promise(resolve => { dispatched = resolve; });
    const guard = async (route) => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return allowedRequest(request.url()) ? route.fallback() : route.abort();
      try {
        if (!armed || permitted || request.frame() !== page.mainFrame() || !validateSubmissionRequest({
          url: request.url(), method: request.method(), contentType: request.headers()['content-type'], body: request.postDataBuffer(),
        }, { ...input, nativeStartTime: prepared.nativeStartTime })) { if (!['GET','HEAD','OPTIONS'].includes(request.method())) blockedMutation = true; return route.abort(); }
        permitted++; approvedRequest = request;
        sawRequest();
        const result = await this.dispatch(route, { ...input, nativeStartTime: prepared.nativeStartTime });
        dispatched(result);
      } catch {
        dispatched(unknown('JOB_HH_RECEIPT_TRANSPORT_FAILED'));
        return route.abort().catch(() => {});
      }
    };
    await prepared.releaseReadGuard();
    await prepared.releaseNavigationGuard();
    await page.route('**/*', guard);
    const receipt = captureSubmissionReceipt({ page, request: () => approvedRequest,
      timeoutMs: this.responseTimeoutMs, input });
    try {
      armed = true;
      await page.locator('[data-qa="vacancy-response-submit-popup"]').click({ timeout: 10000 }).catch(() => {});
      if (!permitted) await Promise.race([requestSeen, page.waitForTimeout(3000)]);
      armed = false;
      if (!permitted) return manual(blockedMutation ? 'JOB_HH_SUBMISSION_BLOCKED' : 'JOB_HH_FORM_CHANGED');
      const result = await dispatchResult;
      return result?.outcome ? result : await receipt;
    } catch { return unknown('JOB_HH_RECEIPT_READ_FAILED'); }
    finally { armed = false; await page.unroute('**/*', guard).catch(() => {}); }
  }
  async readResult(input) {
    if (typeof input.letter !== 'string' || !input.letter.trim() || input.letter.length > 10000) return unknown();
    // The existing HH chat proof establishes the letter but cannot establish
    // the exact questionnaire answers after an uncertain submission.
    if (input.questionnaire !== undefined) return unknown();
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
      if (await frame.evaluate(verifyChatData, { reference, input: {
        externalId: input.externalId, resumeId: input.resumeId, letter: input.letter,
      } })) return { outcome: 'sent', verified: true, externalId: reference.topicId };
      await frame.locator('[data-qa="chat-bubble-title"]').first().waitFor({ state: 'attached', timeout: 5000 });
      return await verifyChatLetter(frame, input) ? { outcome: 'sent', verified: true, externalId: reference.topicId } : unknown();
    } catch { return unknown(); }
    finally { await page.close().catch(() => {}); }
  }
  async close(prepared) { await prepared?.page?.close(); }
}

module.exports = { HhApplicationDriver };
