const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { UUID } = require('./rpcProtocol');
const { createRpcServer } = require('./rpcServer');
const { HhBrowser } = require('./hhBrowser');
const { allowedRequest } = require('./networkPolicy');
const { ApplicationLedger } = require('./applicationLedger');
const { HhApplicationDriver } = require('./hhApplicationDriver');
const { GuardedSubmission } = require('./guardedSubmission');
const { CaptchaJournal } = require('./captchaJournal');
const { CaptchaRecovery } = require('./captchaRecovery');
const { ManualState, assertInactiveWhenDisabled } = require('./manualState');
const { ManualCoordinator } = require('./manualCoordinator');
const { CaptchaTelegramBrowser } = require('./captchaTelegramBrowser');
const { createCaptchaBroker } = require('./captchaBroker');
const { randomUUID, createHash } = require('node:crypto');
const { BrowserHealth, bounded } = require('./browserHealth');
const { CaptchaAutomatic } = require('./captchaAutomatic');
const { recognizeFrozenPng } = require('./ocrClient');

async function handoverCaptcha({ journal, manual, ownerId, target, error, now = Date.now }) {
  let state = await journal.read();
  const seedRequired = Boolean(state && state.phase !== 'resolved' && !state.challengeHash && ['attempted', 'blocked'].includes(state.phase));
  if (!state || state.phase === 'resolved') {
    const detectedAt = now();
    state = await journal.write({ version: 1, ownerId, operationId: randomUUID(), phase: 'blocked', detectedAt,
      retryAt: detectedAt + 120000, targetHash: createHash('sha256').update(target).digest('hex') });
  }
  if (state.targetHash !== createHash('sha256').update(target).digest('hex')) throw new Error('JOB_MANUAL_STATE_DENIED');
  if (error.recoveryId && error.recoveryId !== state.operationId) throw new Error('JOB_MANUAL_STATE_DENIED');
  await manual.pending({ target, recoveryId: state.operationId, claims: state.challengeHash ? [state.challengeHash] : [], seedRequired });
  return state.operationId;
}

