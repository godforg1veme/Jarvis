// Design-only browser verification; no real Telegram data or server mutations.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('../job-browser/node_modules/playwright');

(async () => {
  const output = path.resolve(__dirname, '../.superpowers/mini-app-preview');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto((process.env.MINI_PREVIEW_URL || 'http://127.0.0.1:5187/'));
    await page.waitForFunction(() => document.querySelector('#core-loading').hidden);
    assert.equal(await page.locator('#core-stage').getAttribute('data-render'), 'webgl', 'actual WebGL rendering, not a fallback');
    const frame = () => page.locator('#core-stage').getAttribute('data-frames').then(Number);
    const first = await frame();
    await page.waitForFunction((previous) => Number(document.querySelector('#core-stage').dataset.frames) > previous + 3, first);
    assert.equal(await page.locator('.motion-controls').count(), 0, 'preview exposes only current automatic motion');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    const beforeNavigation = await frame();
    await page.waitForFunction((previous) => Number(document.querySelector('#core-stage').dataset.frames) > previous, beforeNavigation);
    await page.getByRole('link', { name: 'Управление', exact: true }).click();
    await page.waitForTimeout(100);
    const hidden = await frame();
    await page.waitForTimeout(200);
    assert.equal(await frame(), hidden, 'offscreen scene stops rendering');
    assert.equal((await page.locator('body').innerText()).includes('@example.com'), false);
    await page.getByRole('button', { name: /Анна/ }).click();
    await page.getByRole('radio', { name: 'Документы: Да', exact: true }).check();
    await page.getByRole('radio', { name: 'Поиск работы: Нет', exact: true }).check();
    assert.equal(await page.locator('#access-summary').innerText(), 'Доступны: Документы', 'personal deny and allow override inherited role');
    await page.getByRole('button', { name: 'Сохранить в превью' }).click();
    await page.getByRole('button', { name: /Анна/ }).click();
    assert.equal(await page.getByRole('radio', { name: 'Документы: Да', exact: true }).isChecked(), true);
    await page.getByRole('radio', { name: 'Поиск работы: По роли', exact: true }).check();
    assert.equal(await page.locator('#access-summary').innerText(), 'Доступны: Поиск работы, Документы');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: '+ Добавить', exact: true }).click();
    await page.getByLabel('Telegram ID', { exact: true }).fill('100000004');
    await page.getByLabel('Имя для отображения').fill('<b>Тест</b>');
    await page.getByRole('button', { name: 'Сохранить в превью' }).click();
    assert.equal(await page.getByRole('button', { name: /<b>Тест<\/b>/ }).count(), 1, 'display names render as text');
    assert.equal(await page.locator('#users b').count(), 0);
    await page.getByRole('button', { name: '+ Добавить', exact: true }).click();
    await page.getByLabel('Telegram ID', { exact: true }).fill('100000004');
    await page.getByLabel('Имя для отображения').fill('Дубликат');
    await page.getByRole('button', { name: 'Сохранить в превью' }).click();
    assert.equal(await page.getByRole('alert').innerText(), 'Этот Telegram ID уже добавлен.');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('tab', { name: 'Роли', exact: true }).click();
    await page.getByRole('button', { name: '+ Создать роль' }).click();
    await page.getByLabel('Название роли').fill('Документы');
    await page.getByRole('checkbox', { name: 'Документы', exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить в превью' }).click();
    assert.equal(await page.locator('#roles .user-row').count(), 3);
    for (const width of [320, 390, 844]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('link', { name: 'Главная', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `home fits ${width}px`);
      if (width === 390) {
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      }
      await page.getByRole('link', { name: 'Управление', exact: true }).click();
      await page.getByRole('tab', { name: /Пользователи/ }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `admin fits ${width}px`);
      await page.getByRole('button', { name: /Анна/ }).click();
      assert.equal(await page.locator('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth), true, `permissions dialog fits ${width}px`);
      if (width === 390) await page.screenshot({ path: path.join(output, 'permissions.png'), fullPage: true });
      await page.keyboard.press('Escape');
    }
    await page.reload();
    assert.equal(await page.locator('#users .user-row').count(), 3, 'sandbox edits are not persisted');
    assert.deepEqual(errors, [], 'no browser or CSP errors');
    await context.close();

    const reducedContext = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto((process.env.MINI_PREVIEW_URL || 'http://127.0.0.1:5187/'));
    await reducedPage.waitForFunction(() => document.querySelector('#core-loading').hidden);
    assert.equal(await reducedPage.locator('#core-stage').getAttribute('data-render'), 'webgl');
    assert.equal(await reducedPage.locator('.motion-controls').count(), 0);
    await reducedContext.close();

    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
      };
    });
    await fallback.goto((process.env.MINI_PREVIEW_URL || 'http://127.0.0.1:5187/'));
    await fallback.waitForFunction(() => document.querySelector('#core-loading').hidden);
    assert.equal(await fallback.locator('#core-stage').getAttribute('data-render'), 'fallback');
    await fallback.getByRole('link', { name: 'Управление', exact: true }).click();
    await fallback.getByRole('button', { name: /Анна/ }).click();
    assert.equal(await fallback.getByRole('dialog').isVisible(), true, 'admin UI survives missing WebGL');
    await fallback.close();
    console.log('PASS: WebGL automatic motion/offscreen, personal overrides, Telegram ID uniqueness, XSS text rendering, role creation, 320/390/844px, ephemeral edits, reduced-motion context, WebGL fallback, no CSP errors.');
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
