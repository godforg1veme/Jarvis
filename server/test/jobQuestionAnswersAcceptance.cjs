const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobAutomationRepository } = require('../src/jobs/jobAutomationRepository');
const { JobApplicationRepository } = require('../src/jobs/jobApplicationRepository');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');
const { JobQuestionAnswerService } = require('../src/jobs/jobQuestionAnswerService');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { normalizeQuestionnaire } = require('../../shared/jobQuestionnaire');

const questionnaire = normalizeQuestionnaire({questions:[{id:'q1',label:'Какой ваш личный AI-проект?',type:'text',required:true,maxLength:2000,options:[]}]});

async function fixture({ decision = 'answer', mutate = null, loseResponse = false } = {}) {
  const f = await createJobPostgresFixture();
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')",[f.owner]);
  const accessService = configuredOwnerJobAccess(f.pool,'101');
  const search = new JobSearchRepository(f.pool,{accessService});
  const profiles = new JobProfileRepository(f.pool,{accessService});
  const drafts = new JobDraftRepository(f.pool,{accessService});
  const automation = new JobAutomationRepository(f.pool,{accessService});
  const applications = new JobApplicationRepository(f.pool,{accessService});
  const usage = new JobUsageRepository(f.pool);
  const initial = await search.ensure({scope:f.scope});
  const settings = await search.saveSettings({scope:f.scope,expectedRevision:initial.revision,
    settings:{...initial.settings,queries:['AI Engineer'],activated:true,paused:false}});
  await profiles.replace({scope:f.scope,expectedRevision:0,profile:{confirmed:true,baseLetter:'Хочу заниматься AI-интеграциями.',
    facts:[],examples:[]}});
  const snapshot = {externalId:'987654',title:'AI Engineer',company:'Fixture',description:'Implement AI',
    url:'https://hh.ru/vacancy/987654',publishedAt:'2026-11-01T00:00:00.000Z',archived:false,manualRequired:false};
  const vacancy = await search.upsertVacancy({externalId:snapshot.externalId,snapshot});
  await search.recordMatch({userId:f.owner,vacancyId:vacancy.id,filterRevision:settings.revision});
  await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'resume1','connected')",[f.owner]);
  const consent = await automation.setEnabled({scope:f.scope,enabled:true,expectedRevision:0,resumeId:'resume1',connectionRevision:1});
  const draft = await drafts.append({scope:f.scope,vacancyId:vacancy.id,profileRevision:1,vacancyRevision:vacancy.revision,
    text:'Личное письмо.',facts:[],mode:'improved',resumeId:'resume1',connectionRevision:1});
  const calls = {model:0,submit:[],reconcile:[]};
  const answerService = new JobQuestionAnswerService({pool:f.pool,accessService,automationRepository:automation,
    searchRepository:search,profileRepository:profiles,usageRepository:usage,
    resumeContextService:{async getSelected(){return{resumeId:'resume1',connectionRevision:1,snapshot:{resumeId:'resume1',title:'AI Engineer',
      experience:'Разработал личного AI-ассистента.',skills:'Node.js',education:'',summary:'',grammaticalGender:'unknown'}};}},
    modelAdapter:{async generate({messages}){calls.model++;const context=JSON.parse(messages[1].content).context;
      assert.equal(context.baseLetter,'Хочу заниматься AI-интеграциями.');
      assert.deepEqual(context.searchSettings.queries,['AI Engineer']);
      if(mutate)await mutate(f);
      if(loseResponse)throw Object.assign(new Error('fixture'),{code:'JOB_MODEL_UNAVAILABLE'});
      return{text:JSON.stringify({decision,answers:decision==='manual'?[]:[{id:'q1',value:'Разработал личного AI-ассистента.',basis:'personal',
        evidence:['Разработал личного AI-ассистента.']}]}),finishReason:'stop',usage:{cost:0.001},requestId:'fixture-question-model'};
    }}});
  let observedQuestionnaire = questionnaire;
  const adapter = {capabilities:{applicantApply:true},async inspect(){return{resumeAvailable:true,manualRequired:true,
    reasonCode:'JOB_HH_QUESTIONS_REQUIRED',questionnaire:observedQuestionnaire,vacancy:snapshot};},
    async submit(args){calls.submit.push(args);const row=(await f.pool.query('SELECT * FROM job_applications WHERE operation_id=$1',[args.operationId])).rows[0];
      assert.equal(row.status,'sending');assert.deepEqual(row.questionnaire,args.questionnaire);assert.deepEqual(row.questionnaire_answers,args.answers);
      assert.equal(row.questionnaire_context.automationRevision,consent.revision);
      return{outcome:'unknown'};},
    async reconcile(args){calls.reconcile.push(args);return{outcome:'unknown'};}};
  const service = new JobApplicationService({pool:f.pool,repository:applications,searchRepository:search,adapter,
    accessService,automationRepository:automation,questionAnswerService:answerService});
  const request = {scope:f.scope,draftId:draft.id,automationRevision:consent.revision,questionnaire};
  return {...f,calls,draft,consent,answerService,service,request,adapter,
    changeForm(){observedQuestionnaire=normalizeQuestionnaire({questions:[{...questionnaire.questions[0],label:'Изменённый вопрос'}]});}};
}

