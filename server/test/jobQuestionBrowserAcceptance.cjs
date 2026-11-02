// Explicit Linux integration. Every HH response and model answer is a fixture.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events'),{randomBytes}=require('node:crypto');
const {chromium}=require('../../job-browser/node_modules/playwright');
const {HhBrowser}=require('../../job-browser/src/hhBrowser');
const {HhApplicationDriver}=require('../../job-browser/src/hhApplicationDriver');
const {ApplicationLedger}=require('../../job-browser/src/applicationLedger');
const {GuardedSubmission}=require('../../job-browser/src/guardedSubmission');
const {createRpcServer}=require('../../job-browser/src/rpcServer');
const {installApplicationFixture}=require('../../job-browser/test/helpers/hhApplicationFixture');
const {createJobPostgresFixture}=require('./helpers/jobPostgresFixture');
const {configuredOwnerJobAccess}=require('../src/jobs/configuredOwnerJobAccess');
const {JobSearchRepository}=require('../src/jobs/jobSearchRepository');
const {JobProfileRepository}=require('../src/jobs/jobProfileRepository');
const {JobDraftRepository}=require('../src/jobs/jobDraftRepository');
const {JobAutomationRepository}=require('../src/jobs/jobAutomationRepository');
const {JobApplicationRepository}=require('../src/jobs/jobApplicationRepository');
const {JobApplicationService}=require('../src/jobs/jobApplicationService');
const {JobQuestionAnswerService}=require('../src/jobs/jobQuestionAnswerService');
const {JobBrowserClient}=require('../src/jobs/jobBrowserClient');
const {JobUsageRepository}=require('../src/jobs/jobUsageRepository');

test('real PG + answer service + scoped RPC + native Chromium form persist and send exact answers once',async()=>{
  const f=await createJobPostgresFixture();
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-native-questions-'));
  await fs.chmod(root,0o700);
  let browser,context,rpc;
  try{
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')",[f.owner]);
    const accessService=configuredOwnerJobAccess(f.pool,'101');
    const search=new JobSearchRepository(f.pool,{accessService}),profiles=new JobProfileRepository(f.pool,{accessService});
    const drafts=new JobDraftRepository(f.pool,{accessService}),automation=new JobAutomationRepository(f.pool,{accessService});
    const resumeId='fixtureResume';
    browser=await chromium.launch({headless:true,chromiumSandbox:true});
    context=await browser.newContext({serviceWorkers:'block'});
    const fixture=await installApplicationFixture(context,{resumeId,nativeTestId:'126',nativeQuestionLabel:'Что такое валидация?',async onPost(){
      const row=(await f.pool.query("SELECT * FROM job_applications WHERE user_id=$1 AND status='sending'",[f.owner])).rows[0];
      assert.ok(row,'durable intent exists before the browser dispatches');
      assert.equal(row.questionnaire.native.uidPk,'42');
      assert.equal(row.questionnaire_answers.length,2);
    }});
    const hh=new HhBrowser({context,primaryResumeId:resumeId});
    const token=randomBytes(32).toString('hex'),applyToken=randomBytes(32).toString('hex');
    const driver=new HhApplicationDriver({browser:hh,dispatch:route=>route.fallback(),responseTimeoutMs:500});
    const guarded=new GuardedSubmission({ownerId:f.owner,primaryResumeId:resumeId,driver,
      ledger:new ApplicationLedger({root,ownerId:f.owner})});
    rpc=createRpcServer({ownerId:f.owner,token,applyToken,browser:hh,submissions:{
      submit:input=>hh.run(()=>guarded.submit(input)),reconcile:input=>hh.run(()=>guarded.reconcile(input)),
    }});
    rpc.listen(0,'127.0.0.1');await once(rpc,'listening');
    const client=new JobBrowserClient({ownerId:f.owner,token,applyToken,
      baseUrl:`http://127.0.0.1:${rpc.address().port}`,allowTestHttp:true});
    const initial=await search.ensure({scope:f.scope});
    const settings=await search.saveSettings({scope:f.scope,expectedRevision:initial.revision,
      settings:{...initial.settings,queries:['AI Engineer'],activated:true,paused:false}});
    await profiles.replace({scope:f.scope,expectedRevision:0,profile:{confirmed:true,
      baseLetter:'Интересны внедрение и тестирование AI-систем.',facts:[],examples:[]}});
    const snapshot=await hh.getVacancy({externalId:'126'});
    const vacancy=await search.upsertVacancy({externalId:'126',snapshot});
    await search.recordMatch({userId:f.owner,vacancyId:vacancy.id,filterRevision:settings.revision});
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,$2,'connected')",[f.owner,resumeId]);
    const consent=await automation.setEnabled({scope:f.scope,enabled:true,expectedRevision:0,resumeId,connectionRevision:1});
    const draft=await drafts.append({scope:f.scope,vacancyId:vacancy.id,profileRevision:1,vacancyRevision:vacancy.revision,
      text:'Точное сопроводительное письмо.',facts:[],mode:'improved',resumeId,connectionRevision:1});
    let calls=0;
    const answers=new JobQuestionAnswerService({pool:f.pool,accessService,automationRepository:automation,
      searchRepository:search,profileRepository:profiles,usageRepository:new JobUsageRepository(f.pool),
      resumeContextService:{async getSelected(){return{resumeId,connectionRevision:1,snapshot:{resumeId,title:'Основное резюме',
        experience:'Подтверждённый проект автоматизации.',skills:'Node.js',education:'',summary:'',grammaticalGender:'unknown'}};}},
      modelAdapter:{async generate(){calls++;return{text:JSON.stringify({decision:'answer',answers:[
        {id:'task_7',value:'12',basis:'knowledge',evidence:[]},
        {id:'task_8_text',value:'Сначала проверяются данные, затем ограничения.',basis:'knowledge',evidence:[]},
      ]}),finishReason:'stop',usage:{cost:0.001}};}}});
    const app=new JobApplicationService({pool:f.pool,repository:new JobApplicationRepository(f.pool,{accessService}),
      searchRepository:search,adapter:client.asApplicationAdapter(),accessService,automationRepository:automation,questionAnswerService:answers});
    const request={scope:f.scope,draftId:draft.id,automationRevision:consent.revision,expectedSearchRevision:settings.revision};
    await app.prepareConfirmation(request);assert.equal(calls,0);assert.equal(fixture.posts,0);
    const result=await app.submitAutomatic(request);
    assert.equal(result.status,'sent');assert.equal(calls,1);assert.equal(fixture.posts,1);
    assert.equal(fixture.lastFields.get('task_7'),'12');
    assert.equal(fixture.lastFields.get('task_8_text'),'Сначала проверяются данные, затем ограничения.');
    assert.equal((await app.submitAutomatic(request)).operationId,result.operationId);
    assert.equal(calls,1);assert.equal(fixture.posts,1);
    await assert.rejects(app.submitAutomatic({...request,scope:{...f.scope,userId:f.stranger}}));
    assert.equal(fixture.posts,1);
  }finally{
    if(rpc)await new Promise(resolve=>rpc.close(resolve));
    await context?.close();await browser?.close();await f.close();
    await fs.rm(root,{recursive:true,force:true});
  }
});
