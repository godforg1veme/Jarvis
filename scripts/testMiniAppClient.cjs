// Synthetic browser API fixtures; no Telegram secrets or real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { chromium } = require('../job-browser/node_modules/playwright');
const root = path.resolve(__dirname, '../mini-app/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = http.createServer(async (request, response) => {
  let relative = new URL(request.url, 'http://localhost').pathname.replace(/^\/mini\//, '') || 'index.html';
  if (relative === 'job-connect/') relative = 'job-connect.html';
  if (relative.includes('..') || !/^(index\.html|job-connect\.html|(?:app|api|admin|core|orbitalBodies|orbitMotion|sectionViews|memoryActions|jobConnect|jobConnection|jobResumes)\.js|(?:style|orbital|interior|jobResumes)\.css|assets\/milky-way-gaia-4k\.webp|vendor\/(?:three\.module|three\.core|RoomEnvironment)\.js)$/.test(relative)) return response.writeHead(404).end();
  try { const content = await fs.readFile(path.join(root, relative)); response.writeHead(200, { 'Content-Type': types[path.extname(relative)], 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; connect-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'" }).end(content); }
  catch { response.writeHead(404).end(); }
});
async function fixture(context, { level = 'owner', outside = false, sdkBlocked = false, rejectLogin = false } = {}) {
  const users = [{ telegramId: '100000001', displayName: 'Владелец', level: 'owner', roleId: null, permissions: Object.keys({ assistant:1,jobs:1,life:1,memory:1,documents:1,devices:1,vpn:1,operations:1 }), overrides: {}, revision: 1 }, { telegramId: '100000003', displayName: '<b>Анна</b>', level: 'member', roleId: 'search', overrides: {}, permissions: ['jobs'], revision: 1, blocked: false }];
  const roles = [{ id: 'search', name: 'Только поиск', permissions: ['jobs'], revision: 1 }];
  const actor = level === 'member' ? users[1] : { ...users[0], level };
  const state = { mutations: [], uncertain: false, conflict: false, session: false, op: null, section: null, sectionResponses: {}, sectionGates: {}, sectionReads: {}, historyGets: 0, blocked: false, chatUncertain: false, chatPosts: [], chatOp: null, messages: [], operationUnknown: false,
    jobSessionId: randomUUID(), jobTicket: 'a'.repeat(64), jobStatus: 'waiting', jobConnected: false, jobCreateRequests: [], jobClaims: [], jobConfirm: null, guestEvents: [] };
  const external = []; const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route('https://telegram.org/**', (route) => sdkBlocked ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: outside ? '' : 'window.Telegram={WebApp:{initData:"synthetic-fixture",ready(){},expand(){}}};' }));
  await context.route('**/mini/api/**', async (route) => {
    const request = route.request(); const endpoint = new URL(request.url()).pathname.slice('/mini/api'.length);
    const body = request.postDataJSON();
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (endpoint === '/session') { assert.equal(body.initData, 'synthetic-fixture'); if (rejectLogin) return send({ ok: false, code: 'invalid_login' }, 400); state.session = true; return send({ ok: true, csrfToken: 'fixture-csrf', actor, catalog: [] }); }
    if (endpoint === '/me') return send(state.session ? { ok: true, csrfToken: 'fixture-csrf', actor, catalog: [] } : { ok: false }, state.session ? 200 : 401);
    if (endpoint.startsWith('/sections/')) {
      state.section = endpoint; const permission = endpoint.split('/').at(-1);
      state.sectionReads[permission] = (state.sectionReads[permission] || 0) + 1;
      if (state.sectionGates[permission]) await state.sectionGates[permission];
      const response = state.sectionResponses[permission];
      const items = permission === 'documents' ? [{ title: 'План на неделю', detail: 'Обновлён сегодня' }, { title: 'Заметки по проекту', detail: 'Личный документ' }] : [{ title: 'Личный профиль' }];
      return response ? send(response.body, response.status || 200) : send({ ok: true, section: permission, items, notice: permission === 'jobs' ? 'Нужно личное подключение HH.' : 'Только твои данные.' });
    }
    if (endpoint === '/jobs/connection') return send({ ok: true, available: true, connected: state.jobConnected, ...(state.jobConnected ? { resumeId: 'resume-1' } : {}) });
    if (endpoint === '/jobs/resumes') return send({ok:true,connected:state.jobConnected,primaryResumeId:'resume-1',connectionRevision:1,revision:1,
      resumes:[{id:'resume-1',title:'Моё резюме'}],updatedAt:new Date().toISOString(),autoRaise:{enabled:false,resumeId:null,nextAt:null,lastAt:null,lastOutcome:null},lastError:null,raiseAvailable:false});
    if (endpoint === '/jobs/login' && request.method() === 'POST') {
      assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf'); state.jobCreateRequests.push(body);
      return send({ ok: true, status: 'created', sessionId: state.jobSessionId, ticket: state.jobTicket });
    }
    if (endpoint === `/jobs/login/owned/status/${state.jobSessionId}`) return send({ ok: true,
      status: state.jobStatus === 'authenticated' ? 'authenticated' : state.jobStatus,
      state: state.jobStatus, resumes: state.jobStatus === 'authenticated' ? [{ id: 'resume-1', title: 'Моё резюме' }] : [], nextSequence: 1 });
    if (endpoint === '/jobs/login/claim' && request.method() === 'POST') {
      assert.ok(!request.headers()['x-jarvis-csrf']); state.jobClaims.push(body.ticket);
      return send({ ok: true, sessionId: state.jobSessionId });
    }
    if (endpoint === `/jobs/login/status/${state.jobSessionId}`) return send({ ok: true, status: 'claimed', state: state.jobStatus, nextSequence: 1 });
    if (endpoint === `/jobs/login/frame/${state.jobSessionId}`) return send({ ok: true, state: state.jobStatus, mimeType: 'image/jpeg', frameBase64: 'ZmFrZQ==', width: 10, height: 10 });
    if (endpoint === `/jobs/login/input/${state.jobSessionId}` && request.method() === 'POST') {
      state.guestEvents.push(body.event); return send({ ok: true, nextSequence: body.sequence + 1 });
    }
    if (endpoint === '/jobs/login/confirm' && request.method() === 'POST') {
      assert.equal(request.headers()['x-jarvis-csrf'], 'fixture-csrf'); state.jobConfirm = body; state.jobConnected = true;
      return send({ ok: true, status: 'confirmed' });
    }
    if (endpoint === '/assistant/messages' && request.method() === 'GET') {
      state.historyGets++; const messages = state.messages.slice();
      const gate = state.nextHistoryGate; state.nextHistoryGate = null;
      state.historyStarted?.();
      if (gate) await gate;
      return state.historyFailure ? send({ ok: false }, 503) : send({ ok: true, messages });
    }
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
async function verifyNavigation(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const { state, errors } = await fixture(context);
  const page = await context.newPage();
  const modules = { memory: 'Память', documents: 'Документы', devices: 'Устройства', life: 'Life OS', jobs: 'Поиск работы', vpn: 'VPN', operations: 'Панель управления' };
  const moduleButton = (label) => page.getByRole('button').filter({ has: page.locator('strong', { hasText: label }) });
  const open = async (permission) => {
    await page.locator('#home').waitFor({ state: 'visible' });
    if (await page.locator('#modules').isHidden()) await page.locator('#all-sections').click();
    await moduleButton(modules[permission]).click();
    await page.waitForURL(`**/#section/${permission}`);
    await page.locator('#assistant h1').filter({ hasText: modules[permission] }).waitFor();
  };
  try {
    await page.goto(`${origin}/mini/#home`);
    await page.locator('#application').waitFor({ state: 'visible' });
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const permission of Object.keys(modules)) {
        await open(permission);
        assert.equal(await page.locator('[data-nav="assistant"]').getAttribute('aria-current'), null, 'section is not chat');
        await page.getByRole('link', { name: 'Главная', exact: true }).click();
        await page.locator('#home').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-nav="home"]').getAttribute('aria-current'), 'page');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `navigation fits ${width}px`);
      }
    }
    await open('documents');
    await page.getByRole('link', { name: 'Jarvis — главная', exact: true }).click();
    await page.locator('#home').waitFor({ state: 'visible' });
    await page.goBack(); await page.waitForURL('**/#section/documents');
    await page.locator('#assistant h1').filter({ hasText: 'Документы' }).waitFor();
    await page.reload(); await page.locator('#assistant h1').filter({ hasText: 'Документы' }).waitFor();
    await page.goForward(); await page.locator('#home').waitFor({ state: 'visible' });
    const before = state.historyGets;
    if (await page.locator('#modules').isHidden()) await page.locator('#all-sections').click();
    await moduleButton('Ассистент').click();
    await page.locator('#chat').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.chat-history').textContent.length > 0);
    await page.waitForTimeout(100);
    assert.equal(state.historyGets - before, 1, 'module loads chat once');
    await page.getByLabel('Сообщение Jarvis').fill('Несохранённый черновик');
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await open('memory');
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click();
    await page.locator('#chat').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Сообщение Jarvis').inputValue(), 'Несохранённый черновик');
    state.historyFailure = true;
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click();
    await page.locator('#chat-retry').waitFor({ state: 'visible' });
    state.historyFailure = false;
    await page.locator('#chat-retry').click();
    await page.locator('#chat-retry').waitFor({ state: 'detached' });
    assert.equal(await page.getByLabel('Сообщение Jarvis').inputValue(), 'Несохранённый черновик', 'history retry retains draft');
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    let releaseHistory, historyStarted;
    const started = new Promise(resolve => { historyStarted = resolve; });
    state.historyStarted = historyStarted;
    state.nextHistoryGate = new Promise(resolve => { releaseHistory = resolve; });
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click(); await started;
    state.historyStarted = null;
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.getByText('Ответ Jarvis', { exact: true }).waitFor();
    releaseHistory(); await page.waitForTimeout(100);
    assert.equal(await page.getByText('Ответ Jarvis', { exact: true }).count(), 1, 'old history GET cannot replace post-send history');
    const emptyMessages = { documents: 'Документов пока нет.', memory: 'В памяти пока нет записей.', devices: 'Устройств пока нет.', life: 'В Life OS пока нет записей.' };
    for (const permission of Object.keys(emptyMessages)) {
      state.sectionResponses[permission] = { body: { ok: true, items: [] } };
      await page.getByRole('link', { name: 'Главная', exact: true }).click();
      await open(permission);
      await page.waitForFunction(() => !document.querySelector('#assistant').textContent.includes('Загружаем твои данные…'));
      await page.getByText(emptyMessages[permission], { exact: true }).waitFor();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const uxScreenshots = path.resolve(__dirname, '../.superpowers/mini-app-preview');
    await fs.mkdir(uxScreenshots, { recursive: true });
    await page.screenshot({ path: path.join(uxScreenshots, 'ux-empty-mobile.png'), fullPage: true });
    state.sectionResponses.documents = { body: { ok: false }, status: 503 };
    await page.getByRole('link', { name: 'Главная', exact: true }).click(); await open('documents');
    const retry = page.getByRole('button', { name: /Повторить/ }); await retry.waitFor();
    await page.screenshot({ path: path.join(uxScreenshots, 'ux-retry-mobile.png'), fullPage: true });
    const reads = state.sectionReads.documents;
    state.sectionResponses.documents = { body: { ok: true, notice: 'Тестовая подсказка сервера', items: [{ title: 'После повторной загрузки' }] } };
    await retry.click(); await page.getByText('После повторной загрузки', { exact: true }).waitFor();
    assert.equal(state.sectionReads.documents - reads, 1, 'retry reads once');
    await page.getByText('Тестовая подсказка сервера', { exact: true }).waitFor();
    let release;
    state.sectionGates.documents = new Promise(resolve => { release = resolve; });
    state.sectionResponses.documents = { body: { ok: true, notice: 'Поздний ответ документов', items: [{ title: 'Поздний документ' }] } };
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    const oldReads = state.sectionReads.documents;
    await open('documents'); await page.waitForFunction(() => document.querySelector('#assistant').textContent.includes('Загружаем'));
    for (let attempt = 0; state.sectionReads.documents === oldReads && attempt < 100; attempt++) await page.waitForTimeout(10);
    assert.ok(state.sectionReads.documents > oldReads, 'delayed request started');
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await open('memory'); release(); delete state.sectionGates.documents;
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#assistant h1').innerText(), 'Память');
    assert.equal(await page.getByText('Поздний документ', { exact: true }).count(), 0, 'stale response ignored');
    await page.goto(`${origin}/mini/#section/jobs`);
    await page.getByText('Личный профиль HH', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.locator('.job-panel').waitFor({ state: 'detached' });
    await page.goto(`${origin}/mini/#section/not-a-permission`); await page.locator('#home').waitFor({ state: 'visible' });
    let releaseLogout;
    state.sectionGates.documents = new Promise(resolve => { releaseLogout = resolve; });
    await open('documents');
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.locator('#application').waitFor({ state: 'hidden' });
    releaseLogout(); await page.waitForTimeout(100);
    assert.equal(await page.locator('#application').isHidden(), true, 'late response cannot reopen logged out app');
    assert.equal(await page.getByText('Поздний документ', { exact: true }).count(), 0, 'logout discards delayed section content');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  const member = await browser.newContext(); await fixture(member, { level: 'member' });
  try {
    const page = await member.newPage(); await page.goto(`${origin}/mini/#section/documents`);
    await page.locator('#home').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#assistant').isVisible(), false, 'unauthorized deep link stays on home');
    await page.goto(`${origin}/mini/#section/jobs`); await page.getByText('Личный профиль HH', { exact: true }).waitFor();
  } finally { await member.close(); }
  console.log('PASS: section routes, home/logo/back/forward/reload, single chat GET, chat draft, empty states, explicit retry, stale responses, HH disposal and member deep links at 320/390/1280px.');
}
async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await verifyNavigation(browser, origin);
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
    if (await page.locator('#modules').isHidden()) await page.locator('#all-sections').click();
    await page.locator('[data-module="jobs"]').click(); await page.getByText('Личный профиль HH', { exact: true }).waitFor(); assert.equal(state.section, '/sections/jobs');
    await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
    const jobLink = page.getByRole('link', { name: 'Открыть окно входа HH', exact: true }); await jobLink.waitFor();
    const href = await jobLink.getAttribute('href'), linkUrl = new URL(href);
    assert.equal(linkUrl.pathname, '/mini/job-connect/'); assert.equal(new URLSearchParams(linkUrl.hash.slice(1)).get('ticket'), state.jobTicket);
    assert.equal(state.jobCreateRequests.length, 1); assert.equal(await page.evaluate((ticket) => Object.values(sessionStorage).join('').includes(ticket), state.jobTicket), false);
    const connectPage = await context.newPage(); await connectPage.goto(href);
    await connectPage.locator('#job-connect-stage').waitFor({ state: 'visible' });
    for (const width of [390, 1280]) {
      await connectPage.setViewportSize({ width, height: 844 });
      assert.equal(await connectPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `HH login page fits ${width}px`);
    }
    assert.equal(new URL(connectPage.url()).hash, '', 'one-time ticket is removed from the address bar after claim');
    assert.equal(await connectPage.locator('#job-connect-input').getAttribute('type'), 'password');
    assert.deepEqual(state.jobClaims, [state.jobTicket]);
    assert.equal(await connectPage.evaluate((ticket) => Object.values(sessionStorage).join('').includes(ticket), state.jobTicket), false);
    await connectPage.getByRole('button', { name: 'Показать ввод', exact: true }).click();
    assert.equal(await connectPage.locator('#job-connect-input').getAttribute('type'), 'text');
    await connectPage.locator('#job-connect-input').fill('фиктивный текст');
    await connectPage.getByRole('button', { name: 'Ввести в HH', exact: true }).click();
    await Promise.all([
      connectPage.waitForResponse((response) => response.url().includes('/jobs/login/input/')
        && response.request().postDataJSON()?.event?.type === 'key'),
      connectPage.getByRole('button', { name: 'Enter', exact: true }).click(),
    ]);
    assert.deepEqual(state.guestEvents.map((event) => event.type), ['text', 'key']);
    assert.equal(await connectPage.locator('#job-connect-input').inputValue(), '');
    state.jobStatus = 'authenticated';
    await connectPage.getByText('Вход HH подтверждён. Вернись в Mini App и выбери основное резюме.').waitFor();
    const resumeSelect = page.getByRole('combobox', { name: 'Основное резюме HH' }); await resumeSelect.waitFor();
    assert.equal(await resumeSelect.locator('option').count(), 1);
    await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
    await page.getByText(/HH подключён\. Резюме и настройки обновления доступны ниже/).waitFor();
    assert.deepEqual(state.jobConfirm, { sessionId: state.jobSessionId, resumeId: 'resume-1' });
    await connectPage.close();
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click(); await page.getByLabel('Сообщение Jarvis').fill('Мой вопрос'); state.chatUncertain = true;
    await page.getByRole('button', { name: 'Отправить', exact: true }).click(); await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Сообщение Jarvis').inputValue(), 'Мой вопрос');
    const stored = await page.evaluate(() => Object.values(sessionStorage).join('')); assert.equal(stored.includes('Мой вопрос'), false, 'no text persisted'); assert.equal(stored.includes('fixture-csrf'), false, 'no credential persisted');
    await page.reload(); await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).waitFor(); assert.equal(state.chatPosts.length, 1, 'reload never resends chat');
    await page.getByText('Ответ Jarvis', { exact: true }).waitFor();
    assert.match(await page.locator('.chat-form [role="status"]').innerText(), new RegExp(state.chatOp.requestId), 'history load retains unknown request explanation');
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.getByRole('link', { name: 'Ассистент', exact: true }).click();
    await page.getByText('Ответ Jarvis', { exact: true }).waitFor();
    assert.match(await page.locator('.chat-form [role="status"]').innerText(), new RegExp(state.chatOp.requestId), 'revisit retains unknown request explanation');
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
}
module.exports = { fixture, server };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
