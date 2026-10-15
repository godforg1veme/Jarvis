const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { UUID } = require('./rpcProtocol');
const { createRpcServer } = require('./rpcServer');
const { HhBrowser } = require('./hhBrowser');
const { allowedRequest } = require('./networkPolicy');

async function startBrowser(env = process.env) {
  const ownerId = env.JARVIS_JOB_BROWSER_OWNER_ID, token = env.JARVIS_JOB_BROWSER_TOKEN;
  if (env.JARVIS_JOB_BROWSER_ENABLED !== '1' || process.platform !== 'linux' || process.getuid() === 0
    || !UUID.test(ownerId || '') || !/^[\x21-\x7e]{32,256}$/.test(token || '')) throw new Error('JOB_BROWSER_CONFIG_INVALID');
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
  let context, server;
  try {
    context = await chromium.launchPersistentContext(root, { headless: true, chromiumSandbox: true,
      acceptDownloads: false, serviceWorkers: 'block', locale: 'ru-RU' });
    // Includes popups and frames. Read service exposes no mutation operation.
    await context.route('**/*', (route) => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      && allowedRequest(route.request().url()) ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const browser = new HhBrowser({ context, primaryResumeId });
    server = createRpcServer({ browser, ownerId, token });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8080, '0.0.0.0', resolve); });
    return { async close() {
      await new Promise((resolve) => server.close(resolve)); await browser.tail; await context.close();
    } };
  } catch (error) { server?.close(); await context?.close(); throw error; }
}

if (require.main === module) {
  let runtime;
  startBrowser().then((value) => {
    runtime = value; process.stdout.write('JOB_BROWSER_READY\n');
    const close = () => { runtime.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
  }).catch(() => { process.stderr.write('JOB_BROWSER_START_FAILED\n'); process.exitCode = 1; });
}
module.exports = { startBrowser };
