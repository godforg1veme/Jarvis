// Full interior coverage on built Mini App assets and fictional, local API fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');
const output = path.resolve(__dirname, '../.superpowers/mini-app-interiors');
const widths = [320, 390, 844, 1280];
const names = { memory: 'Память', documents: 'Документы', devices: 'Устройства', life: 'Life OS', vpn: 'VPN', operations: 'Панель управления' };
const records = {
  memory: [{ title: 'Мне удобно работать над сложными задачами утром.' }, { title: 'Идея проекта: личная библиотека заметок и документов.' }],
  documents: [{ title: 'План проекта — исследование и подготовка материалов.pdf', detail: 'Готов к использованию' }, { title: 'Заметки по встрече.txt', detail: 'Обрабатывается' }],
  devices: [{ title: 'Рабочий компьютер', detail: 'online' }, { title: 'Домашний ноутбук с длинным именем для проверки переноса', detail: 'offline' }],
  life: [{ title: 'Завершить личный проект', detail: 'Текущая миссия' }, { title: 'Подготовить материалы к встрече', detail: 'Договорённость · 24.10.2026, 10:00 МСК' }],
};
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); }
async function fits(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: page fits`);
  for (const selector of ['#workspace:not([hidden])', 'dialog[open]', '.job-connect-shell']) {
    const element = page.locator(selector);
    if (await element.count()) assert.equal(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${name}: ${selector} fits`);
  }
}
async function open(page, origin, route) {
  await page.goto(`${origin}/mini/?interior=${Date.now()}#${route}`);
  await page.locator('#application').waitFor({ state: 'visible' });
  if (route.startsWith('section/')) await page.locator('#assistant[data-state="ready"]').waitFor();
  if (route === 'admin') await page.locator('#admin[data-state="ready"]').waitFor();
}
async function run(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const { state, errors } = await fixture(context);
  for (const key of Object.keys(names)) state.sectionResponses[key] = { body: { ok: true, items: records[key] || [], notice: key === 'vpn' ? 'Подписки и подтверждения VPN доступны в личном чате с ботом.' : key === 'operations' ? 'Управление пользователями и ролями доступно во вкладке «Управление». Закрытые операции VPS сохраняют подтверждение владельца.' : 'Только твои данные.' } };
  state.messages = [{ role: 'user', content: 'Помоги составить план на неделю.' }, { role: 'assistant', content: 'Начнём с главных задач. Какие встречи и сроки нужно учесть?' }];
  const page = await context.newPage();
  const badAssets = [];
  page.on('response', response => { if (/\.(css|js)(?:$|\?)/.test(response.url()) && response.status() >= 400) badAssets.push(response.url()); });
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const [key, label] of Object.entries(names)) {
        await open(page, origin, `section/${key}`);
        assert.equal(await page.locator('body.orbital-theme').count(), 1, 'common theme applied');
        await page.locator('#section-items').waitFor();
        if (records[key]) {
          assert.equal(await page.locator('.section-card').count(), 2, `${key}: all cards rendered`);
          const search = page.getByLabel(`Поиск в разделе: ${label}`, { exact: true });
          await search.fill('невозможный запрос'); await page.getByText('Ничего не найдено.', { exact: true }).waitFor();
          assert.equal(await page.locator('.section-card:visible').count(), 0);
          await search.fill('');
        } else assert.equal(await page.locator('#section-items button').count(), 0, 'informational destination does not invent controls');
        await fits(page, `${key}-${width}`);
        if (width === 390 || width === 1280) await screenshot(page, `${key}-${width}`);
      }
      await open(page, origin, 'assistant');
      await page.getByText('Начнём с главных задач. Какие встречи и сроки нужно учесть?', { exact: true }).waitFor();
      assert.equal(await page.locator('.chat-message__avatar').count(), 2);
      await fits(page, `chat-${width}`); if (width === 390) await screenshot(page, 'chat-390');
      await open(page, origin, 'admin');
      await page.getByRole('button', { name: /Анна/ }).click();
      await fits(page, `permissions-${width}`);
      await page.getByRole('radio', { name: 'Документы: Да', exact: true }).check();
      await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
      assert.equal(await page.locator('#editor').getAttribute('data-state'), 'confirmation');
      await fits(page, `confirmation-${width}`);
      if (width === 390) await screenshot(page, 'access-confirmation-390');
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      await page.getByRole('tab', { name: 'Роли', exact: true }).click();
      await page.getByRole('button', { name: '+ Создать роль', exact: true }).click();
      await fits(page, `role-editor-${width}`); if (width === 390) await screenshot(page, 'role-editor-390');
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, origin, 'admin');
    await page.getByRole('button', { name: /Владелец/ }).click();
    assert.equal(await page.locator('#editor-form [type=submit]').isHidden(), true);
    await screenshot(page, 'access-owner-protected'); await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: '+ Добавить', exact: true }).click();
    await screenshot(page, 'access-new-user'); await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: /Анна/ }).click();
    await page.getByRole('button', { name: 'Заблокировать пользователя', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
    state.uncertain = true;
    await page.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click();
    await page.locator('#editor[data-state=unknown]').waitFor(); await screenshot(page, 'access-unknown');
    const accessMutations = state.mutations.length;
    await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    assert.equal(state.mutations.length, accessMutations, 'reconciliation never repeats access mutation');
    for (const key of Object.keys(records)) {
      state.sectionResponses[key].body.items = [];
      await open(page, origin, `section/${key}`);
      await page.locator('.section-empty').waitFor(); await fits(page, `empty-${key}`); await screenshot(page, `empty-${key}`);
    }
    state.sectionResponses.memory.body.items = [{ title: '<img src=x onerror=alert(1)>' }];
    await open(page, origin, 'section/memory');
    assert.equal(await page.locator('.section-card img').count(), 0, 'untrusted content remains text');
    await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor();
    state.sectionResponses.documents = { status: 503, body: { ok: false } };
    await open(page, origin, 'home'); await page.goto(`${origin}/mini/#section/documents`);
    await page.locator('#section-retry').waitFor(); await screenshot(page, 'section-error');
    let adminFailure = true;
    await context.route('**/mini/api/admin', route => route.fulfill({ status: adminFailure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(adminFailure ? { ok: false } : { ok: true, users: [], roles: [], audit: [] }) }));
    await page.goto(`${origin}/mini/#admin`);
    await page.locator('#admin-feedback').waitFor(); await screenshot(page, 'admin-error');
    adminFailure = false; await page.locator('#admin-feedback button').click();
    await page.getByText('Пользователь не найден.', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Роли', exact: true }).click();
    await page.getByText('Роли пока не созданы.', { exact: true }).waitFor();
    await screenshot(page, 'admin-empty');
    state.messages = []; await open(page, origin, 'assistant');
    await page.locator('.chat-empty').waitFor(); await screenshot(page, 'chat-empty');
    state.historyFailure = true; await open(page, origin, 'assistant');
    await page.locator('#chat-retry').waitFor(); await screenshot(page, 'chat-error');
    state.historyFailure = false; await page.locator('#chat-retry').click(); await page.locator('#chat-retry').waitFor({ state: 'detached' });
    state.chatUncertain = true; await page.getByLabel('Сообщение Jarvis').fill('Тест неизвестного результата');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.locator('.chat-state[data-state="unknown"]').waitFor(); await screenshot(page, 'chat-unknown');
    await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).click();

    await open(page, origin, 'section/jobs'); await page.getByRole('button', { name: 'Подключить HH', exact: true }).waitFor();
    await screenshot(page, 'hh-disconnected');
    await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
    const link = page.getByRole('link', { name: 'Открыть окно входа HH', exact: true }); await link.waitFor();
    await screenshot(page, 'hh-link');
    const framePage = await context.newPage(); await framePage.setViewportSize({ width: 1024, height: 768 });
    await framePage.setContent('<html lang="ru"><body style="margin:0;padding:70px;background:#fff;color:#222;font:24px Arial"><p>Тестовое окно провайдера</p><h1>Вход в профиль</h1><p>Телефон или email</p><input aria-label="Телефон" style="height:44px;width:400px;border:1px solid #aaa"><p><button style="padding:15px 35px">Продолжить</button></p></body></html>');
    const frameBytes = await framePage.screenshot({ type: 'png' }); await framePage.close();
    await context.route('**/mini/api/jobs/login/frame/*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'waiting', mimeType: 'image/png', frameBase64: frameBytes.toString('base64'), width: 1024, height: 768 }) }));
    const guest = await context.newPage(); await guest.goto(await link.getAttribute('href'));
    await guest.locator('#job-connect-stage').waitFor({ state: 'visible' });
    assert.equal(await guest.locator('body.orbital-theme').count(), 1);
    for (const width of widths) { await guest.setViewportSize({ width, height: 844 }); await fits(guest, `hh-window-${width}`); }
    await guest.setViewportSize({ width: 390, height: 844 }); await screenshot(guest, 'hh-window');
    await guest.close();
    state.jobStatus = 'authenticated';
    await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).waitFor({ timeout: 8000 });
    await screenshot(page, 'hh-select-resume');
    await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
    let enabled = true, revision = 1, uncertain = false, mutations = 0;
    const resume = () => ({ ok: true, connected: true, raiseAvailable: true, revision, connectionRevision: 1, primaryResumeId: 'resume-1', updatedAt: '2026-10-23T09:00:00Z', resumes: [{ id: 'resume-1', title: 'Разработчик — основной профиль' }], autoRaise: { enabled, lastAt: null, nextAt: '2026-10-23T13:00:00Z', lastOutcome: null } });
    await context.route('**/mini/api/jobs/resumes', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(resume()) }));
    await context.route('**/mini/api/jobs/resumes/settings', route => { mutations++; enabled = route.request().postDataJSON().autoRaiseEnabled; revision++; return uncertain ? route.abort() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'complete' }) }); });
    await context.route('**/mini/api/jobs/resumes/operations/*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'complete' }) }));
    await open(page, origin, 'section/jobs');
    await page.getByLabel('Автоподнятие выбранного резюме').waitFor();
    for (const width of widths) { await page.setViewportSize({ width, height: 844 }); await fits(page, `resumes-${width}`); }
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'hh-resumes');
    await page.getByLabel('Автоподнятие выбранного резюме').uncheck();
    await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
    assert.equal(mutations, 0); await screenshot(page, 'hh-confirmation');
    uncertain = true; await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.locator('.job-resume-manager[data-state="unknown"]').waitFor(); await screenshot(page, 'hh-unknown');
    await page.getByRole('button', { name: 'Проверить исходный запрос', exact: true }).click();
    await page.locator('.job-resume-manager[data-state="ready"]').waitFor(); assert.equal(mutations, 1, 'unknown change is never sent twice');
    assert.deepEqual(errors, []); assert.deepEqual(badAssets, []);
  } finally { await context.close(); }
}
(async () => {
  await fs.mkdir(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try { await run(browser, `http://127.0.0.1:${server.address().port}`); console.log('PASS: all Mini App interiors, filters, empty/error/unknown/confirmation states, HH connection and resumes, owner access editors, XSS text rendering and 320/390/844/1280 layouts.'); console.log(`Screenshots: ${output}`); }
  finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
