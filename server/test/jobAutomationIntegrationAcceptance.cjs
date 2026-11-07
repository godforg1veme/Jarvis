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
const resumeMarker = value => value.replace(/\d/g, digit => 'abcdefghij'[Number(digit)]);

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
    return { async readResume({resumeId,requireComplete}) { assert.equal(requireComplete,true); return { resumeId, title: `Profile ${resumeMarker(userId)}`,
      experience: 'Project one\n' + 'Confirmed project detail. '.repeat(400) + '\nLast project for ' + resumeMarker(userId),
      skills: 'Node.js', education: 'Engineering', summary: 'Practical automation', grammaticalGender: 'unknown' }; } };
  } } });
  const automation = new JobAutomationRepository(f.pool, { accessService });
  const service = new JobAutomationService({ pool: f.pool, repository: automation, searchRepository: search,
    resumeContextService: resumes, accessService, available: true });
  const calls = { evaluations: [], directions: [], letters: [], submits: [], messages: [] };
  const model = modelOverride || {
    async evaluate(input) { calls.evaluations.push(input); return { decision, directionMatched: true,
      reasonCode: decision === 'apply' ? 'DIRECTION_FIT' : 'INSUFFICIENT_FIT',
      directionAssessment: { primaryOccupation: 'Developer', targetQuery: 'developer',
        relationship: 'core', dutiesQuotes: ['Build integrations for internal services.'] },
      rationale: 'Fixture decision', usage: {cost:0.001}, requestId: 'fixture-evaluation' }; },
    async verifyDirection(input) { calls.directions.push(input); return { decision: 'apply', directionMatched: true,
      reasonCode: 'DIRECTION_FIT', rationale: 'Source direction matches', directionAssessment: {
        primaryOccupation: 'Developer', targetQuery: 'developer', relationship: 'core',
        dutiesQuotes: ['Build integrations for internal services.'] },
      usage: {cost:0.0005}, requestId: 'fixture-direction' }; },
    async generate({messages}) { const data = JSON.parse(messages[1].content); calls.letters.push(data);
      return { text: JSON.stringify({ text: `Experience of ${data.selectedResume.resumeId}`, factIds: ['fact_1'] }), finishReason:'stop', usage:{cost:0.001} }; },
  };
  const draftService = new JobDraftService({ pool: f.pool, searchRepository: search, profileRepository: profiles,
    draftRepository: drafts, usageRepository: usage, modelAdapter: model, accessService, resumeContextService: resumes });
  const snapshots = new Map();
  const appService = new JobApplicationService({ pool:f.pool,
    repository:new JobApplicationRepository(f.pool,{accessService}), searchRepository:search,
    accessService, automationRepository:automation, adapter:{capabilities:{applicantApply:true},
      async inspect({externalId}) {return {resumeAvailable:true,manualRequired:manual,
        reasonCode:manual?'JOB_HH_FORM_CHANGED':null,vacancy:snapshots.get(externalId)};},
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
    const snapshot={externalId,title:`Role ${index}`,company:'Fixture',description:'Build integrations for internal services.',
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
      assert.ok(evaluation.resumeContext.snapshot.experience.endsWith(resumeMarker(evaluation.userId)));
      assert.equal(evaluation.profile.facts[0].text,`Project of ${evaluation.userId}`);
      assert.equal(f.calls.submits.find(s=>s.userId===evaluation.userId).resumeId,evaluation.resumeContext.resumeId);
    }
    await f.deliveryWorker.tick();assert.equal(f.calls.messages.length,0);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM job_applications WHERE status='sent'")).rows[0].n,2);
    const judgments=(await f.pool.query('SELECT evaluation FROM job_automation_items')).rows;
    assert.ok(judgments.every(x=>x.evaluation.selectionPolicyVersion===3));
    assert.equal(f.calls.directions.length,2);
    assert.ok(f.calls.directions.every(x=>!Object.hasOwn(x,'resumeContext')&&!Object.hasOwn(x,'profile')));
    assert.ok(judgments.every(x=>x.evaluation.directionAssessment.relationship==='core'));
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

test('real PG: incidental AI assessment skips both personal scopes without a letter or application',async()=>{
  const f=await fixture({modelOverride:{async evaluate(){return {
    decision:'apply',directionMatched:true,reasonCode:'DIRECTION_FIT',rationale:'AI as a daily tool',
    directionAssessment:{primaryOccupation:'General developer',targetQuery:'developer',relationship:'tool_only',
      dutiesQuotes:['Build integrations for internal services.']},usage:{cost:0.001},requestId:'fixture-evidence',
  };},async generate(){throw Error('Incidental role must not generate a letter');}}});
  try{
    await f.worker.tick();await f.worker.tick();await f.deliveryWorker.tick();
    const rows=(await f.pool.query('SELECT status,evaluation FROM job_automation_items ORDER BY user_id')).rows;
    assert.equal(rows.length,2);
    assert.ok(rows.every(x=>x.status==='skipped'&&x.evaluation.reasonCode==='OUT_OF_DIRECTION'));
    assert.ok(rows.every(x=>x.evaluation.directionAssessment.relationship==='tool_only'&&x.evaluation.selectionPolicyVersion===3));
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_drafts')).rows[0].n,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n,0);
    assert.equal(f.calls.messages.length,0);
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

test('real PG: a known model skip is reconsidered only after search revision changes',async()=>{
  const f=await fixture({decision:'skip'});try{
    await f.worker.tick();await f.worker.tick();
    const before=f.calls.evaluations.length;
    await f.worker.tick();assert.equal(f.calls.evaluations.length,before);
    const old=await f.search.getSettings({userId:f.owner});
    const newer=await f.search.saveSettings({scope:f.scope,expectedRevision:old.revision,
      settings:{...old.settings,queries:['developer','AI engineer']}});
    const match=(await f.pool.query('SELECT vacancy_id FROM job_matches WHERE user_id=$1',[f.owner])).rows[0];
    await f.search.recordMatch({userId:f.owner,vacancyId:match.vacancy_id,filterRevision:newer.revision});
    await f.worker.tick();
    assert.equal(f.calls.evaluations.length,before+1);
    const item=(await f.pool.query('SELECT status,evaluation_request_id,evaluation FROM job_automation_items WHERE user_id=$1',[f.owner])).rows[0];
    assert.equal(item.status,'skipped');assert.equal(item.evaluation.revisions.search,newer.revision);
    assert.match(item.evaluation_request_id,/auto-evaluate:/);
    await f.pool.query("UPDATE job_automation_items SET status='unknown' WHERE user_id=$1",[f.owner]);
    const latest=await f.search.saveSettings({scope:f.scope,expectedRevision:newer.revision,
      settings:{...newer.settings,queries:['developer','AI engineer','integration']}});
    await f.search.recordMatch({userId:f.owner,vacancyId:match.vacancy_id,filterRevision:latest.revision});
    await f.worker.tick();assert.equal(f.calls.evaluations.length,before+1);
  }finally{await f.close();}
});

test('real PG: a known hard-filter skip can be reconsidered after preferences change',async()=>{
  const f=await fixture();try{
    const old=await f.search.getSettings({userId:f.owner});
    const excluded=await f.search.saveSettings({scope:f.scope,expectedRevision:old.revision,
      settings:{...old.settings,exclusions:['Role 0']}});
    const match=(await f.pool.query('SELECT vacancy_id FROM job_matches WHERE user_id=$1',[f.owner])).rows[0];
    await f.search.recordMatch({userId:f.owner,vacancyId:match.vacancy_id,filterRevision:excluded.revision});
    await f.worker.tick();await f.worker.tick();
    const skipped=(await f.pool.query('SELECT status,evaluation FROM job_automation_items WHERE user_id=$1',[f.owner])).rows[0];
    assert.equal(skipped.status,'skipped');assert.equal(skipped.evaluation.source,'filter');
    const allowed=await f.search.saveSettings({scope:f.scope,expectedRevision:excluded.revision,
      settings:{...excluded.settings,exclusions:[]}});
    await f.search.recordMatch({userId:f.owner,vacancyId:match.vacancy_id,filterRevision:allowed.revision});
    await f.worker.tick();
    assert.equal(f.calls.evaluations.filter(x=>x.userId===f.owner).length,1);
    assert.equal(f.calls.submits.filter(x=>x.userId===f.owner).length,1);
  }finally{await f.close();}
});

test('real PG: tests and forms hand off privately using canonical links despite tracking URLs',async()=>{
  const f=await fixture({manual:true});try{
    await f.worker.tick();await f.worker.tick();await f.deliveryWorker.tick();await f.deliveryWorker.tick();
    assert.equal(f.calls.submits.length,0);assert.equal(f.calls.messages.length,2);
    assert.deepEqual(f.calls.messages.map(m=>m.chatId).sort(),['101','202']);
    for(const message of f.calls.messages){assert.match(message.answer,/Форма HH отличается/);assert.match(message.answer,/https:\/\/hh.ru\/vacancy\/700[01]$/);assert.doesNotMatch(message.answer,/tracking|тест или заполнить/);}
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
        {decision:'apply',directionMatched:true,reasonCode:'DIRECTION_FIT',rationale:'Fixture direction',
          directionAssessment:{primaryOccupation:'Developer',targetQuery:'developer',relationship:'core',
            dutiesQuotes:['Build integrations for internal services.']}}
        :{status:'ready',text:`Experience of ${data.selectedResume.resumeId}`,factIds:['fact_1']})}}]});
  }});
  const f=await fixture({modelOverride:model});try{
    await f.worker.tick();await f.worker.tick();
    assert.equal(requests.length,6);assert.ok(requests.every(r=>r.model===JOB_MODEL));
    const directionRequests=requests.filter(r=>Object.hasOwn(JSON.parse(r.messages[1].content),'queries'));
    assert.equal(directionRequests.length,2);
    assert.ok(directionRequests.every(r=>!Object.hasOwn(JSON.parse(r.messages[1].content),'selectedResume')));
    assert.equal(f.calls.submits.length,2);
    for(const scope of f.scopes){const usage=await f.usage.getMonth({userId:scope.userId});
      assert.ok(Math.abs(usage.total-3.11)<1e-9);assert.equal(usage.pending,0);assert.equal(usage.estimated,0);}
    await f.deliveryWorker.tick();await f.deliveryWorker.tick();
    assert.equal(f.calls.messages.length,2);assert.deepEqual(f.calls.messages.map(m=>m.chatId).sort(),['101','202']);
    assert.ok(f.calls.messages.every(m=>m.answer.includes('достигли $2')&&!m.answer.includes('расчётные')));
  }finally{await f.close();}
});

