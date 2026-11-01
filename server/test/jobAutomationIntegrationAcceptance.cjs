const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { AccessService } = require('../src/access/accessService');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobDraftService } = require('../src/jobs/jobDraftService');
const { JobResumeContextService } = require('../src/jobs/jobResumeContextService');
const { JobAutomationRepository } = require('../src/jobs/jobAutomationRepository');
const { JobAutomationService } = require('../src/jobs/jobAutomationService');
const { JobAutomationWorker } = require('../src/jobs/jobAutomationWorker');
const { JobApplicationRepository } = require('../src/jobs/jobApplicationRepository');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { JobModelAdapter, JOB_MODEL } = require('../src/jobs/jobModelAdapter');

async function fixture({ decision = 'apply', manual = false, modelOverride = null } = {}) {
  const f = await createJobPostgresFixture();
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101'),($2,'telegram','202')", [f.owner,f.stranger]);
  const accessService = new AccessService({ pool: f.pool, ownerTelegramId: '101', legacyAllowedIds: ['202'] });
  await accessService.initialize();
  await f.pool.query("INSERT INTO access_user_overrides(user_id,permission,effect) VALUES($1,'jobs','allow')", [f.stranger]);
  const conversation = (await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','202') RETURNING id", [f.stranger])).rows[0].id;
  const scopes = [f.scope, { userId: f.stranger, conversationId: conversation, chatId: '202', channel: 'telegram' }];
  const search = new JobSearchRepository(f.pool, { accessService });
  const profiles = new JobProfileRepository(f.pool, { accessService });
  const drafts = new JobDraftRepository(f.pool, { accessService });
  const deliveries = new JobDeliveryRepository(f.pool, { accessService });
  const usage = new JobUsageRepository(f.pool);
  const resumes = new JobResumeContextService({ pool: f.pool, accessService, browserClient: { forUser(userId) {
    return { async readResume({resumeId,requireComplete}) { assert.equal(requireComplete,true); return { resumeId, title: `Profile ${userId}`,
      experience: 'Project one\n' + 'Confirmed project detail. '.repeat(400) + '\nLast project for ' + userId,
      skills: 'Node.js', education: 'Engineering', summary: 'Practical automation', grammaticalGender: 'unknown' }; } };
  } } });
  const automation = new JobAutomationRepository(f.pool, { accessService });
  const service = new JobAutomationService({ pool: f.pool, repository: automation, searchRepository: search,
    resumeContextService: resumes, accessService, available: true });
  const calls = { evaluations: [], letters: [], submits: [], messages: [] };
  const model = modelOverride || {
    async evaluate(input) { calls.evaluations.push(input); return { decision, usage: {cost:0.001}, requestId: 'fixture-evaluation' }; },
    async generate({messages}) { const data = JSON.parse(messages[1].content); calls.letters.push(data);
      return { text: JSON.stringify({ text: `Experience of ${data.selectedResume.resumeId}`, factIds: ['fact_1'] }), finishReason:'stop', usage:{cost:0.001} }; },
  };
  const draftService = new JobDraftService({ pool: f.pool, searchRepository: search, profileRepository: profiles,
    draftRepository: drafts, usageRepository: usage, modelAdapter: model, accessService, resumeContextService: resumes });
  const snapshots = new Map();
  const appService = new JobApplicationService({ pool:f.pool,
    repository:new JobApplicationRepository(f.pool,{accessService}), searchRepository:search,
    accessService, automationRepository:automation, adapter:{capabilities:{applicantApply:true},
      async inspect({externalId}) {return {resumeAvailable:true,manualRequired:manual,vacancy:snapshots.get(externalId)};},
      async submit(args) {calls.submits.push(args);return {outcome:'sent',verified:true,externalId:`sent-${args.externalId}`};},
    } });
  const worker = new JobAutomationWorker({ pool:f.pool, repository:automation, automationService:service,
    searchRepository:search, profileRepository:profiles, resumeContextService:resumes, modelAdapter:model,
    draftService, applicationService:appService, usageRepository:usage, accessService });
  const deliveryWorker = new JobDeliveryWorker({pool:f.pool,searchRepository:search,deliveryRepository:deliveries,
    automationService:service,accessService,send:async message=>{calls.messages.push(message);return {message_id:calls.messages.length};}});
  for (const [index,scope] of scopes.entries()) {
    const initial = await search.ensure({scope});
    const current = await search.saveSettings({scope,expectedRevision:initial.revision,
      settings:{...initial.settings,queries:['developer'],activated:true,paused:false}});
    await profiles.replace({scope,expectedRevision:0,profile:{confirmed:true,facts:[{id:'fact_1',text:`Project of ${scope.userId}`,confirmed:true}],examples:[]}});
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,$2,'connected')",[scope.userId,`resume${index}`]);
    const externalId = `700${index}`;
    const snapshot={externalId,title:`Role ${index}`,company:'Fixture',description:'Related project experience welcome',
      url:`https://hh.ru/vacancy/${externalId}?tracking=fixture`,publishedAt:'2026-10-31T00:00:00Z',archived:false};
    snapshots.set(externalId,snapshot);
    const vacancy = await search.upsertVacancy({externalId,snapshot});
    await search.recordMatch({userId:scope.userId,vacancyId:vacancy.id,filterRevision:current.revision});
    await deliveries.enqueue({userId:scope.userId,vacancyId:vacancy.id});
    await service.setEnabled({scope,enabled:true,expectedRevision:0});
  }
  return {...f,scopes,search,service,automation,worker,deliveryWorker,deliveries,usage,calls,
    async close(){await worker.stop();await deliveryWorker.stop();await f.close();}};
}

