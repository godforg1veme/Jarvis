// Synthetic Mini App action fixtures. No Telegram credentials or personal files.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');

async function run() {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const shots = path.resolve(__dirname, '../.superpowers/mini-app-personal-actions');
  await fs.mkdir(shots, { recursive: true });
  const documentId = randomUUID(), deviceId = randomUUID(), reminderId = randomUUID(), commitmentId = randomUUID(), projectId = randomUUID();
  const state = { posts: [], uploads: [], checks: [], cancels: [], mode: '', receipt: null, actor: '100000001' };
  const target = {
    delete: { id: documentId, title: '<img src=x onerror=alert(1)> План', type: 'document', revision: 1 },
    revoke: { id: deviceId, title: 'Мой ноутбук', type: 'device', revision: 'a'.repeat(64) },
    'reminder.reschedule': { id: reminderId, title: 'Проверить проект', type: 'reminder', status: 'scheduled', revision: 2 },
    'reminder.cancel': { id: reminderId, title: 'Проверить проект', type: 'reminder', status: 'scheduled', revision: 2 },
    'commitment.complete': { id: commitmentId, title: 'Сделать звонок', type: 'commitment', status: 'open', revision: 3 },
    'commitment.dismiss': { id: commitmentId, title: 'Сделать звонок', type: 'commitment', status: 'open', revision: 3 },
    'project.pin': { id: projectId, title: 'Учебный проект', type: 'project', revision: 1 },
    'project.hide': { id: projectId, title: 'Учебный проект', type: 'project', revision: 1 },
    'project.restore': { id: projectId, title: 'Учебный проект', type: 'project', revision: 1 },
  };
  function actorRoute(context, telegramId) {
    context.route('**/mini/api/**', async route => {
      const request = route.request(); const endpoint = new URL(request.url()).pathname.slice('/mini/api'.length);
      const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (endpoint === '/session' || endpoint === '/me') return send({ ok: true, csrfToken: 'fixture-csrf', actor: { telegramId, displayName: 'Тест', level: 'owner', permissions: ['documents','devices','life'], overrides: {}, revision: 1 }, catalog: [] });
      const section = /^\/sections\/(documents|devices|life)$/.exec(endpoint)?.[1];
      if (section) return send({ ok: true, section, personalActionsAvailable: true, items: section === 'documents' ? [{ id: documentId, title: '<img src=x onerror=alert(1)> План', detail: 'Тест' }] : section === 'devices' ? [{ id: deviceId, title: 'Мой ноутбук', detail: 'online' }] : [{ id: commitmentId, title: 'Сделать звонок', detail: 'Договорённость' }], paging: {} });
      const describe = /^\/sections\/(documents|devices|life)\/actions$/.exec(endpoint)?.[1];
      if (describe) return send({ ok: true, kinds: describe === 'documents' ? ['upload','delete'] : describe === 'devices' ? ['pair','revoke','pair.cancel'] : ['reminder.create','reminder.reschedule','reminder.cancel','commitment.complete','commitment.dismiss','project.pin','project.hide','project.restore'], maxUploadBytes: 1000000,
        reminders: [{ id: reminderId, title: 'Проверить проект', revision: 2, type: 'reminder', status: 'scheduled' }], projects: [{ id: projectId, title: 'Учебный проект', revision: 1, type: 'project' }] });
      const lookup = /^\/sections\/(documents|devices|life)\/actions\/([^/]+)\/([^/]+)$/.exec(endpoint);
      if (lookup) { const found = lookup[2] === 'pair.cancel' && state.receipt?.result?.pairingId === lookup[3]
        ? { id: lookup[3], title: 'Ноутбук', type: 'pairing', status: 'pending', revision: null } : target[decodeURIComponent(lookup[2])];
        return found?.id === lookup[3] ? send({ ok: true, target: found }) : send({ ok: false, code: 'not_found' }, 404); }
      const post = /^\/sections\/(documents|devices|life)\/operations$/.exec(endpoint);
      if (post) {
        const body = request.postDataJSON(); assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf');
        state.posts.push({ telegramId, body }); state.receipt = { ok: true, status: 'completed', result: body.kind === 'pair' ? { pairingId: randomUUID(), code: 'SYNTHETIC-CODE', expiresAt: '2026-10-28T10:00:00Z', codeAvailable: true } : { id: body.targetId || randomUUID() } };
        if (state.mode === 'timeout') { state.mode = ''; return route.abort(); }
        if (state.mode === 'invalid') { state.mode = ''; return send({ ok: false, code: 'invalid' }, 400); }
        return send(state.receipt);
      }
      const upload = /^\/sections\/documents\/uploads\/([^/]+)$/.exec(endpoint);
      if (upload) { assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf'); state.uploads.push({ id: upload[1], headers: request.headers(), size: request.postDataBuffer().length }); return send({ ok: true, status: 'completed', result: { id: randomUUID() } }); }
      const op = /^\/sections\/(documents|devices|life)\/operations\/([^/]+)(\/cancel)?$/.exec(endpoint);
      if (op) { if (op[3]) { state.cancels.push(op[2]); return send({ ok: true, status: 'cancelled', result: {} }); } state.checks.push(op[2]); return state.mode === 'missing' ? send({ ok: false, code: 'not_found' }, 404) : send(state.receipt || { ok: false }, state.receipt ? 200 : 404); }
      return route.continue();
    });
  }
  async function makeContext(width = 390, telegramId = '100000001') {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const f = await fixture(context); actorRoute(context, telegramId); const page = await context.newPage();
    await page.goto(`${origin}/mini/#section/documents`); await page.locator('#application').waitFor({ state: 'visible' });
    return { context, page, f };
  }
  try {
    const { context, page, f } = await makeContext();
    await page.getByRole('button', { name: 'Добавить документ' }).waitFor();
    await page.getByRole('button', { name: 'Добавить документ' }).click();
    await page.locator('#personal-file').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic document') });
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    assert.match(await page.locator('.personal-actions__preview:visible').last().textContent(), /sample\.txt/);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal(state.uploads.length, 0);
    await page.getByRole('button', { name: 'Добавить документ' }).click();
    await page.locator('#personal-file').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic document') });
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor(); assert.equal(state.uploads.length, 1); assert.equal(state.uploads[0].size, 18);
    assert.equal(decodeURIComponent(state.uploads[0].headers['x-jarvis-file-name']), 'sample.txt');
    await page.locator('.section-card summary').first().click();
    await page.getByRole('button', { name: 'Удалить документ' }).click(); await page.getByRole('button', { name: 'Показать изменение' }).click();
    assert.match(await page.locator('.personal-actions__preview:visible').last().textContent(), /необратимо/);
    assert.equal(await page.locator('.personal-actions img').count(), 0, 'untrusted title stays text');
    await page.getByRole('button', { name: 'Подтвердить удаление' }).click(); await page.getByText('Действие выполнено.').waitFor();
    assert.equal(state.posts.at(-1).body.targetId, documentId);
    await page.screenshot({ path: path.join(shots, 'documents-390.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 }); await page.screenshot({ path: path.join(shots, 'documents-1280.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(`${origin}/mini/#section/devices`); await page.getByRole('button', { name: 'Подключить устройство' }).waitFor();
    await page.getByRole('button', { name: 'Подключить устройство' }).click(); await page.locator('#personal-name').fill('Ноутбук');
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText(/Одноразовый код подключения/).waitFor(); assert.equal((await page.evaluate(() => JSON.stringify(sessionStorage))).includes('SYNTHETIC-CODE'), false);
    await page.getByRole('button', { name: 'Отменить это подключение' }).click(); await page.locator('.personal-actions__form h2').filter({ hasText: 'Отменить подключение' }).waitFor();
    await page.locator('.section-card summary').first().click(); await page.getByRole('button', { name: 'Отключить устройство' }).click(); await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить отключение' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    await page.goto(`${origin}/mini/#section/life`); await page.getByRole('button', { name: 'Создать напоминание' }).waitFor();
    await page.getByRole('button', { name: 'Создать напоминание' }).click(); await page.locator('#personal-title').fill('Проверить проект'); await page.locator('#personal-time').fill('2026-12-01T10:30');
    await page.getByRole('button', { name: 'Показать изменение' }).click(); assert.match(await page.locator('.personal-actions__preview:visible').last().textContent(), /МСК/);
    await page.getByRole('button', { name: 'Подтвердить действие' }).click(); await page.getByText('Действие выполнено.').waitFor();
    assert.equal(state.posts.at(-1).body.input.triggerAt, '2026-12-01T10:30:00+03:00');
    await page.locator('.section-card summary').first().click(); await page.getByRole('button', { name: 'Выполнить договорённость' }).click(); await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click(); await page.getByText('Действие выполнено.').waitFor();
    assert.equal(state.posts.at(-1).body.targetId, commitmentId);
    await page.screenshot({ path: path.join(shots, 'life-1280.png'), fullPage: true });
    assert.deepEqual(f.errors, []);
    await context.close();

    const second = await makeContext(390); const p2 = second.page;
    state.mode = 'timeout'; await p2.getByRole('button', { name: 'Добавить документ' }).click();
    await p2.locator('#personal-file').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await p2.getByRole('button', { name: 'Показать изменение' }).click(); await p2.getByRole('button', { name: 'Подтвердить действие' }).click();
    // Upload handler returns success; use delete for a simulated lost POST response.
    await p2.locator('.section-card summary').first().click(); await p2.getByRole('button', { name: 'Удалить документ' }).click(); await p2.getByRole('button', { name: 'Показать изменение' }).click(); await p2.getByRole('button', { name: 'Подтвердить удаление' }).click();
    await p2.getByText(/Результат пока неизвестен/).waitFor(); const original = state.posts.at(-1).body.operationId;
    await p2.reload(); await p2.getByRole('button', { name: 'Проверить исходную операцию' }).click(); await p2.getByText('Действие выполнено.').waitFor();
    assert.equal(state.checks.at(-1), original);
    state.mode = 'invalid'; await p2.locator('.section-card summary').first().click(); await p2.getByRole('button', { name: 'Удалить документ' }).click();
    await p2.getByRole('button', { name: 'Показать изменение' }).click(); await p2.getByRole('button', { name: 'Подтвердить удаление' }).click();
    await p2.getByText(/Не удалось выполнить запрос/).waitFor();
    assert.equal(await p2.getByRole('button', { name: 'Проверить исходную операцию' }).isVisible(), false, 'definitive invalid frees pending ID');
    state.mode = 'timeout'; await p2.getByRole('button', { name: 'Подтвердить удаление' }).click(); await p2.getByText(/Результат пока неизвестен/).waitFor();
    const missingId = state.posts.at(-1).body.operationId; state.mode = 'missing';
    await p2.getByRole('button', { name: 'Проверить исходную операцию' }).click(); await p2.getByText(/Результат пока неизвестен/).waitFor();
    assert.equal(await p2.getByRole('button', { name: 'Добавить документ' }).isDisabled(), true, 'unknown receipt blocks new ID');
    await p2.getByRole('button', { name: 'Отменить невыполненную операцию' }).click(); await p2.getByText('Операция отменена.').waitFor();
    assert.equal(state.cancels.at(-1), missingId); await second.context.close();

    const third = await makeContext(390); const p3 = third.page;
    await p3.evaluate(() => { Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('storage blocked'); } }); });
    await p3.getByRole('button', { name: 'Добавить документ' }).click();
    await p3.locator('#personal-file').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await p3.getByRole('button', { name: 'Показать изменение' }).click(); const beforeBlocked = state.uploads.length;
    await p3.getByRole('button', { name: 'Подтвердить действие' }).click(); await p3.getByText(/Сервер временно недоступен|Не удалось выполнить действие/).waitFor();
    assert.equal(state.uploads.length, beforeBlocked, 'storage write failure prevents mutation'); await third.context.close();

    const fourth = await makeContext(390); const p4 = fourth.page;
    state.mode = 'timeout'; await p4.locator('.section-card summary').first().click(); await p4.getByRole('button', { name: 'Удалить документ' }).waitFor({ state: 'visible' });
    await p4.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Удалить документ'); return button && !button.disabled; });
    await p4.getByRole('button', { name: 'Удалить документ' }).click();
    await p4.getByRole('button', { name: 'Показать изменение' }).click(); await p4.getByRole('button', { name: 'Подтвердить удаление' }).click();
    await p4.getByText(/Результат пока неизвестен/).waitFor();
    const actorOnePending = await p4.evaluate(() => Object.keys(sessionStorage).find(key => key.includes('100000001')));
    actorRoute(fourth.context, '100000002'); await p4.reload(); await p4.getByRole('button', { name: 'Добавить документ' }).waitFor();
    assert.equal(await p4.getByRole('button', { name: 'Проверить исходную операцию' }).isVisible(), false);
    assert.ok(actorOnePending); await fourth.context.close();
    console.log('PASS: personal actions synthetic UI, preview/confirm, binary upload, device pairing/revoke, life MSK, invalid/timeout/reload/404-cancel, actor scope, storage failure, 390/1280 screenshots, safe titles.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