test('real PG: answers are grounded, saved before submit and reconciled only by original operation',async()=>{
  const f=await fixture();try{
    const response=await f.service.submitAutomatic(f.request);
    assert.equal(response.status,'unknown');assert.equal(f.calls.model,1);assert.equal(f.calls.submit.length,1);
    const again=await f.service.submitAutomatic(f.request);
    assert.equal(again.operationId,response.operationId);assert.equal(f.calls.model,1);assert.equal(f.calls.submit.length,1);
    await f.service.reconcile({scope:f.scope,operationId:response.operationId});
    assert.equal(f.calls.reconcile[0].operationId,response.operationId);
    assert.deepEqual(f.calls.reconcile[0].answers,f.calls.submit[0].answers);
    await assert.rejects(f.service.reconcile({scope:{...f.scope,userId:f.stranger},operationId:response.operationId}));
    assert.equal(f.calls.reconcile.length,1);
  }finally{await f.close();}
});

test('real PG: missing personal answer stays private, does not submit and does not bill again',async()=>{
  const f=await fixture({decision:'manual'});try{
    for(let n=0;n<2;n++)assert.equal((await f.service.submitAutomatic(f.request)).failureCode,'JOB_HH_ANSWER_UNAVAILABLE');
    assert.equal(f.calls.model,1);assert.equal(f.calls.submit.length,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n,0);
    await assert.rejects(f.answerService.prepare({...f.request,scope:{...f.scope,chatId:'999'}}));
    assert.equal(f.calls.model,1);
  }finally{await f.close();}
});

test('real PG: revoke or change profile during model generation prevents submission',async()=>{
  for(const mutation of [
    async f=>f.pool.query('UPDATE job_automations SET enabled=false,revision=revision+1 WHERE user_id=$1',[f.owner]),
    async f=>f.pool.query('UPDATE job_profiles SET revision=revision+1 WHERE user_id=$1',[f.owner]),
    async f=>f.pool.query('UPDATE job_searches SET revision=revision+1 WHERE user_id=$1',[f.owner]),
  ]){
    const f=await fixture({mutate:mutation});try{
      await assert.rejects(f.service.submitAutomatic(f.request));assert.equal(f.calls.submit.length,0);
      assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n,0);
    }finally{await f.close();}
  }
});

test('real PG: lost model response is not retried and manual mode does not generate answers',async()=>{
  const f=await fixture({loseResponse:true});try{
    await assert.rejects(f.answerService.prepare(f.request));
    await assert.rejects(f.answerService.prepare(f.request),{code:'JOB_QUESTION_ANSWERS_UNKNOWN'});
    assert.equal(f.calls.model,1);
    const response=await f.service.prepareConfirmation(f.request);
    assert.ok(response.answer);assert.equal(f.calls.model,1);assert.equal(f.calls.submit.length,0);
  }finally{await f.close();}
});

test('real PG: a changed question set after generation cannot send old answers',async()=>{
  const f=await fixture();try{
    const generate=f.answerService.modelAdapter.generate;
    f.answerService.modelAdapter.generate=async input=>{const value=await generate(input);f.changeForm();return value;};
    const result=await f.service.submitAutomatic(f.request);
    assert.equal(result.status,'manual_required');assert.equal(result.failureCode,'JOB_HH_FORM_CHANGED');
    assert.equal(f.calls.submit.length,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n,0);
  }finally{await f.close();}
});

test('real PG: a stale selection revision cannot claim an application even after new matches exist',async()=>{
  const f=await fixture();try{
    const before=(await f.pool.query('SELECT revision FROM job_searches WHERE user_id=$1',[f.owner])).rows[0].revision;
    await f.pool.query('UPDATE job_searches SET revision=revision+1 WHERE user_id=$1',[f.owner]);
    await f.pool.query('UPDATE job_matches SET filter_revision=$1 WHERE user_id=$2',[before+1,f.owner]);
    await assert.rejects(f.service.repository.claimAutomatic({scope:f.scope,draftId:f.draft.id,
      automationRevision:f.consent.revision,expectedSearchRevision:before}),{code:'JOB_REVISION_CONFLICT'});
    assert.equal(f.calls.model,0);assert.equal(f.calls.submit.length,0);
  }finally{await f.close();}
});

test('real PG: CAPTCHA inspection is a known stop with no application or answer model call',async()=>{
  const f=await fixture();try{
    f.adapter.inspect=async()=>{throw Object.assign(new Error('fixture'),{code:'JOB_HH_CAPTCHA_REQUIRED'});};
    const response=await f.service.submitAutomatic(f.request);
    assert.equal(response.status,'manual_required');assert.equal(response.failureCode,'JOB_HH_CAPTCHA_REQUIRED');
    assert.equal(f.calls.model,0);assert.equal(f.calls.submit.length,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n,0);
  }finally{await f.close();}
});
