const test=require('node:test'),assert=require('node:assert/strict');
const {historyFixture,historyItem,historyPage}=require('./helpers/jobHistoryFixture');
const {JobSearchRepository}=require('../src/jobs/jobSearchRepository');
const {jobTransaction}=require('../src/jobs/jobTransaction');
async function connectEntitledMember(f){
 await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','202')",[f.stranger]);
 await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'secondResume','connected')",[f.stranger]);
 const role=(await f.pool.query("INSERT INTO access_roles(name) VALUES('Jobs fixture') RETURNING id")).rows[0].id;
 await f.pool.query("INSERT INTO access_role_permissions(role_id,permission) VALUES($1,'jobs')",[role]);
 await f.pool.query("INSERT INTO access_memberships(user_id,telegram_id,role_id) VALUES($1,'202',$2)",[f.stranger,role]);
}

test('real handlers/RPC/PG import active and archived histories, preserve dates, details and status events',async()=>{
 const f=await historyFixture();try{
 f.pages.set('archived:0',historyPage('archived',[historyItem('12',{resumeId:'999',status:'rejected',appliedAt:null,title:'Old fixture',vacancyId:'124',url:'https://hh.ru/vacancy/124'})]));
 f.pages.set('active:0',historyPage('active',[historyItem('11',{title:'Длинное название вакансии '.repeat(18)})]));
 const open=await f.cb('job:applications:0');assert.match(open.answer,/Отклики: 0/);const run=await f.runtime.historySync.state(f.scope);
 await f.cb('job:applications_sync');assert.equal((await f.runtime.historySync.state(f.scope)).run_id,run.run_id);
 await f.tick();await f.tick();assert.equal((await f.runtime.historySync.state(f.scope)).status,'complete');
 const view=await f.cb('job:applications:0');assert.match(view.answer,/Отклики: 2/);assert.match(view.answer,/Обнаружен на HH/);assert.match(view.answer,/Fixture company/);assert.equal(f.reads,2);
 const rows=await f.runtime.historyRepository.list({scope:f.scope});assert.equal(rows.total,2);
 const old=rows.items.find(x=>x.title==='Old fixture');const detail=await f.cb(`job:application:${old.id}`);
 assert.match(detail.answer,/Обнаружен на HH/);assert.match(detail.answer,/Дата отправки неизвестна/);assert.match(detail.answer,/Отказ/);
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_applications')).rows[0].n,0);
 const before=(await f.pool.query('SELECT count(*)::int AS n FROM job_history_events')).rows[0].n;
 await f.cb('job:applications_sync');await f.tick();await f.tick();assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_history_events')).rows[0].n,before);
 f.pages.set('active:0',historyPage('active',[historyItem('11',{status:'unknown',title:null,company:null,appliedAt:null})]));
 await f.cb('job:applications_sync');await f.tick();await f.tick();
 const retained=(await f.runtime.historyRepository.list({scope:f.scope})).items.find(x=>x.id!==old.id);assert.equal(retained.employer_status,'viewed');assert.equal(retained.title,'Длинное название вакансии '.repeat(18));
 f.pages.set('active:0',historyPage('active',[historyItem('11',{status:'invited'})]));await f.cb('job:applications_sync');await f.tick();await f.tick();
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_history_events')).rows[0].n,before+1);
 assert.equal(f.modelCalls,0);assert.equal(f.submits,0);
 }finally{await f.close();}
});

test('already-applied inspect is classified correctly and added to tracker without another submission',async()=>{
 const f=await historyFixture();try{
 const search=new JobSearchRepository(f.pool,{accessService:f.runtime.telegramService.accessService});await f.cb('job:menu');
 const snapshot={externalId:'123',title:'Fixture existing vacancy',company:'Fixture',url:'https://hh.ru/vacancy/123',publishedAt:'2026-10-01T12:00:00Z',archived:false};
 const v=await search.upsertVacancy({externalId:'123',snapshot});await search.recordMatch({userId:f.owner,vacancyId:v.id,filterRevision:1});
 const d=await f.runtime.telegramService.draftService.createManual({scope:f.scope,vacancyId:v.id,mode:'custom',text:'Private fixture draft'});
 f.runtime.applicationService.adapter.inspect=async()=>({vacancy:snapshot,resumeAvailable:true,manualRequired:true,reasonCode:'JOB_HH_ALREADY_APPLIED',existingApplicationId:'11',existingApplication:historyItem('11',{resumeHash:'fixtureResume'})});
 assert.match((await f.cb(`job:send:${d.id}`)).answer,/уже есть отклик/);
 assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,1);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_applications')).rows[0].n,0);
 f.runtime.applicationService.adapter.inspect=async()=>({vacancy:snapshot,resumeAvailable:true,manualRequired:true,existingApplicationId:'12',existingApplication:historyItem('12',{resumeHash:'foreignResume'})});
 await f.cb(`job:send:${d.id}`);assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,1);
 assert.equal(f.submits,0);assert.equal(f.modelCalls,0);
 }finally{await f.close();}
});

