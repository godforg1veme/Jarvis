const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { allowedRequest } = require('./networkPolicy');
const { classifySession } = require('./pageSignals');

async function verifySession() {
  if (process.env.JARVIS_HH_VERIFY_SESSION !== '1' || process.platform !== 'linux' || process.getuid() === 0) {
    throw new Error('JOB_BROWSER_VERIFY_OPT_IN_REQUIRED');
  }
  await fs.access('/.dockerenv');
  const profile = '/home/pwuser/profile';
  const owner = await fs.stat(profile);
  if (!owner.isDirectory() || owner.uid !== process.getuid() || (owner.mode & 0o077)) throw new Error('JOB_BROWSER_PROFILE_OWNER_DENIED');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, chromiumSandbox: true,
      acceptDownloads: false, serviceWorkers: 'block', locale: 'ru-RU' });
    await context.route('**/*', (route) => allowedRequest(route.request().url()) ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const response = await page.goto('https://hh.ru/applicant/resumes', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const text = await page.locator('body').evaluate((node) => node.innerText.slice(0, 64000));
    const iframeSources = [];
    for (const frame of (await page.locator('iframe').all()).slice(0, 100)) {
      if (!await frame.isVisible()) continue;
      const source = await frame.getAttribute('src');
      if (source) { try { iframeSources.push(new URL(source, page.url()).href); } catch {} }
    }
    return { httpStatus: response?.status() || 0,
      ...classifySession({ status: response?.status() || 0, pathname: new URL(page.url()).pathname, text, iframeSources }) };
  } finally { await context?.close(); }
}
if (require.main === module) verifySession().then((result) => console.log(JSON.stringify(result))).catch(() => {
  console.log(JSON.stringify({ failureCode: 'JOB_BROWSER_VERIFY_FAILED' })); process.exitCode = 1;
});
module.exports = { verifySession };
