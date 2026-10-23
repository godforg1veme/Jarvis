const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { readVacancyPage } = require('../src/hhPageReader');
const { initial } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { CaptchaTelegramBrowser } = require('../src/captchaTelegramBrowser');

const target = 'https://hh.ru/vacancy/123';
const posting = '<script type="application/ld+json">{"@type":"JobPosting","title":"Fixture","datePosted":"2026-10-16T00:00:00+03:00"}</script>';
const branded = `<style>.HH-ContainerForStarticMarkup-Hidden-branded-vacancy{visibility:hidden}</style>${posting}<div class="HH-ContainerForStarticMarkup-Hidden-branded-vacancy g-invisible"><div><div class="vacancy-branded-user-content" data-qa="vacancy-description"><p>First paragraph</p><p>Second paragraph</p></div></div></div>`;

async function withBrowser(run) {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext();
  try { await run(context); } finally { await browser.close(); }
}

test('branded static markup is readable through the actual vacancy reader', async () => {
  await withBrowser(async context => {
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: branded }));
    const page = await context.newPage(); await page.goto(target);
    const item = await readVacancyPage(page, '123');
    assert.match(item.description, /First paragraph\s+Second paragraph/);
  });
});

test('reader keeps visible text and rejects unrelated, ambiguous, script-only and oversized hidden markup', async () => {
  await withBrowser(async context => {
    const page = await context.newPage();
    const load = async html => {
      await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
      await page.goto(target);
    };
    await load(`<div data-qa="vacancy-description">Visible text</div>${branded}`);
    assert.equal((await readVacancyPage(page, '123')).description, 'Visible text');
    await load(`${posting}<div style="display:none" data-qa="vacancy-description">Unrelated hidden</div>`);
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
    await load(`${branded}<div style="display:none" data-qa="vacancy-description">Ambiguous</div>`);
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
    await load(branded.replace('<p>First paragraph</p><p>Second paragraph</p>', '<script>Script only</script><style>Style only</style>'));
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
    await load(branded.replace('<p>First paragraph</p><p>Second paragraph</p>', '<script>Script leak</script><style>Style leak</style><template>Template leak</template><noscript>Noscript leak</noscript><p>Allowed text</p>'));
    assert.equal((await readVacancyPage(page, '123')).description, 'Allowed text');
    await load(branded.replace('First paragraph', 'x'.repeat(100001)));
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
    await load(branded.replace('First paragraph', '<span></span>'.repeat(20001)));
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
    await load(`${posting}<div data-qa="vacancy-description">${'x'.repeat(100001)}</div>`);
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
    await load(branded.replace('"@type":"JobPosting"', '"@type":"Other"'));
    await assert.rejects(readVacancyPage(page, '123'), { code: 'JOB_HH_DOM_CHANGED' });
  });
});

test('unknown receipt survives restart and exact branded target releases pause without answer POST', async () => {
  await withBrowser(async context => {
    const ownerId = randomUUID(), recoveryId = randomUUID();
    const operationHash = 'a'.repeat(64);
    const receipt = { operationHash, startedAt: 1, stage: 'finished', received: true, permitted: 1,
      httpStatus: 302, redirect: 'same_origin', verification: 'reader_failed', verificationStatus: 200,
      view: 'other', visibleError: 'none', outcome: 'unknown' };
    const saved = { ...initial(ownerId), phase: 'active', target, recoveryId, revision: 3,
      claims: [operationHash], lastReceipt: receipt };
    const store = { async read() { return structuredClone(saved); }, async write(value) { Object.assign(saved, structuredClone(value)); return structuredClone(saved); } };
    let journalState = { operationId: recoveryId, phase: 'blocked' };
    const journal = { async read() { return journalState; }, async write(value) { journalState = value; } };
    let mode = 'branded', posts = 0, controller;
    await context.route('**/*', route => {
      if (route.request().method() !== 'GET') { posts++; return route.abort(); }
      if (mode === 'wrong-target' && route.request().url() === target)
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace("/vacancy/124")</script>' });
      if (mode === 'non-200') return route.fulfill({ status: 403, body: 'Forbidden' });
      if (mode === 'challenge') return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Подтвердите, что вы не робот</h1>' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: branded });
    });
    const restart = async () => {
      const coordinator = new ManualCoordinator({ store, open: url => controller.open(url), verify: (url, id) => controller.verify(url, id) });
      controller = new CaptchaTelegramBrowser({ context, coordinator, journal });
      await coordinator.load(); return coordinator;
    };
    let coordinator = await restart();
    for (const adverse of ['challenge', 'wrong-target', 'non-200']) {
      mode = adverse;
      assert.equal((await coordinator.finish(coordinator.status().revision)).phase, 'active');
      if (adverse === 'wrong-target') assert.equal(controller.verificationReason, 'different_location');
      assert.equal(posts, 0);
      assert.equal(journalState.phase, 'blocked');
    }
    mode = 'branded'; coordinator = await restart();
    assert.equal((await controller.challenge(true)).outcome, 'idle');
    assert.equal(coordinator.status().phase, 'idle');
    assert.equal(journalState.phase, 'resolved');
    assert.equal(posts, 0);
    assert.deepEqual(saved.claims, []);
    assert.deepEqual(saved.lastReceipt, receipt);
  });
});
