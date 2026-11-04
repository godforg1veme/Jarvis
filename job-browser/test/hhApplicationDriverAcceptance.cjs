// Full browser driver against HH-shaped fixtures. No live account or HH request is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { HhBrowser } = require('../src/hhBrowser');
const { HhApplicationDriver } = require('../src/hhApplicationDriver');
const { ApplicationLedger } = require('../src/applicationLedger');
const { GuardedSubmission } = require('../src/guardedSubmission');
const { installApplicationFixture } = require('./helpers/hhApplicationFixture');

test('native multiple-choice form dispatches only the exact selected option set',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-multiple-driver-'));await fs.chmod(root,0o700);
  const ownerId=randomUUID(),resumeId='fixtureResume';let browser,context;
  try{
    browser=await chromium.launch({headless:true,chromiumSandbox:true});
    context=await browser.newContext({serviceWorkers:'block'});
    const fixture=await installApplicationFixture(context,{resumeId,nativeTestId:'127',nativeMultiple:true});
    const hh=new HhBrowser({context,primaryResumeId:resumeId});
    const inspected=await hh.inspect({externalId:'127',resumeId});
    assert.equal(inspected.questionnaire.questions[0].type,'multiple');
    const driver=new HhApplicationDriver({browser:hh,dispatch:route=>route.fallback(),responseTimeoutMs:500});
    const guarded=new GuardedSubmission({ownerId,primaryResumeId:resumeId,driver,ledger:new ApplicationLedger({root,ownerId})});
    const input={userId:ownerId,operationId:randomUUID(),externalId:'127',resumeId,letter:'Точное письмо.',
      questionnaire:inspected.questionnaire,answers:[{id:'task_7',value:['13','11']},{id:'task_8_text',value:'Проверка ограничений.'}]};
    assert.deepEqual(await hh.run(()=>guarded.submit(input)),{outcome:'sent',verified:true,externalId:'446'});
    assert.equal(fixture.posts,1);assert.deepEqual(fixture.lastFields.get('task_7'),['11','13']);
    await assert.rejects(hh.run(()=>guarded.submit({...input,answers:[{id:'task_7',value:['12']},input.answers[1]]})),
      {code:'JOB_BROWSER_OPERATION_CHANGED'});
    assert.equal(fixture.posts,1);
  }finally{await context?.close();await browser?.close();await fs.rm(root,{recursive:true,force:true});}
});

test('actual driver + Chromium + Linux journal: native request/receipt, lost ack, restart and visibility guard', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-driver-')); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), resumeId = 'fixtureResume';
  let browser, context;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    const fixture = await installApplicationFixture(context, { resumeId });
    const hh = new HhBrowser({ context, primaryResumeId: resumeId });
    // The fixture transport fulfills the validated request instead of going to the internet.
    const driver = new HhApplicationDriver({ browser: hh, dispatch: (route) => route.fallback(), responseTimeoutMs: 500 });
    const create = () => new GuardedSubmission({ ownerId, primaryResumeId: resumeId, driver, ledger: new ApplicationLedger({ root, ownerId }) });
    const first = { userId: ownerId, operationId: randomUUID(), externalId: '123', resumeId, letter: 'Одобренный текст\nAI & автоматизация.' };
    const send = (input) => hh.run(() => create().submit(input));
    assert.deepEqual(await send(first), { outcome: 'sent', verified: true, externalId: '444' }); assert.equal(fixture.posts, 1);
    assert.equal((await send(first)).outcome, 'sent'); assert.equal(fixture.posts, 1);
    fixture.loseAcknowledgement = true;
    const second = { ...first, operationId: randomUUID(), externalId: '124' };
    assert.deepEqual(await send(second), { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_TIMEOUT' }); assert.equal(fixture.posts, 2);
    assert.equal((await send(second)).outcome, 'unknown'); assert.equal(fixture.posts, 2);
    assert.deepEqual(await hh.run(() => create().reconcile(second)), { outcome: 'unknown' }); assert.equal(fixture.posts, 2);
    assert.ok(fixture.chatRequests > 0, 'negative recovery actually reads the HH-shaped chat source');
    fixture.wrongRecoveredLetter = false;
    assert.deepEqual(await hh.run(() => create().reconcile(second)), { outcome: 'sent', verified: true, externalId: '445' }); assert.equal(fixture.posts, 2);
    fixture.loseAcknowledgement = false; fixture.changeCountryVisibility = true;
    assert.equal((await send({ ...first, operationId: randomUUID(), externalId: '125' })).outcome, 'manual_required'); assert.equal(fixture.posts, 2);
  } finally { await context?.close(); await browser?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('HH test route: inspect stable native questions, fill exact answers, validate one outgoing POST and receipt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-native-test-')); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), resumeId = 'fixtureResume';
  let browser, context;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    const fixture = await installApplicationFixture(context, { resumeId, nativeTestId: '126' });
    const hh = new HhBrowser({ context, primaryResumeId: resumeId });
    const inspected = await hh.inspect({ externalId: '126', resumeId });
    assert.equal(inspected.reasonCode, 'JOB_HH_QUESTIONS_REQUIRED');
    assert.deepEqual(inspected.questionnaire.questions.map(q => q.id), ['task_7', 'task_8_text']);
    const driver = new HhApplicationDriver({ browser: hh, dispatch: route => route.fallback(), responseTimeoutMs: 500 });
    const submission = new GuardedSubmission({ ownerId, primaryResumeId: resumeId, driver,
      ledger: new ApplicationLedger({ root, ownerId }) });
    const input = { userId: ownerId, operationId: randomUUID(), externalId: '126', resumeId,
      letter: 'Точное письмо', questionnaire: inspected.questionnaire,
      answers: [{ id: 'task_7', value: '12' }, { id: 'task_8_text', value: 'Применю проверенный подход.' }] };
    const result = await hh.run(() => submission.submit(input));
    assert.deepEqual(result, { outcome: 'sent', verified: true, externalId: '446' });
    assert.equal(fixture.posts, 1);
    assert.equal(fixture.lastFields.get('task_7'), '12');
    assert.equal(fixture.lastFields.get('task_8_text'), 'Применю проверенный подход.');
  } finally { await context?.close(); await browser?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
