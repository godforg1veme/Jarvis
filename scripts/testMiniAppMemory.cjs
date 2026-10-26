// Synthetic browser fixtures; real transaction/race checks live in server acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');
const output = path.resolve(__dirname, '../.superpowers/mini-app-memory');
const digest = (v) => createHash('sha256').update(v).digest('hex');

async function verify(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const { errors } = await fixture(context);
  let records = [{ id: randomUUID(), title: 'Люблю длинные прогулки', expectedDigest: digest('Люблю длинные прогулки') }];
  let mode = 'normal'; const posts = []; const receipts = new Map();
  await context.route('**/mini/api/sections/memory', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ok: true, items: records, paging: { nextCursor: null }, notice: 'Твои записи', memoryActionsAvailable: true }) }));
  await context.route('**/mini/api/memory/operations**', async (route) => {
    const request = route.request(); const endpoint = new URL(request.url()).pathname;
    const id = endpoint.split('/').at(endpoint.endsWith('/cancel') ? -2 : -1);
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'GET') return receipts.has(id) ? send(receipts.get(id)) : send({ ok: false, code: 'operation_unknown' }, 404);
    assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf');
    if (endpoint.endsWith('/cancel')) {
      if (!receipts.has(id)) receipts.set(id, { ok: true, status: 'cancelled' });
      return send(receipts.get(id));
    }
    const body = request.postDataJSON(); posts.push(body);
    if (mode === 'forbidden') return send({ ok: false, code: 'forbidden' }, 403);
    if (mode === 'absent') return route.abort();
    if (mode === 'conflict') return send({ ok: false, code: 'revision_conflict' }, 409);
    const memoryId = randomUUID();
    if (body.kind !== 'add') records = records.filter((v) => v.id !== body.memoryId);
    if (body.kind !== 'forget') records.push({ id: memoryId, title: body.content, expectedDigest: digest(body.content) });
    const result = { ok: true, status: 'completed', memoryId };
    receipts.set(body.operationId, result);
    return mode === 'lost' ? route.abort() : send(result);
  });
  const page = await context.newPage();
  const text = () => page.getByLabel('Что запомнить', { exact: true });
  const start = async (content) => {
    await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
    await text().fill(content);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  };
  const saved = () => page.getByText('Изменение памяти выполнено.', { exact: true }).waitFor();
  try {
    await page.goto(`${origin}/mini/#section/memory`);
    await page.getByRole('button', { name: 'Добавить запись', exact: true }).waitFor();
    await start('<img src=x onerror=alert(1)> Люблю читать книги');
    assert.equal(posts.length, 0, 'review does not mutate memory');
    assert.equal(await page.locator('.memory-actions__preview img').count(), 0, 'content is text');
    await page.getByRole('button', { name: 'Изменить текст', exact: true }).click();
    await text().fill('  Люблю  читать книги  ');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    assert.equal(await page.getByText('Будет сохранено: Люблю читать книги', { exact: true }).count(), 1);
    await page.screenshot({ path: path.join(output, `confirm-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).evaluate((b) => { b.click(); b.click(); });
    await saved();
    assert.equal(posts.length, 1, 'double confirm sends once');
    assert.equal(posts[0].content, 'Люблю читать книги');
    assert.equal(await page.locator('.section-card').count(), 2);

    let card = page.locator('.section-card').filter({ hasText: 'Люблю читать книги' });
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Исправить', exact: true }).click();
    assert.equal(await text().inputValue(), 'Люблю читать книги');
    await text().fill('Люблю читать по вечерам');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await saved(); assert.equal(posts.at(-1).kind, 'correct'); assert.equal(posts.at(-1).expectedDigest, digest('Люблю читать книги'));
    card = page.locator('.section-card').filter({ hasText: 'Люблю читать по вечерам' });
    await card.locator('summary').click(); await card.getByRole('button', { name: 'Удалить', exact: true }).click();
    const beforeDelete = posts.length;
    await page.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal(posts.length, beforeDelete);
    await card.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
    await saved(); assert.equal(posts.at(-1).kind, 'forget'); assert.equal(posts.at(-1).content, null);

    mode = 'lost'; await start('Ответ потеряется');
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.getByText(/Результат пока неизвестен/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Добавить запись', exact: true }).isDisabled(), true);
    const pending = posts.at(-1).operationId; const sent = posts.length;
    const stored = await page.evaluate(() => ({ ...sessionStorage }));
    assert.equal(JSON.stringify(stored).includes('Ответ потеряется'), false, 'no content in storage');
    assert.equal(JSON.stringify(stored).includes(pending), true);
    await page.reload(); await page.getByText(/Осталась операция с неизвестным результатом/).waitFor();
    await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).click();
    await saved(); assert.equal(posts.length, sent, 'reconciliation never reposts');

    mode = 'absent'; await start('Не дошло до сервера');
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.getByText(/Результат пока неизвестен/).waitFor();
    await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Добавить запись', exact: true }).isDisabled(), true, '404 is not terminal');
    await page.reload(); await page.getByText(/Осталась операция с неизвестным результатом/).waitFor();
    await page.getByRole('button', { name: 'Отменить невыполненную операцию', exact: true }).click();
    await page.getByText('Операция отменена. Изменений нет.', { exact: true }).waitFor();
    assert.equal(receipts.get(posts.at(-1).operationId).status, 'cancelled');

    mode = 'conflict'; await start('Устаревшее изменение');
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.getByText(/Данные изменились/).waitFor();
    await page.getByRole('button', { name: 'Отменить невыполненную операцию', exact: true }).click();
    await page.getByText('Операция отменена. Изменений нет.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Добавить запись', exact: true }).isEnabled(), true);

    // If the UUID cannot be durably remembered, no mutation may leave the tab.
    mode = 'normal'; const beforeStorageFailure = posts.length;
    await start('Черновик остаётся во вкладке');
    await page.evaluate(() => { window.originalMemorySetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('fixture-storage-unavailable'); }; });
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.getByText(/Черновик сохранён в этой вкладке/).waitFor();
    assert.equal(posts.length, beforeStorageFailure);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalMemorySetItem; delete window.originalMemorySetItem; });
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();

    mode = 'forbidden'; await start('Доступ отозван');
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.locator('#application').waitFor({ state: 'hidden' });
    await context.route('**/mini/api/sections/memory', (route) => route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [], available: false, memoryActionsAvailable: false }) }));
    await page.reload(); await page.getByText('Раздел временно недоступен.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Добавить запись', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    for (const width of [390, 1280]) await verify(browser, `http://127.0.0.1:${server.address().port}`, width);
    console.log('PASS: memory confirmation, add/correct/forget, double click, text safety, lost reply/reload/same UUID, 404 pending, tombstone cancellation, conflict, unavailable storage/service, revoke and layout at 390/1280.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
