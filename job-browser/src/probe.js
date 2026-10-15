const { chromium } = require('playwright');
const { classifyPage } = require('./pageSignals');
const { allowedRequest } = require('./networkPolicy');
async function inspect(page, response) {
  const text = await page.locator('body').evaluate((node) => node.innerText.slice(0, 64000));
  const iframeSources = [];
  for (const frame of await page.locator('iframe').all()) {
    if (await frame.isVisible()) {
      const src = await frame.getAttribute('src');
      if (src) { try { iframeSources.push(new URL(src, page.url()).href); } catch {} }
    }
    if (iframeSources.length >= 100) break;
  }
  const links = await page.locator('a[href*="/vacancy/"]').evaluateAll((nodes) => [...new Set(nodes.map((node) => {
    try { const url = new URL(node.href); return url.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'))
      && /^\/vacancy\/\d+$/.test(url.pathname) ? `https://hh.ru${url.pathname}` : null; } catch { return null; }
  }).filter(Boolean))].slice(0, 1000));
  const pathname = new URL(page.url()).pathname;
  const vacancyContent = await page.locator('[data-qa="vacancy-description"]').count() > 0;
  const result = classifyPage({ status: response?.status() || 0, pathname, text, iframeSources, vacancyLinks: links.length, vacancyContent });
  if (result.state === 'login_required') {
    result.loginMethods = [];
    if (/телефон|phone/iu.test(text)) result.loginMethods.push('phone_offered');
    if (/электронн[а-яё ]+почт|email|e-mail/iu.test(text)) result.loginMethods.push('email_offered');
    if (/получить код|ввести код|send.{0,12}code/iu.test(text)) result.loginMethods.push('code_offered');
    if (await page.locator('input[type="password"]').count() > 0) result.loginMethods.push('password_field');
    result.inputCount = Math.min(await page.locator('input:visible').count(), 100);
  }
  return { result, firstVacancy: links[0] || null };
}
async function probe() {
  if (process.env.JARVIS_HH_BROWSER_PROBE !== '1') throw new Error('JOB_BROWSER_OPT_IN_REQUIRED');
  let browser;
  const report = { steps: [], sandboxRequired: true, authenticated: false };
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', locale: 'ru-RU' });
    let blockedRequests = 0;
    await context.route('**/*', (route) => allowedRequest(route.request().url()) ? route.continue() : (blockedRequests++, route.abort()));
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    async function visit(kind, url) {
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const observation = await inspect(page, response);
        report.steps.push({ kind, httpStatus: response?.status() || 0, ...observation.result });
        return observation;
      } catch {
        report.steps.push({ kind, state: 'unknown', failureCode: 'JOB_BROWSER_NAVIGATION_FAILED' }); return null;
      }
    }
    const search = await visit('search', 'https://hh.ru/search/vacancy?text=AI+Engineer&area=1&search_period=14');
    const stopped = (value) => !value || ['captcha', 'rate_limited', 'access_denied', 'unknown'].includes(value.result.state);
    if (!stopped(search)) {
      const vacancy = search.firstVacancy ? await visit('vacancy', search.firstVacancy) : null;
      if (!vacancy || !stopped(vacancy)) await visit('login', 'https://hh.ru/account/login?role=applicant');
    }
    report.blockedRequests = blockedRequests;
    return report;
  } catch (error) {
    const sandbox = /sandbox|namespace|operation not permitted/iu.test(error.message || '');
    return { ...report, failureCode: sandbox ? 'JOB_BROWSER_SANDBOX_UNAVAILABLE' : 'JOB_BROWSER_LAUNCH_FAILED' };
  } finally { await browser?.close(); }
}
if (require.main === module) probe().then((result) => { console.log(JSON.stringify(result));
  if (result.failureCode) process.exitCode = 1;
}).catch(() => { console.log(JSON.stringify({ failureCode: 'JOB_BROWSER_PROBE_FAILED' })); process.exitCode = 1; });
module.exports = { allowedRequest, probe };
