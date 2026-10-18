// Synthetic browser API fixtures; no Telegram secrets or real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../job-browser/node_modules/playwright');
const root = path.resolve(__dirname, '../mini-app/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (request, response) => {
  const relative = new URL(request.url, 'http://localhost').pathname.replace(/^\/mini\//, '') || 'index.html';
  if (relative.includes('..') || !/^(index\.html|(?:app|api|admin|core)\.js|style\.css|vendor\/(?:three\.module|three\.core|RoomEnvironment)\.js)$/.test(relative)) return response.writeHead(404).end();
  try { const content = await fs.readFile(path.join(root, relative)); response.writeHead(200, { 'Content-Type': types[path.extname(relative)], 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; connect-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'" }).end(content); }
  catch { response.writeHead(404).end(); }
});
async function fixture(context, { level = 'owner', outside = false, sdkBlocked = false, rejectLogin = false } = {}) {
  const users = [{ telegramId: '100000001', displayName: 'Владелец', level: 'owner', roleId: null, permissions: Object.keys({ assistant:1,jobs:1,life:1,memory:1,documents:1,devices:1,vpn:1,operations:1 }), overrides: {}, revision: 1 }, { telegramId: '100000003', displayName: '<b>Анна</b>', level: 'member', roleId: 'search', overrides: {}, permissions: ['jobs'], revision: 1, blocked: false }];
  const roles = [{ id: 'search', name: 'Только поиск', permissions: ['jobs'], revision: 1 }];
  const actor = level === 'member' ? users[1] : { ...users[0], level };
  const state = { mutations: [], uncertain: false, conflict: false, session: false, op: null, section: null, blocked: false, chatUncertain: false, chatPosts: [], chatOp: null, messages: [], operationUnknown: false };
  const external = []; const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route('https://telegram.org/**', (route) => sdkBlocked ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: outside ? '' : 'window.Telegram={WebApp:{initData:"synthetic-fixture",ready(){},expand(){}}};' }));
  await context.route('**/mini/api/**', async (route) => {
    const request = route.request(); const endpoint = new URL(request.url()).pathname.slice('/mini/api'.length);
    const body = request.postDataJSON();
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (endpoint === '/session') { assert.equal(body.initData, 'synthetic-fixture'); if (rejectLogin) return send({ ok: false, code: 'invalid_login' }, 400); state.session = true; return send({ ok: true, csrfToken: 'fixture-csrf', actor, catalog: [] }); }
    if (endpoint === '/me') return send(state.session ? { ok: true, csrfToken: 'fixture-csrf', actor, catalog: [] } : { ok: false }, state.session ? 200 : 401);
    if (endpoint.startsWith('/sections/')) { state.section = endpoint; return send({ ok: true, section: 'jobs', items: [{ title: 'Личный профиль' }], notice: 'Нужно личное подключение HH.' }); }
    if (endpoint === '/assistant/messages' && request.method() === 'GET') return send({ ok: true, messages: state.messages });
    if (endpoint === '/assistant/messages') {
      assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf'); state.chatPosts.push(body); state.messages.push({ id: 'u', role: 'user', content: body.text }, { id: 'a', role: 'assistant', content: 'Ответ Jarvis' });
      if (state.chatUncertain) { state.chatOp = body; return route.abort(); }
      return send({ ok: true, answer: 'Ответ Jarvis' });
    }
    if (endpoint.startsWith('/assistant/requests/')) { assert.equal(endpoint.split('/').at(-1), state.chatOp.requestId); return send({ ok: true, answer: 'Ответ Jarvis' }); }
    if (endpoint === '/admin' && request.method() === 'GET') return send({ ok: true, users, roles, audit: [{ action: 'user.updated', targetTelegramId: '100000003' }] });
    if (endpoint.startsWith('/admin/operations/')) { assert.equal(endpoint.split('/').at(-1), state.op.operationId); if (state.operationUnknown) { state.operationUnknown = false; return send({ ok: false, code: 'operation_unknown' }, 404); } return send({ ok: true, result: { revision: 2 } }); }
    if (endpoint === '/logout') return send({ ok: true });
    assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf');
    state.mutations.push({ endpoint, body });
    if (state.conflict) { state.conflict = false; return send({ ok: false, code: 'conflict' }, 409); }
    if (state.uncertain) { state.op = body; state.uncertain = false; return route.abort(); }
    if (endpoint === '/admin/roles') roles.push({ id: 'new', ...body, revision: 1 });
    if (endpoint === '/admin/users') users.push({ ...body, permissions: [], overrides: {}, revision: 1 });
    if (endpoint === '/admin/users/100000003') Object.assign(users[1], body, { revision: 2 });
    return send({ ok: true, result: { revision: 2 } });
  });
  context.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:') && !request.url().startsWith('https://telegram.org/')) external.push(request.url()); });
  return { state, external, errors };
}
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const { state, external, errors } = await fixture(context); const page = await context.newPage();
    await page.goto(`${origin}/mini/`); await page.locator('#application').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#core-loading').hidden);
    await page.getByRole('link', { name: 'Управление', exact: true }).click();
    await page.getByRole('tab', { name: /Пользователи/ }).focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.getByRole('tab', { name: 'Роли', exact: true }).getAttribute('aria-selected'), 'true'); await page.keyboard.press('ArrowLeft');
    const output = path.resolve(__dirname, '../.superpowers/mini-app-preview'); await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'production-admin.png'), fullPage: true });
    await page.getByRole('button', { name: /Владелец/ }).click(); assert.equal(await page.locator('#editor-form [type="submit"]').isVisible(), false); await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: /Анна/ }).click(); assert.equal(await page.locator('#users b').count(), 0);
    await page.getByRole('radio', { name: 'Документы: Да', exact: true }).check();
    await page.getByRole('radio', { name: 'Поиск работы: Нет', exact: true }).check();
    assert.match(await page.locator('#access-summary').innerText(), /Документы: разрешено · Личная настройка/);
    await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click(); assert.equal(state.mutations.length, 0, 'confirmation required');
    state.conflict = true; await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Данные изменились' }).waitFor(); assert.equal(await page.getByRole('radio', { name: 'Документы: Да', exact: true }).isChecked(), true, 'draft preserved');
    await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click(); state.uncertain = true;
    await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click(); await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).waitFor();
    const mutationCount = state.mutations.length; await page.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal(await page.getByRole('dialog').isVisible(), true);
    const originalOperation = state.op.operationId; await page.reload(); await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).waitFor(); assert.match(await page.getByRole('alert').innerText(), new RegExp(originalOperation)); assert.equal(state.mutations.length, mutationCount, 'reload never resends mutation');
    state.operationUnknown = true; await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'Операция пока не найдена' }).waitFor(); assert.equal(await page.getByRole('dialog').isVisible(), true); assert.match(await page.evaluate(() => Object.values(sessionStorage).join('')), new RegExp(originalOperation), 'unknown original retains receipt marker');
    await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.equal(state.mutations.length, mutationCount, 'unknown mutation never reissued');
    await page.getByRole('tab', { name: 'Роли', exact: true }).click(); await page.getByRole('button', { name: '+ Создать роль' }).click(); await page.getByLabel('Название роли').fill('Документы'); await page.getByRole('checkbox', { name: 'Документы', exact: true }).check(); await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click(); await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '+ Добавить', exact: true }).click(); await page.getByLabel('Telegram ID', { exact: true }).fill('100000004'); await page.getByLabel('Имя для отображения').fill('Иван'); await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click(); await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.getByRole('link', { name: 'Главная', exact: true }).click(); await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth); if (width === 390) await page.screenshot({ path: path.join(output, 'production-mobile.png'), fullPage: true }); }
    await page.getByRole('button', { name: /Поиск работы/ }).click(); await page.getByText('Личный профиль', { exact: true }).waitFor(); assert.equal(state.section, '/sections/jobs');
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click(); await page.getByLabel('Сообщение Jarvis').fill('Мой вопрос'); state.chatUncertain = true;
    await page.getByRole('button', { name: 'Отправить', exact: true }).click(); await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Сообщение Jarvis').inputValue(), 'Мой вопрос');
    const stored = await page.evaluate(() => Object.values(sessionStorage).join('')); assert.equal(stored.includes('Мой вопрос'), false, 'no text persisted'); assert.equal(stored.includes('fixture-csrf'), false, 'no credential persisted');
    await page.reload(); await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).waitFor(); assert.equal(state.chatPosts.length, 1, 'reload never resends chat');
    await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).click(); await page.getByRole('button', { name: 'Отправить', exact: true }).waitFor(); await page.getByText('Ответ Jarvis', { exact: true }).waitFor(); assert.equal(state.chatPosts.length, 1, 'chat never resends unknown request'); assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), [], 'completed receipt clears pending marker');
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await context.close();
    for (const options of [{ level: 'member' }, { outside: true }]) { const ctx = await browser.newContext(); await fixture(ctx, options); const p = await ctx.newPage(); await p.goto(`${origin}/mini/`); if (options.outside) { await p.getByText(/Открой Jarvis Mini App из Telegram/).waitFor(); assert.equal(await p.locator('#application').isVisible(), false); } else { await p.locator('#application').waitFor({ state: 'visible' }); assert.equal(await p.locator('[data-nav="admin"]').isVisible(), false); await p.goto(`${origin}/mini/#admin`); await p.locator('#application').waitFor({ state: 'visible' }); assert.equal(await p.locator('#admin').isVisible(), false); } await ctx.close(); }
    for (const rejectLogin of [false, true]) {
      const ctx = await browser.newContext(); const { state } = await fixture(ctx, { sdkBlocked: true, rejectLogin });
      const p = await ctx.newPage();
      await p.goto(`${origin}/mini/#tgWebAppData=${encodeURIComponent('synthetic-fixture')}&tgWebAppPlatform=tdesktop`);
      if (rejectLogin) {
        await p.waitForFunction(() => document.querySelector('#session-state').textContent !== 'Проверяем доступ…');
        assert.equal(await p.locator('#application').isVisible(), false, 'fragment never grants access without server approval');
        assert.equal(state.session, false);
      } else {
        await p.locator('#application').waitFor({ state: 'visible' });
        assert.equal(state.session, true, 'SDK failure still sends raw launch data for server validation');
        assert.deepEqual(await p.evaluate(() => Object.keys(sessionStorage)), [], 'launch credentials are never persisted');
      }
      await ctx.close();
    }
    console.log('PASS: blocked-SDK fragment login and server rejection, production Telegram fixture login, CSRF, role creation, Telegram ID add, owner protection, sources, confirmation, conflict draft, original-ID mutation/chat reconciliation, private sections, member guards, anonymous, keyboard, 320/390/1280, no credentials storage or unexpected requests.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
