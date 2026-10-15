// Linux/pinned Chromium fixture. This does not describe or exercise HH's actual submit endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { ApplicationLedger } = require('../src/applicationLedger');
const { GuardedSubmission } = require('../src/guardedSubmission');
const { prepareApplicationPage } = require('../src/hhApplication');

test('Chromium + durable ledger: exact approved letter, lost result, restart, new ID and read-only reconciliation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-submit-')); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), resumeId = 'fixtureResume';
  const input = { userId: ownerId, operationId: randomUUID(), externalId: '123', resumeId,
    letter: 'Одобренный текст\nВторая строка: AI & автоматизация.' };
  let browser, context, posts = 0, unexpectedPosts = 0, submitted = false, hidden = false;
  const app = (driver) => new GuardedSubmission({ ownerId, primaryResumeId: resumeId,
    ledger: new ApplicationLedger({ root, ownerId }), driver });
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== 'https://hh.ru') return route.abort();
      if (req.method() === 'POST' && url.pathname === '/fixture-submit') {
        const body = new URLSearchParams(req.postData());
        assert.equal(body.get('letter'), input.letter); assert.equal(body.get('resume'), resumeId); assert.equal(body.get('vacancy'), '123');
        posts++; submitted = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      if (req.method() !== 'GET') { unexpectedPosts++; return route.abort(); }
      const body = `<div data-qa="resume-title">Основное резюме</div>
        ${hidden ? '<div data-qa="hidden-resume-warning">Измените видимость</div>' : ''}
        <form><input type="hidden" name="_xsrf" value="fixture">
        <button data-qa="vacancy-response-letter-toggle" type="button">Добавить письмо</button>
        <button data-qa="vacancy-response-submit-popup" type="submit">Отправить</button></form>
        <script>
        document.querySelector('[data-qa="vacancy-response-letter-toggle"]').onclick=()=>{
          const field=document.createElement('textarea');field.dataset.qa='vacancy-response-popup-form-letter-input';document.querySelector('form').prepend(field);
          field.oninput=()=>fetch('/fixture-forbidden-autosave',{method:'POST',body:field.value}).catch(()=>{});
        };
        document.querySelector('form').onsubmit=async(event)=>{event.preventDefault();
          await fetch('/fixture-submit',{method:'POST',body:new URLSearchParams({letter:document.querySelector('textarea').value,resume:'fixtureResume',vacancy:'123'})});
          document.body.dataset.fixtureResult='sent';};
        </script>`;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
    });
    const driver = {
      async prepare(args) {
        const page = await context.newPage();
        await page.goto(`https://hh.ru/applicant/vacancy_response?vacancyId=${args.externalId}`);
        const state = await prepareApplicationPage(page, { ...args, resumes: [{ id: resumeId, title: 'Основное резюме' }] });
        return { ...state, page };
      },
      async clickAndVerify({ prepared, letter }) {
        assert.equal(await prepared.page.locator('textarea').inputValue(), letter);
        await prepared.releaseReadGuard();
        await prepared.page.locator('[data-qa="vacancy-response-submit-popup"]').click();
        await prepared.page.waitForFunction(() => document.body.dataset.fixtureResult === 'sent');
        throw new Error('Fixture lost acknowledgement');
      },
      async readResult() { return submitted ? { outcome: 'sent', verified: true, externalId: 'fixture-topic' } : { outcome: 'unknown' }; },
      async close(prepared) { await prepared?.page.close(); },
    };
    assert.deepEqual(await app(driver).submit(input), { outcome: 'unknown' }); assert.equal(posts, 1);
    assert.equal((await app(driver).submit(input)).execute, false); assert.equal(posts, 1);
    assert.equal((await app(driver).submit({ ...input, operationId: randomUUID() })).execute, false); assert.equal(posts, 1);
    assert.deepEqual(await app(driver).reconcile(input), { outcome: 'sent', verified: true, externalId: 'fixture-topic' });
    assert.equal(posts, 1);
    assert.equal((await app(driver).submit(input)).outcome, 'sent'); assert.equal(posts, 1);
    await assert.rejects(app(driver).submit({ ...input, letter: `${input.letter} ` }), { code: 'JOB_BROWSER_OPERATION_CHANGED' });
    await assert.rejects(app(driver).submit({ ...input, userId: randomUUID() }), { code: 'JOB_BROWSER_ACCESS_DENIED' });
    await assert.rejects(app(driver).submit({ ...input, resumeId: 'otherResume' }), { code: 'JOB_BROWSER_ACCESS_DENIED' });
    hidden = true;
    assert.equal((await app(driver).submit({ ...input, operationId: randomUUID(), externalId: '124' })).outcome, 'manual_required'); assert.equal(posts, 1);
    assert.equal(unexpectedPosts, 0, 'read-only form preparation blocks unsolicited autosave before transport');
  } finally { await context?.close(); await browser?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
