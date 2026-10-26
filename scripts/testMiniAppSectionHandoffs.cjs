// Synthetic Telegram/Operations navigation. All destinations are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');
const output = path.resolve(__dirname, '../.superpowers/mini-app-handoffs');
const names = { memory: 'Память', documents: 'Документы', devices: 'Устройства', life: 'Life OS',
  jobs: 'Поиск работы', vpn: 'VPN', operations: 'Панель управления' };
const botUrl = (section) => `https://t.me/jarvis_fixture_bot?start=mini_${section}`;

async function nativeNavigation(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  const { state, errors } = await fixture(context);
  for (const permission of Object.keys(names)) state.sectionResponses[permission] = { body: {
    ok: true, items: [], actions: [{ kind: 'telegram', href: botUrl(permission), label: '<img src=x onerror=alert(1)>' },
      ...(permission === 'operations' ? [{ kind: 'operations', href: 'https://ops.fixture.test/ops/' }] : [])],
  } };
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mini/#section/memory`);
    await page.locator('#assistant[data-state=ready]').waitFor();
    await page.evaluate(() => {
      window.handoffs = [];
      window.Telegram.WebApp.openTelegramLink = (href) => window.handoffs.push(['telegram', href]);
      window.Telegram.WebApp.openLink = (href) => window.handoffs.push(['operations', href]);
    });
    for (const permission of Object.keys(names)) {
      await page.evaluate((permission) => { location.hash = `#section/${permission}`; }, permission);
      const link = page.locator('#section-items [data-destination=telegram]');
      await link.filter({ hasText: names[permission] }).waitFor();
      assert.equal(await link.getAttribute('href'), botUrl(permission));
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      await link.click();
      assert.deepEqual((await page.evaluate(() => window.handoffs)).at(-1), ['telegram', botUrl(permission)]);
      assert.equal(await page.locator('#section-items img').count(), 0, 'server label is never markup');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${permission} fits ${width}`);
      if (permission === 'jobs') assert.equal(await page.locator('.job-panel').count(), 1, 'HH controls remain available beside handoff');
      if (permission === 'operations') {
        await page.getByRole('link', { name: 'Открыть Operations', exact: true }).click();
        assert.deepEqual((await page.evaluate(() => window.handoffs)).at(-1), ['operations', 'https://ops.fixture.test/ops/']);
        await page.screenshot({ path: path.join(output, `operations-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(state.mutations, [], 'navigation never changes user permissions');
    assert.deepEqual(state.chatPosts, [], 'navigation never sends assistant messages');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function fallbackNavigation(browser, origin, throws) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { state, errors } = await fixture(context);
  state.sectionResponses.vpn = { body: { ok: true, items: [], actions: [{ kind: 'telegram', href: botUrl('vpn') }] } };
  await context.route('https://t.me/**', (route) => route.fulfill({ contentType: 'text/html', body: 'Synthetic Telegram destination' }));
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mini/#section/vpn`);
    const link = page.locator('#section-items [data-destination=telegram]'); await link.waitFor();
    await page.evaluate((throws) => {
      if (throws) window.Telegram.WebApp.openTelegramLink = () => { throw Error('Synthetic unavailable SDK'); };
      else delete window.Telegram;
    }, throws);
    const popupPromise = context.waitForEvent('page');
    await link.click(); const popup = await popupPromise;
    await popup.waitForURL(botUrl('vpn'));
    await popup.getByText('Synthetic Telegram destination').waitFor();
    assert.deepEqual(errors, []);
    await popup.close();
  } finally { await context.close(); }
}

async function invalidNavigation(browser, origin) {
  const context = await browser.newContext(); const { state, errors } = await fixture(context);
  state.sectionResponses.memory = { body: { ok: true, items: [], actions: [
    { kind: 'telegram', href: 'javascript:alert(1)' },
    { kind: 'telegram', href: 'https://t.me.evil.test/jarvis_fixture_bot?start=mini_memory' },
    { kind: 'telegram', href: 'https://credential@t.me/jarvis_fixture_bot?start=mini_memory' },
    { kind: 'telegram', href: `${botUrl('memory')}&start=mini_vpn` },
    { kind: 'telegram', href: `${botUrl('memory')}#unexpected` },
    { kind: 'telegram', href: botUrl('vpn') },
    { kind: 'operations', href: 'https://ops.fixture.test/ops/' },
    { kind: 'unknown', href: botUrl('memory') }, null,
  ] } };
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mini/#section/memory`);
    await page.locator('#assistant[data-state=ready]').waitFor();
    assert.equal(await page.locator('#section-items a').count(), 0, 'malformed and mismatched destinations stay hidden');
    await page.getByText('Открой личный чат с ботом и выбери нужный раздел в меню.', { exact: true }).waitFor();
    await page.getByText('В памяти пока нет записей.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    for (const width of [390, 1280]) await nativeNavigation(browser, origin, width);
    await fallbackNavigation(browser, origin, false); await fallbackNavigation(browser, origin, true);
    await invalidNavigation(browser, origin);
    console.log('PASS: section-specific native handoffs, SDK absent/throw anchor fallback, malformed links rejected, empty sections and HH preserved, 390/1280 px.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
