const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { dispatchApplication } = require('../src/applicationDispatch');
const { HhBrowser } = require('../src/hhBrowser');
const { HhApplicationDriver } = require('../src/hhApplicationDriver');
const { GuardedSubmission } = require('../src/guardedSubmission');
const { ApplicationLedger } = require('../src/applicationLedger');
const { installApplicationFixture } = require('./helpers/hhApplicationFixture');
const { randomUUID } = require('node:crypto');
const { parseFields } = require('../src/submissionProtocol');

test('real HTTPS application dispatch retains original receipt and cookies, never follows redirect or retries lost response', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-transport-'));
  let server, browser;
  try {
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(root,'key'),
      '-out',path.join(root,'cert'),'-subj','/CN=hh.ru','-days','1'], { stdio: 'ignore' });
    let posts = 0, forwarded = 0, mode = 'success';
    const input = { externalId: '123', resumeId: 'fixtureResume', letter: 'Approved text' };
    const receipt = { topic_id: 444, chat_id: 555, responseStatus: {
      resumes: { 222: { id: 222, hash: input.resumeId } }, usedResumeIds: [222],
      negotiations: { topicList: [{ id: 444, vacancyId: 123, resumeId: 222, chatId: 555 }] } } };
    server = https.createServer({ key: await fs.readFile(path.join(root,'key')), cert: await fs.readFile(path.join(root,'cert')) }, async (req,res) => {
      if (req.url !== '/applicant/vacancy_response/popup') { forwarded++; res.end('unexpected'); return; }
      posts++; const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      assert.equal(parseFields({contentType:req.headers['content-type'],body:Buffer.concat(chunks)}).get('letter'),input.letter);
      if (mode === 'drop') { req.socket.destroy(); return; }
      if (mode === 'redirect') { res.writeHead(307,{location:'https://hh.ru/forbidden'});res.end();return; }
      res.writeHead(200,{'content-type':'application/json','set-cookie':'fixture_proof=1; Path=/; Secure'});res.end(JSON.stringify(receipt));
    });
    await new Promise(resolve => server.listen(443,'127.0.0.1',resolve));
    browser = await chromium.launch({headless:true,chromiumSandbox:true});
    const context = await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
    let result;
    await context.route('**/*', async route => {
      if (route.request().method() === 'POST') { result = await dispatchApplication(route,input); return; }
      await route.fulfill({status:200,contentType:'text/html',body:'<html>fixture</html>'});
    });
    const page = await context.newPage();await page.goto('https://hh.ru/');
    const send = async () => {
      result=null;
      await page.evaluate(async input => {
        const body=new URLSearchParams({vacancy_id:input.externalId,resume_hash:input.resumeId,letter:input.letter,
          lux:'true',ignore_postponed:'true',withoutTest:'no',incomplete:'false',mark_applicant_visible_in_vacancy_country:'false',country_ids:'[]'});
        await fetch('/applicant/vacancy_response/popup',{method:'POST',body}).catch(()=>{});
      },input);
      for(let i=0;i<50&&!result;i++) await new Promise(r=>setTimeout(r,10));
      return result;
    };
    assert.deepEqual(await send(),{outcome:'sent',verified:true,externalId:'444'});
    assert.equal(posts,1);assert.equal((await context.cookies()).some(c=>c.name==='fixture_proof'&&c.value==='1'),true);
    mode='redirect';assert.equal((await send()).outcome,'unknown');assert.equal(posts,2);assert.equal(forwarded,0);
    mode='drop';assert.equal((await send()).outcome,'unknown');assert.equal(posts,3);
    mode='success';
    const fixture=await installApplicationFixture(context,{resumeId:input.resumeId});
    const hh=new HhBrowser({context,primaryResumeId:input.resumeId});
    const ownerId=randomUUID();
    const guarded=new GuardedSubmission({ownerId,primaryResumeId:input.resumeId,
      ledger:new ApplicationLedger({root:path.join(root,'ledger'),ownerId}),driver:new HhApplicationDriver({browser:hh})});
    const operation={...input,userId:ownerId,operationId:randomUUID()};
    assert.deepEqual(await hh.run(()=>guarded.submit(operation)),{outcome:'sent',verified:true,externalId:'444'});
    assert.equal(posts,4);assert.equal(fixture.posts,0,'default driver actually uses HTTPS upstream');
    assert.equal((await hh.run(()=>guarded.submit(operation))).outcome,'sent');assert.equal(posts,4);
    await context.close();
  } finally { await browser?.close();server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());await fs.rm(root,{recursive:true,force:true}); }
});
