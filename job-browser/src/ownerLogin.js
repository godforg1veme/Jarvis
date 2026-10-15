const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { createLoopbackRelay } = require('./loopbackRelay');
const { allowedRequest } = require('./networkPolicy');

async function ownerLogin() {
  if (process.env.JARVIS_HH_OWNER_LOGIN !== '1') throw new Error('JOB_BROWSER_LOGIN_OPT_IN_REQUIRED');
  if (process.platform !== 'linux' || process.getuid() === 0) throw new Error('JOB_BROWSER_LOGIN_CONTAINER_REQUIRED');
  await fs.access('/.dockerenv');
  const profile = '/home/pwuser/profile';
  await fs.mkdir(profile, { recursive: true, mode: 0o700 }); await fs.chmod(profile, 0o700);
  let context, relay, timer;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, chromiumSandbox: true,
      acceptDownloads: false, serviceWorkers: 'block', locale: 'ru-RU', args: ['--remote-debugging-port=9222'] });
    await context.route('**/*', (route) => allowedRequest(route.request().url()) ? route.continue() : route.abort());
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://hh.ru/account/login?role=applicant', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const version = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(5000) });
    if (!version.ok) throw new Error('JOB_BROWSER_CDP_UNAVAILABLE'); await version.body.cancel();
    relay = await createLoopbackRelay({ bind: '0.0.0.0', port: 9223, targetPort: 9222 });
    console.log(JSON.stringify({ state: 'owner_login_ready', ttlSeconds: 1800 }));
    await new Promise((resolve) => {
      timer = setTimeout(resolve, 1800000);
      process.once('SIGTERM', resolve); process.once('SIGINT', resolve); context.once('close', resolve);
    });
  } finally {
    clearTimeout(timer); await relay?.close(); await context?.close();
    console.log(JSON.stringify({ state: 'owner_login_closed' }));
  }
}
if (require.main === module) ownerLogin().catch(() => {
  console.log(JSON.stringify({ failureCode: 'JOB_BROWSER_OWNER_LOGIN_FAILED' })); process.exitCode = 1;
});
module.exports = { ownerLogin };
