// Full browser driver against HH-shaped fixtures. No live account or HH request is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { HhBrowser } = require('../src/hhBrowser');
const { HhApplicationDriver } = require('../src/hhApplicationDriver');
const { ApplicationLedger } = require('../src/applicationLedger');
const { GuardedSubmission } = require('../src/guardedSubmission');
const { parseFields } = require('../src/submissionProtocol');

test('actual driver + Chromium + Linux journal: native request/receipt, lost ack, restart and visibility guard', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-driver-')); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), resumeId = 'fixtureResume';
  let browser, context, posts = 0, chatRequests = 0, loseAcknowledgement = false, changeCountryVisibility = false;
  let wrongRecoveredLetter = true;
  const applied = new Set();
  const letters = new Map();
  const html = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === 'https://chatik.hh.ru' && req.method() === 'GET') {
        chatRequests++;
        const id = url.pathname === '/chat/555' ? '123' : '124';
        const letter = wrongRecoveredLetter ? 'Другой текст' : letters.get(id) || '';
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body:
          `<a data-qa="chatik-header-vacancy-link" href="https://hh.ru/vacancy/${id}">Вакансия</a>
          <div class="message_my--fixture"><div data-qa="chat-bubble-title">Отклик на вакансию</div>
          <div data-qa="chat-bubble-text" style="white-space:pre-wrap">${html(letter)}</div></div>` });
      }
      if (url.origin !== 'https://hh.ru') return route.abort();
      if (req.method() === 'POST' && url.pathname === '/applicant/vacancy_response/popup') {
        posts++;
        const fields = parseFields({ contentType: req.headers()['content-type'], body: req.postDataBuffer() });
        letters.set(fields.get('vacancy_id'), fields.get('letter').replace(/\r\n/g, '\n'));
        if (loseAcknowledgement) { applied.add('124'); return route.abort(); }
        applied.add('123');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ topic_id: 444, chat_id: 555,
          responseStatus: { resumes: { 222: { id: 222, hash: resumeId } }, usedResumeIds: [222],
            negotiations: { topicList: [{ id: 444, vacancyId: 123, resumeId: 222, chatId: 555 }] } } }) });
      }
      if (req.method() !== 'GET') return route.abort();
      let body = '';
      if (url.pathname === '/applicant/resumes') body = `<h1>Мои резюме</h1><div data-qa="resume"><a href="/resume/${resumeId}" data-qa="resume-title">Основное резюме</a></div>`;
      else if (url.pathname === `/resume/${resumeId}`) body = `<button data-qa="resume-visibility-card" onclick="document.querySelector('label').hidden=false">Видимость</button>
        <label hidden data-qa="resume-visibility-card-access-type-clients"><input type="radio" checked></label>`;
      else if (url.pathname.startsWith('/vacancy/')) {
        const id = url.pathname.split('/').pop();
        const topicId = id === '123' ? 444 : 445, chatId = id === '123' ? 555 : 556;
        const state = { applicantVacancyResponseStatuses: { [id]: { resumes: { 222: { id: 222, hash: resumeId } }, usedResumeIds: [222],
          negotiations: { topicList: [{ id: topicId, chatId, resumeId: 222, vacancyId: Number(id), hasResponseLetter: true,
            resources: [{ type: 'RESPONSE_LETTER', id: 1 }] }] } } } };
        body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Junior AI Engineer', datePosted: '2026-10-15T10:00:00+03:00' })}</script>
          <div data-qa="vacancy-description">Автоматизация AI</div><div data-qa="vacancy-company"><a href="/employer/900">Fixture</a></div>
          ${applied.has(id) ? `<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>
            <button data-qa="vacancy-response-link-view-topic" onclick="const frame=document.createElement('iframe');frame.src='https://chatik.hh.ru/chat/${chatId}';this.after(frame)">Смотреть отклик</button>` : ''}`;
      } else if (url.pathname === '/applicant/vacancy_response') {
        const id = url.searchParams.get('vacancyId');
        body = `<div data-qa="resume-title">Основное резюме</div>
          <form method="post" action="/applicant/vacancy_response?vacancyId=${id}"><input type="hidden" name="_xsrf" value="fixture">
          <button type="button" data-qa="vacancy-response-letter-toggle">Добавить письмо</button>
          <button type="submit" data-qa="vacancy-response-submit-popup">Откликнуться</button></form>
          <script>document.querySelector('[data-qa="vacancy-response-letter-toggle"]').onclick=()=>{
            const field=document.createElement('textarea');field.dataset.qa='vacancy-response-popup-form-letter-input';document.querySelector('form').prepend(field);
          };
          document.querySelector('form').onsubmit=async(event)=>{event.preventDefault();const data=new FormData();
            const values={vacancy_id:'${id}',resume_hash:'${resumeId}',letter:document.querySelector('textarea').value,lux:true,
              ignore_postponed:true,withoutTest:'yes',incomplete:false,mark_applicant_visible_in_vacancy_country:${changeCountryVisibility},country_ids:'[]',hhtmFromLabel:'',hhtmSourceLabel:''};
            for(const [key,value] of Object.entries(values)) data.append(key,String(value));
            await fetch('/applicant/vacancy_response/popup',{method:'POST',body:data}).catch(()=>{});
          };</script>`;
      } else return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
    });
    const hh = new HhBrowser({ context, primaryResumeId: resumeId });
    // The fixture transport fulfills the validated request instead of going to the internet.
    const driver = new HhApplicationDriver({ browser: hh, dispatch: (route) => route.fallback(), responseTimeoutMs: 500 });
    const create = () => new GuardedSubmission({ ownerId, primaryResumeId: resumeId, driver, ledger: new ApplicationLedger({ root, ownerId }) });
    const first = { userId: ownerId, operationId: randomUUID(), externalId: '123', resumeId, letter: 'Одобренный текст\nAI & автоматизация.' };
    const send = (input) => hh.run(() => create().submit(input));
    assert.deepEqual(await send(first), { outcome: 'sent', verified: true, externalId: '444' }); assert.equal(posts, 1);
    assert.equal((await send(first)).outcome, 'sent'); assert.equal(posts, 1);
    loseAcknowledgement = true;
    const second = { ...first, operationId: randomUUID(), externalId: '124' };
    assert.deepEqual(await send(second), { outcome: 'unknown' }); assert.equal(posts, 2);
    assert.equal((await send(second)).outcome, 'unknown'); assert.equal(posts, 2);
    assert.deepEqual(await hh.run(() => create().reconcile(second)), { outcome: 'unknown' }); assert.equal(posts, 2);
    assert.ok(chatRequests > 0, 'negative recovery actually reads the HH-shaped chat source');
    wrongRecoveredLetter = false;
    assert.deepEqual(await hh.run(() => create().reconcile(second)), { outcome: 'sent', verified: true, externalId: '445' }); assert.equal(posts, 2);
    loseAcknowledgement = false; changeCountryVisibility = true;
    assert.equal((await send({ ...first, operationId: randomUUID(), externalId: '125' })).outcome, 'manual_required'); assert.equal(posts, 2);
  } finally { await context?.close(); await browser?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
