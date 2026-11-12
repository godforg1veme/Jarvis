const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('../job-browser/node_modules/playwright');

async function run() {
  const root = path.resolve(__dirname, '..');
  const packageRoot = process.env.JARVIS_DESKTOP_TEST_ROOT || root;
  const output = path.join(root, 'build', 'desktop-native');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  const launcher = path.join(output, 'launcher.cjs');
  // Only OS integration/network adapters are replaced. The real application
  // main, preload, IPC, durable journals and renderer are executed unchanged.
  fs.writeFileSync(launcher, `
const {app,globalShortcut}=require('electron');
const path=require('node:path'); const crypto=require('node:crypto');
const fs=require('node:fs');
const root=${JSON.stringify(packageRoot)};
app.setPath('userData',${JSON.stringify(profile)});
const report=(error)=>{fs.writeFileSync(${JSON.stringify(path.join(output, 'main-error.txt'))},String(error?.stack||error));app.exit(1);};
process.on('uncaughtException',report);process.on('unhandledRejection',report);
app.setLoginItemSettings=()=>{}; globalShortcut.register=()=>false;
require(path.join(root,'tools/loadEnv')).loadEnvFile=()=>{};
const runtimeData=require(path.join(root,'runtimeDataPath'));
runtimeData.getWritableDataPath=(file)=>path.join(${JSON.stringify(profile)},'data',path.relative(path.join(root,'data'),file));
const token=crypto.randomBytes(32).toString('base64url');
const uid='11111111-1111-4111-8111-111111111111',did='22222222-2222-4222-8222-222222222222';
let records=[]; const operations=new Map();
const ok=(body)=>Promise.resolve(new Response(JSON.stringify({ok:true,...body}),{headers:{'content-type':'application/json'}}));
require(path.join(root,'cloud/secureCloudTransport')).createSecureCloudTransport=()=>({
  WebSocket:class{constructor(){throw new Error('Fixture has no realtime connection');}},
  close:async()=>{},
  fetch:async(url,options={})=>{
    const p=new URL(url).pathname;
    if(p==='/v1/desktop/pair')return ok({device:{id:did,name:'Test PC'},token});
    if(options.headers?.Authorization!=='Bearer '+token)return new Response(JSON.stringify({ok:false,code:'DEVICE_AUTH_REQUIRED'}),{status:401});
    if(p.endsWith('/workspace/me'))return ok({actor:{userId:uid,telegramId:'101',level:'member',permissions:['assistant','memory','documents','devices','jobs','life','vpn']}});
    if(p.endsWith('/workspace/desktop/messages'))return ok({messages:[],paging:{nextCursor:null}});
    if(p.endsWith('/workspace/sections/memory'))return ok({items:records,memoryActionsAvailable:true,paging:{nextCursor:null}});
    if(p.endsWith('/workspace/memory/operations')&&options.method==='POST'){
      const input=JSON.parse(options.body);let result=operations.get(input.operationId);
      if(!result){const id=crypto.randomUUID();records.push({id,title:input.content,expectedDigest:crypto.createHash('sha256').update(input.content).digest('hex')});result={status:'completed',memoryId:id};operations.set(input.operationId,result);}
      return ok(result);
    }
    return new Response(JSON.stringify({ok:false,code:'unavailable'}),{status:503});
  }
});
// Native state is isolated; no microphone/camera, OS tool or real remote endpoint
// is used by these test actions.
require(path.join(root,'main.js'));
`, 'utf8');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: require('electron'), args: [launcher], env, timeout: 30000 });
  try {
    await instance.firstWindow();
    let page;
    const deadline = Date.now() + 30000;
    while (!page && Date.now() < deadline) {
      page = instance.windows().find((window) => /cloud-chat\/index.html/.test(window.url()));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(page, 'the cloud chat window must load (the companion widget may open first)');
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => typeof window.jarvisCloud?.getWorkspacePending === 'function');
    assert.equal((await page.evaluate(() => window.jarvisCloud.getState())).paired, false);
    await page.locator('#server-url').fill('https://fixture.example.test');
    await page.locator('#pairing-code').fill('JARVIS-AAAA-BBBB-CCCC-DDDD');
    await page.locator('#pair-button').click();
    await page.waitForFunction(() => document.getElementById('pairing-card').classList.contains('is-hidden'));
    await page.locator('[data-desktop-page="memory"]').click();
    await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
    await page.locator('#memory-content').fill('Native test memory');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    assert.equal(await page.getByText('Будет сохранено: Native test memory', { exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.locator('.section-card__title').filter({ hasText: 'Native test memory' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.jarvisCloud.getWorkspacePending()), { ok: true, pending: [] });
    const denied = await page.evaluate(() => window.jarvisCloud.workspaceRequest('/jobs/login/claim', 'POST', {}));
    assert.equal(denied.ok, false);
    assert.equal((await page.evaluate(() => window.jarvisCloud.getVisionState())).state.state, 'off');
    assert.equal((await page.evaluate(() => window.jarvisCloud.getVoiceState())).enabled, false);
    await page.screenshot({ path: path.join(output, 'memory-native.png') });
    await page.locator('[data-desktop-page="settings"]').click();
    await page.getByRole('button', { name: 'Настроить голос', exact: true }).click();
    await page.getByLabel('Подавление шума', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByText('Сохранено.', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.jarvisCloud.openVoiceSettings())).settings.noiseSuppression, false);
    assert.equal((await page.evaluate(() => window.jarvisCloud.getVoiceState())).enabled, false);
    assert.deepEqual(errors, []);
    console.log('Native Electron main/preload/IPC/renderer acceptance passed: isolated pairing, memory preview/commit, journal settlement, denied guest path, saved capture settings, voice/vision remain off.');
  } finally { await instance.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