test('real PG: owner and member auto-apply with their complete own resume and stay quiet',async()=>{
  const f=await fixture();try{
    await f.worker.tick();await f.worker.tick();await f.worker.tick();
    assert.equal(f.calls.submits.length,2);
    for(const evaluation of f.calls.evaluations){
      assert.ok(evaluation.resumeContext.snapshot.experience.endsWith(evaluation.userId));
      assert.equal(evaluation.profile.facts[0].text,`Project of ${evaluation.userId}`);
      assert.equal(f.calls.submits.find(s=>s.userId===evaluation.userId).resumeId,evaluation.resumeContext.resumeId);
    }
    await f.deliveryWorker.tick();assert.equal(f.calls.messages.length,0);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM job_applications WHERE status='sent'")).rows[0].n,2);
    await f.service.setEnabled({scope:f.scopes[0],enabled:false,expectedRevision:1});
    await f.deliveryWorker.tick();assert.equal(f.calls.messages.length,0,'completed auto applications are not sent as cards after disabling');
    const search=await f.search.getSettings({userId:f.owner});
    const vacancy=await f.search.upsertVacancy({externalId:'7003',snapshot:{title:'New manual role',description:'Tasks',publishedAt:'2026-11-01T00:00:00Z',url:'https://hh.ru/vacancy/7003'}});
    await f.search.recordMatch({userId:f.owner,vacancyId:vacancy.id,filterRevision:search.revision});
    await f.deliveries.enqueue({userId:f.owner,vacancyId:vacancy.id});
    await f.deliveryWorker.tick();assert.equal(f.calls.messages.length,1,'new unprocessed cards resume after disabling');
    assert.equal(f.calls.messages[0].chatId,'101');
  }finally{await f.close();}
});

test('real PG: skips never generate letters or send applications or notifications',async()=>{
  const f=await fixture({decision:'skip'});try{
    await f.worker.tick();await f.worker.tick();await f.deliveryWorker.tick();
    assert.equal(f.calls.evaluations.length,2);assert.equal(f.calls.letters.length,0);
    assert.equal(f.calls.submits.length,0);assert.equal(f.calls.messages.length,0);
    await f.service.setEnabled({scope:f.scopes[0],enabled:false,expectedRevision:1});
    await f.deliveryWorker.tick();assert.equal(f.calls.messages.length,0,'previously rejected cards remain silent');
  }finally{await f.close();}
});

test('real PG: tests and forms hand off privately using canonical links despite tracking URLs',async()=>{
  const f=await fixture({manual:true});try{
    await f.worker.tick();await f.worker.tick();await f.deliveryWorker.tick();await f.deliveryWorker.tick();
    assert.equal(f.calls.submits.length,0);assert.equal(f.calls.messages.length,2);
    assert.deepEqual(f.calls.messages.map(m=>m.chatId).sort(),['101','202']);
    for(const message of f.calls.messages){assert.match(message.answer,/тест или заполнить/);assert.match(message.answer,/https:\/\/hh.ru\/vacancy\/700[01]$/);assert.doesNotMatch(message.answer,/tracking/);}
    await f.deliveryWorker.tick();assert.equal(f.calls.messages.length,2,'handoffs deduplicate');
  }finally{await f.close();}
});

test('real PG: a disconnected profile gets one private actionable notice without routine cards',async()=>{
  const f=await fixture();try{
    await f.pool.query("UPDATE job_connections SET status='disconnected' WHERE user_id=$1",[f.owner]);
    await f.worker.tick();await f.worker.tick();await f.deliveryWorker.tick();await f.deliveryWorker.tick();
    const ownerMessages=f.calls.messages.filter(m=>m.chatId==='101');
    assert.equal(ownerMessages.length,1);assert.match(ownerMessages[0].answer,/повторный вход/);
    assert.equal(f.calls.submits.some(s=>s.userId===f.owner),false);
    assert.equal((await f.service.get({scope:f.scopes[0]})).enabled,true);
  }finally{await f.close();}
});

