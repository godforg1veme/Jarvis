const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readLoginInputFields } = require('../src/loginInputFields');

test('HH frame exposes bounded keyboard geometry without field content or DOM identifiers', async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL || process.platform === 'win32'
      ? { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.phone{position:absolute;left:100px;top:120px;width:300px;height:44px}</style>
      <input class="phone" id="private-id" name="private-name" value="private-value" type="tel" inputmode="tel">
      <input type="hidden" value="hidden-value"><input style="visibility:hidden"><input style="opacity:0">
      <textarea style="position:absolute;left:300px;top:220px">secret</textarea>`);
    const fields = await readLoginInputFields(page);
    assert.equal(fields.length, 2);
    assert.deepEqual(fields[0], { x: 100, y: 120, width: 300, height: 44,
      type: 'tel', inputMode: 'tel', multiline: false });
    assert.equal(fields[1].multiline, true);
    assert.equal(JSON.stringify(fields).includes('private'), false);
    assert.equal(JSON.stringify(fields).includes('secret'), false);
  } finally { await browser.close(); }
});