test('disconnect or changed topic identity while a page is in flight cannot commit its data',async()=>{
 const f=await historyFixture();try{
 await f.cb('job:applications:0');const run=await f.runtime.historySync.claim();
 await f.pool.query("UPDATE job_connections SET status='disconnected' WHERE user_id=$1",[f.owner]);
 await assert.rejects(f.runtime.historySync.applyPage({run,leaseId:run.lease_id,result:historyPage()}),{code:'JOB_HH_NOT_CONNECTED'});
 assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,0);
 await f.pool.query("UPDATE job_connections SET status='connected' WHERE user_id=$1",[f.owner]);
 await f.runtime.historySync.applyPage({run,leaseId:run.lease_id,result:historyPage()});
 await f.tick();await f.cb('job:applications_sync');f.pages.set('active:0',historyPage('active',[historyItem('11',{resumeId:'999'})]));await f.tick();
 assert.equal((await f.runtime.historySync.state(f.scope)).status,'failed');
 const row=(await f.runtime.historyRepository.list({scope:f.scope})).items[0];const stored=await f.runtime.historyRepository.get({scope:f.scope,id:row.id});assert.equal(stored.resume_native_id,'456');
 }finally{await f.close();}
});

test('lease concurrency, crash recovery, checkpoint and CAPTCHA preserve prior observations without mutations',async()=>{
 const f=await historyFixture();try{
 f.pages.set('active:0',historyPage('active',[historyItem()],{total:2,pages:2}));
 f.pages.set('active:1',historyPage('active',[historyItem('12')],{page:1,total:2,pages:2}));
 await f.cb('job:applications:0');const claims=await Promise.all([f.runtime.historySync.claim(),f.runtime.historySync.claim()]);assert.equal(claims.filter(Boolean).length,1);
 const stale=claims.find(Boolean);f.clock.now=new Date(f.clock.now.getTime()+121000);
 await f.tick();assert.equal((await f.runtime.historySync.state(f.scope)).page,1);
 assert.equal(await f.runtime.historySync.applyPage({run:stale,leaseId:stale.lease_id,result:f.pages.get('active:0')}),false);
 f.setFailure('JOB_HH_CAPTCHA_MANUAL_REQUIRED');await f.tick();let state=await f.runtime.historySync.state(f.scope);assert.equal(state.status,'paused');assert.equal(state.page,1);
 assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,1);
 f.setFailure(null);await f.cb('job:applications_sync');await f.tick();await f.tick();
 state=await f.runtime.historySync.state(f.scope);assert.equal(state.status,'complete');assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,2);
 assert.equal(f.submits,0);assert.equal(f.modelCalls,0);
 }finally{await f.close();}
});

test('foreign scope, missing records and revoked identity cannot read, refresh or execute history work',async()=>{
 const f=await historyFixture();try{
 await f.cb('job:applications:0');await f.tick();await f.tick();const row=(await f.runtime.historyRepository.list({scope:f.scope})).items[0];
 for(const action of ['job:applications:0','job:applications_sync',`job:application:${row.id}`,`job:application_refresh:${row.id}`]){
  assert.match((await f.cb(action,202)).answer,/личном чате и при действующем разрешении/);assert.match((await f.cb(action,101,-100,'group')).answer,/личном/);assert.match((await f.cb(action,101,999)).answer,/личном/);
 }
 await assert.rejects(f.runtime.historyRepository.get({scope:{...f.scope,userId:f.stranger},id:row.id}));
 const update=f.callbackUpdate('job:applications_sync');await f.messages.handleCallback(update);assert.equal((await f.messages.handleCallback(update)).status,'duplicate');
 await f.pool.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='telegram'",[f.owner]);const before=f.reads;await f.tick();assert.equal(f.reads,before);
 }finally{await f.close();}
});