test('real PG: $2 month notice includes evaluation/letter estimates, deduplicates and never stops users',async()=>{
  const f=await fixture();try{
    const now=new Date('2026-10-31T21:05:00Z');
    await f.usage.record({userId:f.owner,requestId:'estimate',costUsd:1.5,costBasis:'estimated',outcome:'success',occurredAt:now});
    await f.usage.record({userId:f.owner,requestId:'letter',costUsd:0.6,outcome:'success',occurredAt:now});
    await f.usage.record({userId:f.owner,requestId:'letter',costUsd:0.6,outcome:'success',occurredAt:now});
    const results=await Promise.all([2,2].map(thresholdUsd=>f.usage.claimBudgetNotice({userId:f.owner,now,thresholdUsd})));
    assert.equal(results.filter(Boolean).length,1);
    assert.equal(await f.usage.claimBudgetNotice({userId:f.owner,now,thresholdUsd:1}),false,'only one notice per calendar month');
    const notice=(await f.pool.query("SELECT payload FROM job_deliveries WHERE user_id=$1 AND kind='budget'",[f.owner])).rows[0].payload;
    assert.equal(notice.month,'2026-11');assert.equal(notice.thresholdUsd,2);assert.equal(notice.estimated,true);
    assert.equal((await f.usage.getMonth({userId:f.stranger,now})).total,0);
    assert.equal((await f.service.get({scope:f.scopes[0]})).enabled,true);
    await f.deliveryWorker.tick();assert.match(f.calls.messages[0].answer,/расчётные расходы/);
  }finally{await f.close();}
});

test('real PG: GLM OpenRouter evaluation and letters share actual per-user cost accounting',async()=>{
  const requests=[];
  const model=new JobModelAdapter({config:{openrouterApiKey:'fixture-existing-key'},fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);
    assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
    const evaluation=body.response_format.json_schema.name==='job_vacancy_decision';
    const data=JSON.parse(body.messages[1].content);
    return Response.json({id:`fixture-glm-${requests.length}`,model:JOB_MODEL,
      usage:{cost:evaluation?1.1:0.91},choices:[{finish_reason:'stop',message:{content:JSON.stringify(evaluation?
        {decision:'apply'}:{text:`Experience of ${data.selectedResume.resumeId}`,factIds:['fact_1']})}}]});
  }});
  const f=await fixture({modelOverride:model});try{
    await f.worker.tick();await f.worker.tick();
    assert.equal(requests.length,4);assert.ok(requests.every(r=>r.model===JOB_MODEL));
    assert.equal(f.calls.submits.length,2);
    for(const scope of f.scopes){const usage=await f.usage.getMonth({userId:scope.userId});
      assert.ok(Math.abs(usage.total-2.01)<1e-9);assert.equal(usage.pending,0);assert.equal(usage.estimated,0);}
    await f.deliveryWorker.tick();await f.deliveryWorker.tick();
    assert.equal(f.calls.messages.length,2);assert.deepEqual(f.calls.messages.map(m=>m.chatId).sort(),['101','202']);
    assert.ok(f.calls.messages.every(m=>m.answer.includes('достигли $2')&&!m.answer.includes('расчётные')));
  }finally{await f.close();}
});

test('real PG: resume outage before a model call resumes the same item after backoff',async()=>{
  const f=await fixture();try{
    const read=f.worker.resumeContextService.getSelected.bind(f.worker.resumeContextService);
    f.worker.resumeContextService.getSelected=async()=>{throw Object.assign(new Error('fixture'),{code:'JOB_HH_RESUME_UNAVAILABLE'});};
    await f.worker.tick();
    const item=(await f.pool.query('SELECT * FROM job_automation_items')).rows[0];
    assert.equal(item.status,'pending');assert.equal(f.calls.evaluations.length,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_usage')).rows[0].n,0);
    f.worker.resumeContextService.getSelected=read;
    await f.pool.query("UPDATE job_automations SET next_attempt_at=now()");
    await f.worker.tick();
    const after=(await f.pool.query('SELECT * FROM job_automation_items WHERE id=$1',[item.id])).rows[0];
    assert.equal(after.status,'sent');assert.equal(after.evaluation_request_id,item.evaluation_request_id);
    assert.equal(f.calls.evaluations.length,1);assert.equal(f.calls.submits.length,1);
  }finally{await f.close();}
});
