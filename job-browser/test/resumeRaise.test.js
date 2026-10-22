const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {validRaiseRequest,INTERVAL}=require('../src/resumeRaiseProtocol');
const {raiseResume}=require('../src/resumeRaise');
const {ResumeRaiseLedger}=require('../src/resumeRaiseLedger');
const {createRpcServer}=require('../src/rpcServer');
const {once}=require('node:events');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const userId=randomUUID(),resumeId='fixtureResume';
test('resume raise permits only the native single-resume empty-side-effect contract and matching CSRF',()=>{
  const input={url:'https://hh.ru/applicant/resumes/touch',method:'POST',resourceType:'xhr',
    contentType:'application/x-www-form-urlencoded',body:Buffer.from('resume=fixtureResume&undirectable=true&fingerprintSp=fixture'),csrfToken:'fixture'};
  assert.equal(validRaiseRequest(input,resumeId,'_xsrf=fixture'),true);
  for(const patch of [{url:'https://hh.ru/applicant/resumes/touch?resume=other'},{url:'https://evil.test/applicant/resumes/touch'},
    {method:'PUT'},{resourceType:'document'},{csrfToken:'other'},{body:Buffer.from('resume=other&undirectable=true')},
    {body:Buffer.from('resume=fixtureResume&undirectable=true&accessType=everyone')},
    {body:Buffer.from('resume=fixtureResume&resume=other&undirectable=true')}])assert.equal(validRaiseRequest({...input,...patch},resumeId,'_xsrf=fixture'),false);
});
test('raise capability cannot read profiles, send applications or select a primary resume',async()=>{
  let count=0;const token='r'.repeat(32),resumeToken='u'.repeat(32),connectToken='c'.repeat(32);
  const server=createRpcServer({ownerId:userId,token,resumeToken,connectToken,
    profiles:{async forUser(){return{async raiseResume(){count++;return{outcome:'raised',verified:true};},browser:{async listResumes(){return[];}}};}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const post=(credential,operation,args)=>fetch(`http://127.0.0.1:${server.address().port}/rpc`,{method:'POST',headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},body:JSON.stringify({userId,operation,args})});
  try {
    const args={resumeId,operationId:randomUUID()};assert.equal((await post(token,'raise_resume',args)).status,403);
    assert.equal((await post(connectToken,'raise_resume',args)).status,403);
    assert.equal((await post(resumeToken,'resumes',{})).status,403);
    assert.equal((await post(resumeToken,'select_resume',{resumeId})).status,403);
    assert.equal((await post(resumeToken,'raise_resume',args)).status,200);assert.equal(count,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('durable resume raise intent survives restart and prevents new IDs after uncertainty or within four hours',
  {skip:process.platform!=='linux'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'resume-raise-'));await fs.chmod(root,0o700);let now=Date.now();
  try {
    const options={root,ownerId:userId,now:()=>now},op={userId,resumeId,operationId:randomUUID()};
    let ledger=new ResumeRaiseLedger(options);assert.equal((await ledger.lookup(op)).outcome,'unknown');assert.equal((await ledger.reserve(op)).execute,true);
    ledger=new ResumeRaiseLedger(options);assert.equal((await ledger.reserve(op)).outcome,'unknown');
    assert.equal((await ledger.reserve({...op,operationId:randomUUID()})).outcome,'unknown');
    await ledger.finish(op,'raised');assert.equal((await ledger.reserve(op)).outcome,'raised');
    assert.equal((await ledger.reserve({...op,operationId:randomUUID()})).outcome,'not_due');
    now+=INTERVAL+1;assert.equal((await ledger.reserve({...op,operationId:randomUUID()})).execute,true);
    await assert.rejects(ledger.reserve({...op,resumeId:'other'}));
    const crash=new ResumeRaiseLedger({...options,root:path.join(root,'crash')});
    crash.store.write=async()=>{throw Error('Fixture crash after durable per-resume intent');};
    await assert.rejects(crash.reserve({...op,operationId:randomUUID()}));
    assert.equal((await new ResumeRaiseLedger({...options,root:path.join(root,'crash')}).reserve({...op,operationId:randomUUID()})).outcome,'unknown');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('real browser raises only the selected card, proves the server cooldown and never repeats the operation',async()=>{
  const engine=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await engine.newContext();let disabled=false,fetches=0,claims=0,finished,responseStatus=200;
  await context.addCookies([{name:'_xsrf',value:'fixture',domain:'hh.ru',path:'/'}]);
  const html=()=>`<meta charset="utf-8"><h1>Мои резюме</h1><div data-qa="resume"><a href="https://hh.ru/resume/fixtureResume" data-qa="resume-title">Fixture resume</a><button data-qa="resume-update-button resume-update-button_actions" ${disabled?'disabled':''} onclick="const f=new FormData();f.append('resume','fixtureResume');f.append('undirectable','true');fetch('/applicant/resumes/touch',{method:'POST',headers:{'x-xsrftoken':'fixture'},body:f})">Поднять в поиске</button></div>`;
  await context.route('**/*',route=>route.request().method()==='GET'?route.fulfill({status:200,contentType:'text/html',body:html()}):route.abort());
  const browser={primaryResumeId:resumeId,async open(){const page=await context.newPage();await page.goto('https://hh.ru/applicant/resumes');
    const original=page.route.bind(page);page.route=(pattern,handler)=>original(pattern,async route=>{
      route.fetch=async options=>{assert.deepEqual(options,{maxRedirects:0,maxRetries:0,timeout:15000});fetches++;disabled=true;
        return{status:()=>responseStatus,headers:()=>({'content-type':'application/json'}),body:async()=>Buffer.from('{}'),async dispose(){}};};
      return handler(route);
    });return{page};}};
  const ledger={async reserve(){claims++;return finished?{execute:false,...finished}:{execute:true};},async finish(_input,outcome){finished={outcome,verified:true};return finished;}};
  const input={browser,ledger,userId,operationId:randomUUID(),resumeId,receiptTimeoutMs:1000};
  try {
    assert.equal((await raiseResume(input)).outcome,'raised');assert.equal(fetches,1);
    assert.equal((await raiseResume(input)).outcome,'raised');assert.equal(fetches,1);assert.equal(claims,2);
    assert.equal((await raiseResume({...input,resumeId:'other'})).outcome,'ineligible');assert.equal(fetches,1);
    disabled=false;finished=null;responseStatus=307;
    const redirectInput={...input,operationId:randomUUID()};assert.equal((await raiseResume(redirectInput)).outcome,'unknown');
    assert.equal(fetches,2);assert.equal((await raiseResume(redirectInput)).outcome,'unknown');assert.equal(fetches,2);
  }finally{await engine.close();}
});