test('real PG: independent source veto defeats a preliminary false core without any draft or application',async()=>{
  const requests=[];
  const model=new JobModelAdapter({config:{openrouterApiKey:'fixture-existing-key'},fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);
    assert.equal(body.response_format.json_schema.name,'job_vacancy_decision','a letter must never be requested');
    const sourceOnly=Object.hasOwn(JSON.parse(body.messages[1].content),'queries');
    const choice={decision:sourceOnly?'skip':'apply',directionMatched:!sourceOnly,
      reasonCode:sourceOnly?'OUT_OF_DIRECTION':'DIRECTION_FIT',rationale:'Source duties',
      directionAssessment:{primaryOccupation:sourceOnly?'Сметчик':'AI Engineer',targetQuery:'developer',
        relationship:sourceOnly?'adjacent':'core',dutiesQuotes:[sourceOnly
          ?'Составлять строительные сметы и рассчитывать стоимость домов.'
          :'Внедрение ИИ в сметный модуль для ускорения расчётов.']}};
    return Response.json({id:`fixture-veto-${requests.length}`,model:JOB_MODEL,
      usage:{cost:sourceOnly?0.0004:0.001},choices:[{finish_reason:'stop',message:{content:JSON.stringify(choice)}}]});
  }});
  const f=await fixture({modelOverride:model});try{
    for(const externalId of ['7000','7001'])await f.search.upsertVacancy({externalId,snapshot:{externalId,
      title:'Сметчик-Расчётчик ИЖС',description:'Составлять строительные сметы и рассчитывать стоимость домов. Внедрение ИИ в сметный модуль для ускорения расчётов.',
      url:`https://hh.ru/vacancy/${externalId}`,publishedAt:'2026-11-01T00:00:00Z',archived:false}});
    await f.worker.tick();await f.worker.tick();await f.worker.tick();
    assert.equal(requests.length,4);
    assert.equal(f.calls.submits.length,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_drafts')).rows[0].n,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n,0);
    const rows=(await f.pool.query('SELECT status,evaluation FROM job_automation_items')).rows;
    assert.equal(rows.length,2);
    assert.ok(rows.every(x=>x.status==='skipped'&&x.evaluation.directionVerification.decision==='skip'));
    for(const scope of f.scopes){const usage=await f.usage.getMonth({userId:scope.userId});
      assert.ok(Math.abs(usage.total-0.0014)<1e-9);assert.equal(usage.pending,0);}
    for(const body of requests.filter(r=>Object.hasOwn(JSON.parse(r.messages[1].content),'queries'))){
      assert.equal(Object.hasOwn(JSON.parse(body.messages[1].content),'selectedResume'),false);
      assert.doesNotMatch(JSON.stringify(body),/Confirmed project detail|Project of/);
    }
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
