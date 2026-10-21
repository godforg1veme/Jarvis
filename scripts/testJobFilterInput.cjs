// Local PC fixture: real Telegram handlers + isolated PostgreSQL, rendered in Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');
const { historyFixture } = require('../server/test/helpers/jobHistoryFixture');

(async () => {
  const f = await historyFixture();
  let update = 88000;
  const engine = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await engine.newPage({ viewport: { width: 1100, height: 950 } });
  try {
    await f.cb('job:menu');
    await page.setContent('<!doctype html><meta charset="utf-8"><title>Job filter input fixture</title><style>body{background:#101c25;color:#e9f2f7;font:18px system-ui;margin:32px auto;max-width:660px}h1{font-size:22px}#answer{white-space:pre-wrap;padding:22px;background:#192b38;border-radius:12px}#buttons{display:grid;gap:8px;margin:12px 0}button{font:inherit;padding:12px;color:#e9f2f7;background:#20576b;border:0;border-radius:8px;cursor:pointer}textarea{box-sizing:border-box;width:100%;font:inherit;padding:14px;min-height:150px}#send{margin-top:8px}</style><h1>Telegram · локальная проверка фильтров</h1><div id="answer"></div><div id="buttons"></div><textarea aria-label="Сообщение"></textarea><button id="send">Отправить</button>');
    const render = async view => page.evaluate(view => {
      document.querySelector('#answer').textContent = view.answer;
      const buttons = document.querySelector('#buttons'); buttons.replaceChildren();
      for (const row of view.buttons || []) for (const item of row) {
        if (!item.data) continue;
        const b = document.createElement('button'); b.textContent = item.text;
        b.onclick = () => window.jobCallback(item.data); buttons.append(b);
      }
    }, view);
    await page.exposeFunction('jobCallback', async data => render(await f.cb(data)));
    await page.exposeFunction('jobMessage', async text => render(await f.messages.handle({ update_id: ++update,
      message: { message_id: update, from: { id: 101 }, chat: { id: 101, type: 'private' }, text } })));
    await page.evaluate(() => { document.querySelector('#send').onclick = () => window.jobMessage(document.querySelector('textarea').value); });
    await render(await f.cb('job:settings'));
    assert.match(await page.locator('#buttons').textContent(), /Доход: Не задан/);
    assert.match(await page.locator('#buttons').textContent(), /Город: Любой город/);
    await page.getByRole('button', { name: /Поисковые запросы:/ }).click();
    await page.getByRole('button', { name: '＋ Добавить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#answer').textContent.includes('каждая фраза с новой строки'));
    await page.getByRole('textbox').fill('Менеджер по закупкам\nСнабжение\nЛогистика\nСнабжение');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#answer').textContent.includes('Добавить фразы (3)'));
    const before = await f.runtime.telegramService.searchRepository.getSettings({ userId: f.owner });
    assert.deepEqual(before.settings.queries, []);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#answer').textContent.includes('Изменения сохранены'));
    const saved = await f.runtime.telegramService.searchRepository.getSettings({ userId: f.owner });
    assert.deepEqual(saved.settings.queries, ['Менеджер по закупкам','Снабжение','Логистика']);
    const output = path.join(__dirname, '../.superpowers/job-filters'); await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Очистить список', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#answer').textContent.includes('Пока нет фраз'));
    assert.deepEqual((await f.runtime.telegramService.searchRepository.getSettings({ userId: f.owner })).settings.queries, []);
    assert.equal(f.reads, 0); assert.equal(f.modelCalls, 0); assert.equal(f.submits, 0);
    console.log('PC Edge + real Telegram handlers + PostgreSQL: empty filters, multiline preview, save, deduplication and clear passed.');
  } finally { await engine.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
