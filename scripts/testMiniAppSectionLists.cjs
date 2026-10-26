const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');
const output = path.resolve(__dirname, '../.superpowers/mini-app-section-lists');
const c2 = 'a'.repeat(48), c3 = 'b'.repeat(48);
const records = Array.from({ length: 65 }, (_, i) => ({ id: String(i + 1), title: `Документ ${i + 1}`, detail: 'Готов к использованию' }));
const pageData = (offset) => ({ ok: true, items: records.slice(offset, offset + 30),
  paging: { nextCursor: offset === 0 ? c2 : offset === 30 ? c3 : null, pageSize: 30 } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function verify(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  const { state, errors } = await fixture(context);
  let initial = pageData(0); let pageFailure = false; let gate = null; let entered = null; let pageReads = 0;
  await context.route('**/mini/api/sections/documents**', async (route) => {
    const url = new URL(route.request().url()); const cursor = url.pathname.split('/page/')[1];
    const data = cursor ? pageData(cursor === c2 ? 30 : 60) : initial;
    if (cursor) { pageReads++; const wait = gate; gate = null; entered?.resolve(); if (wait) await wait.promise; }
    await route.fulfill({ status: cursor && pageFailure ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(cursor && pageFailure ? { ok: false, code: 'unavailable' } : data) });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mini/#section/documents`);
    await page.locator('.section-card').first().waitFor();
    assert.equal(await page.locator('.section-card').count(), 30);
    const filter = page.getByLabel('Поиск в разделе: Документы', { exact: true });
    await filter.fill('Документ 65');
    await page.getByText('Ничего не найдено.', { exact: true }).waitFor();
    const more = () => page.getByRole('button', { name: 'Загрузить ещё', exact: true });
    await more().click(); await page.waitForFunction(() => document.querySelectorAll('.section-card').length === 60);
    assert.equal(await filter.inputValue(), 'Документ 65');
    await more().click(); await page.getByText('Документ 65', { exact: true }).waitFor();
    assert.equal(await page.locator('.section-card').count(), 65);
    assert.equal(await page.locator('.section-card:visible').count(), 1);
    assert.equal(await more().isHidden(), true);
    const summary = page.locator('.section-card:visible summary'); await summary.click();
    assert.equal(await page.locator('.section-card:visible details').getAttribute('open'), '');
    await page.getByText('Готов к использованию', { exact: true }).last().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `details-${width}.png`), fullPage: true });

    await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.section-card').length === 30);
    assert.equal(await filter.inputValue(), 'Документ 65', 'refresh retains filter');
    await filter.fill(''); pageFailure = true;
    await more().click(); await page.getByText(/Показанный список сохранён/).waitFor();
    assert.equal(await page.locator('.section-card').count(), 30);
    pageFailure = false;
    gate = deferred(); const held = gate; entered = deferred();
    const before = pageReads;
    await more().click(); await entered.promise;
    assert.equal(await more().isDisabled(), true);
    await more().evaluate((button) => button.click());
    assert.equal(pageReads, before + 1, 'double click does not duplicate load');
    initial = { ok: true, items: [{ id: 'new', title: 'Новый документ', detail: 'Готов' }], paging: { nextCursor: null } };
    await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
    await page.getByText('Новый документ', { exact: true }).waitFor();
    const oldResponse = page.waitForResponse((response) => response.url().includes(`/page/${c2}`));
    held.resolve(); await (await oldResponse).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.section-card').count(), 1, 'late page does not replace refreshed list');
    assert.equal(await page.getByText('Новый документ', { exact: true }).count(), 1);

    // Older chat history is independent of the draft and pending request state.
    state.messages = [{ id: '50', role: 'assistant', content: 'Недавний ответ' }];
    let olderFails = true;
    await context.route('**/mini/api/assistant/messages', (route) => route.request().method() !== 'GET' ? route.fallback()
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, messages: state.messages, paging: { nextCursor: c2 } }) }));
    await context.route('**/mini/api/assistant/messages/page/*', (route) => route.fulfill({ status: olderFails ? 503 : 200,
      contentType: 'application/json', body: JSON.stringify(olderFails ? { ok: false } : { ok: true,
        messages: [{ id: '10', role: 'user', content: 'Старое сообщение' }], paging: { nextCursor: null } }) }));
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click();
    await page.getByText('Недавний ответ', { exact: true }).waitFor();
    await page.getByText(/Это отдельная история Mini App/).waitFor();
    const draft = page.getByLabel('Сообщение Jarvis', { exact: true }); await draft.fill('Черновик остаётся');
    const older = page.getByRole('button', { name: 'Загрузить предыдущие сообщения', exact: true });
    await older.click(); await page.getByText(/Показанная история сохранена/).waitFor();
    assert.equal(await page.getByText('Недавний ответ', { exact: true }).count(), 1);
    olderFails = false; await older.click(); await page.getByText('Старое сообщение', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('.chat-message > p').allTextContents(), ['Старое сообщение', 'Недавний ответ']);
    assert.equal(await draft.inputValue(), 'Черновик остаётся'); assert.equal(await older.isHidden(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    for (const width of [390, 1280]) await verify(browser, `http://127.0.0.1:${server.address().port}`, width);
    console.log('PASS: 65 records, retained filter, details, refresh, failed/retried page, double click, stale page after refresh, older chat and retained draft at 390/1280.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