async function startBrowser(env = process.env, { onFatal = () => {} } = {}) {
  const ownerId = env.JARVIS_JOB_BROWSER_OWNER_ID, token = env.JARVIS_JOB_BROWSER_TOKEN;
  if (env.JARVIS_JOB_BROWSER_ENABLED !== '1' || process.platform !== 'linux' || process.getuid() === 0
    || !UUID.test(ownerId || '') || !/^[\x21-\x7e]{32,256}$/.test(token || '')) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  const applyEnabled = env.JARVIS_JOB_BROWSER_APPLY_ENABLED === '1';
  const applyToken = applyEnabled ? env.JARVIS_JOB_BROWSER_APPLY_TOKEN : null;
  if (applyEnabled && (!/^[\x21-\x7e]{32,256}$/.test(applyToken || '') || applyToken === token)) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  await fs.access('/.dockerenv');
  const root = '/home/pwuser/profile', owner = await fs.lstat(root);
  if (!owner.isDirectory() || owner.uid !== process.getuid() || (owner.mode & 0o077)) throw new Error('JOB_BROWSER_PROFILE_OWNER_DENIED');
  const binding = `${root}/jarvis-owner.json`;
  try { await fs.writeFile(binding, JSON.stringify({ ownerId }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(binding);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 512) throw new Error('JOB_BROWSER_PROFILE_OWNER_DENIED');
  if (JSON.parse(await fs.readFile(binding, 'utf8')).ownerId !== ownerId) throw new Error('JOB_BROWSER_PROFILE_OWNER_DENIED');
  let primaryResumeId = null;
  try {
    const file = `${root}/jarvis-primary-resume.json`, state = await fs.lstat(file);
    if (!state.isFile() || state.uid !== process.getuid() || (state.mode & 0o077) || state.size > 2048) throw new Error('JOB_BROWSER_PROFILE_OWNER_DENIED');
    primaryResumeId = JSON.parse(await fs.readFile(file, 'utf8')).id;
    if (!/^[a-zA-Z0-9]{1,100}$/.test(primaryResumeId || '')) throw new Error('JOB_BROWSER_PROFILE_OWNER_DENIED');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (env.JARVIS_HH_CAPTCHA_TELEGRAM !== undefined && !['0', '1'].includes(env.JARVIS_HH_CAPTCHA_TELEGRAM)) throw new Error('JOB_CAPTCHA_CONFIG_INVALID');
  const manualEnabled = env.JARVIS_HH_CAPTCHA_TELEGRAM === '1', manualToken = env.JARVIS_JOB_CAPTCHA_TOKEN;
  if (env.JARVIS_HH_CAPTCHA_AUTOMATIC !== undefined && !['0', '1'].includes(env.JARVIS_HH_CAPTCHA_AUTOMATIC)) throw new Error('JOB_CAPTCHA_CONFIG_INVALID');
  const automaticEnabled = env.JARVIS_HH_CAPTCHA_AUTOMATIC === '1';
  if (automaticEnabled && !manualEnabled) throw new Error('JOB_CAPTCHA_CONFIG_INVALID');
  if (manualEnabled && (!/^[\x21-\x7e]{32,256}$/.test(manualToken || '') || manualToken === token || manualToken === applyToken)) throw new Error('JOB_MANUAL_CONFIG_INVALID');
  if (!manualEnabled) await assertInactiveWhenDisabled({ root: `${root}/manual-recovery`, ownerId });
  let context, server, manual, manualPage, broker, health;
  try {
    context = await chromium.launchPersistentContext(root, { headless: true, chromiumSandbox: true,
      acceptDownloads: false, serviceWorkers: 'block', locale: 'ru-RU' });
    health = new BrowserHealth({ context, onFatal });
    // Includes popups and frames. Only the guarded driver can permit its exact POST.
    await context.route('**/*', async (route) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return allowedRequest(route.request().url()) ? route.continue() : route.abort();
      try { if (manualPage && await manualPage.permit(route)) return; } catch {}
      return route.abort();
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    if (env.JARVIS_HH_CAPTCHA_RECOVERY !== undefined && !['0', '1'].includes(env.JARVIS_HH_CAPTCHA_RECOVERY)) throw new Error('JOB_BROWSER_CONFIG_INVALID');
    const journal = env.JARVIS_HH_CAPTCHA_RECOVERY === '1' || manualEnabled
      ? new CaptchaJournal({ root: `${root}/captcha-recovery`, ownerId }) : null;
    // Telegram owns the pause and human handover. Its separate trained-model
    // opt-in runs inside that controller; legacy OCR remains independent.
    const captchaRecovery = !manualEnabled && env.JARVIS_HH_CAPTCHA_RECOVERY === '1' ? new CaptchaRecovery({ journal }) : null;
    if (manualEnabled) {
      manual = new ManualCoordinator({ store: new ManualState({ root: `${root}/manual-recovery`, ownerId }),
        open: (target) => manualPage.open(target), verify: (target, id) => manualPage.verify(target, id) });
      await manual.load();
      manualPage = new CaptchaTelegramBrowser({ context, coordinator: manual, journal, onUnhealthy: () => health.fail() });
      if (automaticEnabled) manualPage.automatic = new CaptchaAutomatic({ coordinator: manual, recognize: recognizeFrozenPng });
    }
    const onManualRequired = manual && ((target, error) => handoverCaptcha({ journal, manual, ownerId, target, error }));
    const browser = new HhBrowser({ context, primaryResumeId, captchaRecovery, manualCoordinator: manual, onManualRequired,
      onTimeout: () => health.fail() });
    let submissions = null;
    if (applyEnabled) {
      if (!primaryResumeId) throw new Error('JOB_BROWSER_CONFIG_INVALID');
      const ledger = new ApplicationLedger({ root: `${root}/applications`, ownerId });
      await ledger.directory();
      const guarded = new GuardedSubmission({ ledger, driver: new HhApplicationDriver({ browser }), ownerId, primaryResumeId });
      submissions = { submit: (input) => browser.run(() => { manual?.assertAutomatic(); return guarded.submit(input); }),
        reconcile: (input) => browser.run(() => { manual?.assertAutomatic(); return guarded.reconcile(input); }) };
    }
    server = createRpcServer({ browser, ownerId, token, submissions, applyToken, health: () => health.check() });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8080, '0.0.0.0', resolve); });
    if (manual) {
      broker = createCaptchaBroker({ coordinator: manual, controller: manualPage, ownerId, token: manualToken,
        run: fn => bounded(() => browser.run(fn), 80000).catch(error => {
          if (error.code === 'JOB_BROWSER_OPERATION_TIMEOUT') health.fail();
          throw error;
        }) });
      await new Promise((resolve, reject) => { broker.once('error', reject); broker.listen(8082, '0.0.0.0', resolve); });
    }
    health.start();
    return { async close() {
      health.close();
      broker?.closeAllConnections();
      if (broker) await new Promise((resolve) => broker.close(resolve));
      await new Promise((resolve) => server.close(resolve)); await browser.tail; await manualPage?.close(); await context.close();
    } };
  } catch (error) { health?.close(); server?.close(); broker?.close(); await manualPage?.close(); await context?.close(); throw error; }
}

if (require.main === module) {
  let runtime;
  startBrowser(process.env, { onFatal: () => {
    process.stderr.write('JOB_BROWSER_UNHEALTHY\n'); process.exit(1);
  } }).then((value) => {
    runtime = value; process.stdout.write('JOB_BROWSER_READY\n');
    const close = () => { runtime.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
  }).catch(() => { process.stderr.write('JOB_BROWSER_START_FAILED\n'); process.exitCode = 1; });
}
module.exports = { startBrowser, handoverCaptcha };