test('unstable pagination becomes incomplete; missing rows and unknown operation results are never rewritten',async()=>{
 const f=await historyFixture();try{
 f.pages.set('active:0',historyPage('active',[historyItem()],{total:2}));await f.cb('job:applications:0');await f.tick();await f.tick();
 assert.equal((await f.runtime.historySync.state(f.scope)).status,'incomplete');assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,1);
 const search=new JobSearchRepository(f.pool,{accessService:f.runtime.telegramService.accessService});const v=await search.upsertVacancy({externalId:'123',snapshot:{title:'Fixture vacancy',company:'Fixture company',url:'https://hh.ru/vacancy/123',publishedAt:'2026-10-01',archived:false}});
 await f.ownOperation(v,'unknown');
 assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,2);
 f.pages.set('active:0',historyPage('active',[]));await f.cb('job:applications_sync');await f.tick();await f.tick();
 assert.equal((await f.runtime.historyRepository.list({scope:f.scope})).total,2);
 assert.equal((await f.pool.query('SELECT status FROM job_applications')).rows[0].status,'unknown');assert.equal(f.submits,0);
 }finally{await f.close();}
});

test('linking a verified own topic merges only that operation, preserves native resume and known letter',async()=>{
 const f=await historyFixture();try{
 await f.cb('job:applications:0');await f.tick();await f.tick();const search=new JobSearchRepository(f.pool,{accessService:f.runtime.telegramService.accessService});
 const v=await search.upsertVacancy({externalId:'123',snapshot:{title:'Fixture vacancy',publishedAt:'2026-10-01'}});
 await f.ownOperation(v,'sent','11','Private approved letter');
 const list=await f.runtime.historyRepository.list({scope:f.scope});assert.equal(list.total,1);assert.equal(list.items[0].origin,'jarvis');
 const detail=await f.cb(`job:application:${list.items[0].id}`);assert.match(detail.answer,/Отправлен через Jarvis/);assert.match(detail.answer,/Private approved letter/);
 const history=(await f.pool.query('SELECT content FROM messages')).rows.map(x=>x.content).join('\n');assert.ok(!history.includes('Private approved letter'));
 }finally{await f.close();}
});

test('hourly scheduler includes every connected entitled user without search settings and respects the completion deadline',async()=>{
 const f=await historyFixture();try{
  await connectEntitledMember(f);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_searches')).rows[0].n,0);
  assert.equal(await f.runtime.historySync.scheduleDue(),2);
  let rows=(await f.pool.query('SELECT user_id,run_id,status FROM job_history_syncs ORDER BY user_id')).rows;
  assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.status==='queued'));
  assert.equal(await f.runtime.historySync.scheduleDue(),0);
  assert.deepEqual((await f.pool.query('SELECT user_id,run_id,status FROM job_history_syncs ORDER BY user_id')).rows,rows);
  await f.pool.query("UPDATE job_history_syncs SET status='complete',updated_at=$1 WHERE user_id=$2",[f.clock.now,f.owner]);
  f.clock.now=new Date(f.clock.now.getTime()+3599000);
  assert.equal(await f.runtime.historySync.scheduleDue(),0);
  f.clock.now=new Date(f.clock.now.getTime()+1000);
  assert.equal(await f.runtime.historySync.scheduleDue(),1);
  const owner=(await f.pool.query('SELECT run_id,status FROM job_history_syncs WHERE user_id=$1',[f.owner])).rows[0];
  assert.equal(owner.status,'queued');assert.notEqual(owner.run_id,rows.find(row=>row.user_id===f.owner).run_id);
  assert.equal((await f.pool.query('SELECT run_id FROM job_history_syncs WHERE user_id=$1',[f.stranger])).rows[0].run_id,rows.find(row=>row.user_id===f.stranger).run_id);
 }finally{await f.close();}
});

test('history worker starts a first full run before the user opens the history menu',async()=>{
 const f=await historyFixture();try{
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_history_syncs')).rows[0].n,0);
  await f.tick();
  const state=await f.runtime.historySync.state(f.scope);
  assert.equal(state.status,'queued');assert.equal(state.section,'archived');assert.equal(f.reads,1);
  await f.tick();assert.equal((await f.runtime.historySync.state(f.scope)).status,'complete');
 }finally{await f.close();}
});

