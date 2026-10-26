// Local synthetic receipts and delayed replies; no real accounts or services.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');
const output = path.resolve(__dirname, '../.superpowers/mini-app-reliability');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function verifyFailedReceipt(browser, origin, width, expired) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const { state, errors } = await fixture(context);
  let receiptReads = 0;
  let terminal = false;
  await context.route('**/mini/api/assistant/messages', async (route) => {
    if (route.request().method() !== 'POST' || !state.chatUncertain) return route.fallback();
    const body = route.request().postDataJSON();
    state.chatPosts.push(body); state.chatOp = body;
    state.messages.push({ id: 'failed-question', role: 'user', content: body.text });
    // The server accepted the question, then failed before persisting an answer.
    return route.abort();
  });
  await context.route('**/mini/api/assistant/requests/*', async (route) => {
    receiptReads++;
    assert.equal(new URL(route.request().url()).pathname.split('/').at(-1), state.chatOp.requestId);
    await route.fulfill({ status: terminal ? 200 : 404, contentType: 'application/json', body: JSON.stringify(terminal
      ? { ok: true, status: 'failed', failureCode: expired ? 'request_expired' : 'request_failed' }
      : { ok: false, code: 'operation_unknown' }) });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mini/#assistant`);
    const input = page.getByLabel('Сообщение Jarvis', { exact: true });
    await input.fill('Синтетический вопрос без персональных данных');
    state.chatUncertain = true;
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    const check = page.getByRole('button', { name: 'Проверить исходный запрос', exact: true });
    await check.waitFor();
    await check.click();
    await page.waitForFunction(() => document.querySelector('.chat-state').dataset.state === 'unknown');
    assert.equal(await input.isDisabled(), true, 'missing receipt is not evidence of failure');
    assert.equal(state.chatPosts.length, 1, 'unknown receipt never resends');
    await page.reload();
    await check.waitFor();
    assert.equal(await input.isDisabled(), true, 'reload retains unknown request');
    terminal = true;
    await check.click();
    await page.getByText(/Сообщение повторно не отправлялось\. Можно написать новое\./).waitFor();
    assert.equal(await input.isEnabled(), true, 'terminal failure releases input');
    assert.equal(await input.getAttribute('required'), '', 'new message is required again');
    assert.equal(state.chatPosts.length, 1, 'failure reconciliation never POSTs the old message');
    assert.equal(receiptReads, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'failure layout fits');
    await page.screenshot({ path: path.join(output, `${expired ? 'expired' : 'failed'}-${width}.png`), fullPage: true });
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), [], 'terminal receipt clears pending UUID');
    await page.reload();
    await page.getByRole('button', { name: 'Отправить', exact: true }).waitFor();
    assert.equal(await input.isEnabled(), true, 'terminal failure stays unlocked after reload');
    assert.equal(await page.getByText('Ответ Jarvis', { exact: true }).count(), 0, 'failed request has no invented answer');
    state.chatUncertain = false;
    await input.fill('Другой вопрос после завершённой ошибки');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.getByText('Ответ Jarvis', { exact: true }).first().waitFor();
    assert.equal(state.chatPosts.length, 2);
    assert.notEqual(state.chatPosts[0].requestId, state.chatPosts[1].requestId);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function verifyAdminRace(browser, origin, staleStatus) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { errors } = await fixture(context);
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mini/#admin`);
    await page.locator('#admin[data-state="ready"]').waitFor();
    const started = [deferred(), deferred()];
    const replies = [deferred(), deferred()];
    let reads = 0;
    await context.route('**/mini/api/admin', async (route) => {
      const index = reads++;
      assert.ok(index < 2, 'two refreshes only');
      started[index].resolve();
      const response = await replies[index].promise;
      await route.fulfill({ contentType: 'application/json', ...response });
    });
    const refresh = page.getByRole('button', { name: 'Обновить список', exact: true });
    await refresh.click(); await started[0].promise;
    await refresh.click(); await started[1].promise;
    const payload = (name) => ({ ok: true, users: [{ telegramId: '100000003', displayName: name,
      level: 'member', permissions: [], overrides: {}, revision: 1 }], roles: [], audit: [] });
    replies[1].resolve({ status: 200, body: JSON.stringify(payload('Актуальный пользователь')) });
    await page.getByRole('button', { name: /Актуальный пользователь/ }).waitFor();
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/mini/api/admin') && response.status() === staleStatus);
    replies[0].resolve({ status: staleStatus, body: JSON.stringify(staleStatus === 200
      ? payload('Устаревший пользователь') : { ok: false, code: staleStatus === 401 ? 'unauthorized' : 'unavailable' }) });
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#application').isVisible(), true, 'obsolete errors do not close a current session');
    assert.equal(await page.getByRole('button', { name: /Актуальный пользователь/ }).count(), 1);
    assert.equal(await page.getByText('Устаревший пользователь', { exact: true }).count(), 0);
    assert.equal(await page.locator('#admin').getAttribute('data-state'), 'ready');
    assert.equal(await page.locator('#admin').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#admin-feedback').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    for (const width of [390, 1280]) {
      await verifyFailedReceipt(browser, origin, width, false);
      await verifyFailedReceipt(browser, origin, width, true);
    }
    for (const status of [200, 503, 401]) await verifyAdminRace(browser, origin, status);
    console.log('PASS: failed/expired chat receipts, missing receipt and reload keep original UUID, new message after terminal failure; latest admin refresh wins over stale success/503/401.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