test('hourly scheduling preserves active checkpoints, retries terminal runs, and excludes revoked or disconnected users',async()=>{
 const f=await historyFixture();try{
  await connectEntitledMember(f);
  const [first,second]=await Promise.all([f.runtime.historySync.scheduleDue(),f.runtime.historySync.scheduleDue()]);
  assert.equal(first+second,2);
  await f.pool.query("UPDATE job_history_syncs SET status='paused',section='archived',page=3,pass=2,seen_ids='[\"11\"]' WHERE user_id=$1",[f.owner]);
  await f.pool.query("UPDATE job_history_syncs SET status='failed',failure_code='JOB_HH_UNAVAILABLE',updated_at=$1 WHERE user_id=$2",[f.clock.now,f.stranger]);
  f.clock.now=new Date(f.clock.now.getTime()+3600000);
  assert.equal(await f.runtime.historySync.scheduleDue(),1);
  const paused=(await f.pool.query('SELECT * FROM job_history_syncs WHERE user_id=$1',[f.owner])).rows[0];
  assert.equal(paused.status,'paused');assert.equal(paused.section,'archived');assert.equal(paused.page,3);assert.equal(paused.pass,2);
  const retried=(await f.pool.query('SELECT status,failure_code FROM job_history_syncs WHERE user_id=$1',[f.stranger])).rows[0];
  assert.equal(retried.status,'queued');assert.equal(retried.failure_code,null);
  await f.pool.query('UPDATE access_memberships SET blocked=true WHERE user_id=$1',[f.stranger]);
  await f.pool.query("UPDATE job_history_syncs SET status='complete',updated_at=$1 WHERE user_id=$2",[f.clock.now,f.stranger]);
  f.clock.now=new Date(f.clock.now.getTime()+3600000);
  assert.equal(await f.runtime.historySync.scheduleDue(),0);
  await f.pool.query("UPDATE job_connections SET status='disconnected' WHERE user_id=$1",[f.owner]);
  await f.pool.query("UPDATE job_history_syncs SET status='complete',updated_at=$1 WHERE user_id=$2",[new Date(f.clock.now.getTime()-3600000),f.owner]);
  assert.equal(await f.runtime.historySync.scheduleDue(),0);
 }finally{await f.close();}
});

test('revocation or disconnection after claim blocks HH read before RPC dispatch',async()=>{
 const f=await historyFixture();try{
  assert.equal(await f.runtime.historySync.scheduleDue(),1);
  const run=await f.runtime.historySync.claim();
  let reads=0;
  const read=async()=>{reads++;return historyPage();};
  await f.pool.query("UPDATE job_connections SET status='disconnected' WHERE user_id=$1",[f.owner]);
  await assert.rejects(f.runtime.historySync.readPage({run,read}),{code:'JOB_HH_NOT_CONNECTED'});
  assert.equal(reads,0);
  await f.pool.query("UPDATE job_connections SET status='connected' WHERE user_id=$1",[f.owner]);
  await f.pool.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='telegram'",[f.owner]);
  await assert.rejects(f.runtime.historySync.readPage({run,read}),{code:'JOB_SCOPE_DENIED'});
  assert.equal(reads,0);
  assert.equal((await f.pool.query('SELECT status FROM job_history_syncs WHERE user_id=$1',[f.owner])).rows[0].status,'running');
 }finally{await f.close();}
});

test('history read dispatches under access lock, releases it during HH wait, and refuses revoked data',async()=>{
 const f=await historyFixture();try{
  await f.runtime.historySync.scheduleDue();
  const run=await f.runtime.historySync.claim();
  let started,release;
  const reading=new Promise(resolve=>{started=resolve;});
  const done=new Promise(resolve=>{release=resolve;});
  const pending=f.runtime.historySync.readPage({run,read:()=>{
   started();return done.then(()=>historyPage());
  }});
  let timeout;
  try{
   await reading;
   await Promise.race([
    jobTransaction(f.pool,c=>c.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='telegram'",[f.owner])),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Access lock stayed held during HH wait')),2000);}),
   ]);
  }finally{clearTimeout(timeout);release();}
  assert.equal((await pending).section,'active');
  await assert.rejects(f.runtime.historySync.applyPage({run,leaseId:run.lease_id,result:historyPage()}),{code:'JOB_SCOPE_DENIED'});
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_history_observations WHERE user_id=$1',[f.owner])).rows[0].n,0);
 }finally{await f.close();}
});
