const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Fastify=require('fastify');
const {createJobPostgresFixture}=require('./helpers/jobPostgresFixture');
const {AccessService}=require('../src/access/accessService');
const {JobResumeRepository}=require('../src/jobs/jobResumeRepository');
const {JobResumeService,INTERVAL}=require('../src/jobs/jobResumeService');
const {JobResumeWorker}=require('../src/jobs/jobResumeWorker');
const {registerMiniAppRoutes}=require('../src/miniApp/routes');
const {registerMiniAppSelfRoutes}=require('../src/miniAppSelfRoutes');
const {sessionCookie}=require('../src/miniApp/sessionService');
async function fixture() {
  const f=await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')",[f.owner]);
    const access=new AccessService({pool:f.pool,ownerTelegramId:'101'});await access.initialize();
    const owner=await access.getAccessForTelegram('101');
    const role=await access.mutate(owner.userId,'role.create',{operationId:randomUUID(),name:'Resume fixture',permissions:['jobs']});
    const member=await access.mutate(owner.userId,'user.create',{operationId:randomUUID(),telegramId:'303',displayName:'Resume member',level:'member',roleId:role.id});
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'ownerA','connected'),($2,'memberA','connected')",[owner.userId,member.userId]);
    const lists=new Map([[owner.userId,[{id:'ownerA',title:'Owner first',canRaise:true},{id:'ownerB',title:'Owner second',canRaise:true}]],
      [member.userId,[{id:'memberA',title:'Member first',canRaise:true}]]]);
    const selected=new Map([[owner.userId,'ownerA'],[member.userId,'memberA']]),reads=[],selections=[],raises=[];
    let nextOutcome='raised',lostSelection=false,clock=Date.now();
    const browserClient={resumeToken:'fixture-resume-capability',forUser(userId){return{
      async listResumes(){reads.push(userId);return structuredClone(lists.get(userId));},
      async selectResume({resumeId}){selections.push({userId,resumeId});selected.set(userId,resumeId);if(lostSelection){lostSelection=false;throw Error('Fixture response lost');}return{ok:true};},
      async connection(){return{resumeId:selected.get(userId),title:'Fixture'};},
      async raiseResume(input){raises.push({userId,...input});return{outcome:nextOutcome,...(nextOutcome==='unknown'?{}:{verified:true})};},
      async resumeRaiseStatus(){return{outcome:'raised',verified:true};},
    };}};
    const repository=new JobResumeRepository(f.pool,access),service=new JobResumeService({repository,browserClient,now:()=>clock});
    const worker=new JobResumeWorker({repository,service,browserClient,now:()=>clock});
    return{...f,access,owner,member,lists,selected,reads,selections,raises,repository,service,worker,
      advance(){clock+=INTERVAL+1000;},loseSelection(){lostSelection=true;},unknown(){nextOutcome='unknown';},
      input:async(userId,resumeId,autoRaiseEnabled=false)=>{const s=await service.get(userId);return{requestId:randomUUID(),expectedRevision:s.revision,connectionRevision:s.connectionRevision,resumeId,autoRaiseEnabled};}};
  }catch(e){await f.close();throw e;}
}
test('owned resume catalog, CAS selection, original-ID recovery and application invalidation use real PostgreSQL',async()=>{
  const f=await fixture();try {
    const {service,owner,member}=f;await service.refresh(owner.userId,randomUUID());await service.refresh(member.userId,randomUUID());
    assert.equal((await service.get(owner.userId)).resumes.length,2);assert.equal((await service.get(member.userId)).resumes[0].id,'memberA');
    const foreign=await f.input(owner.userId,'memberA');await assert.rejects(service.settings(owner.userId,foreign),{code:'JOB_LOGIN_RESUME_INVALID'});assert.equal(f.selections.length,0);
    const id=(await f.pool.query(`INSERT INTO job_confirmations(user_id,conversation_id,chat_id,channel,kind,target_id,frozen,expires_at)
      VALUES($1,$2,'101','telegram','apply',$3,'{}',now()+interval '10 minutes') RETURNING id`,[owner.userId,f.scope.conversationId,randomUUID()])).rows[0].id;
    const input=await f.input(owner.userId,'ownerB');f.loseSelection();
    assert.equal((await service.settings(owner.userId,input)).status,'unknown');assert.equal((await service.operation(owner.userId,input.requestId)).status,'complete');
    assert.equal((await service.settings(owner.userId,input)).status,'complete');assert.equal(f.selections.length,1);
    assert.equal((await service.get(owner.userId)).primaryResumeId,'ownerB');assert.equal((await service.get(member.userId)).primaryResumeId,'memberA');
    assert.equal((await f.pool.query('SELECT status FROM job_confirmations WHERE id=$1',[id])).rows[0].status,'stale');
    await assert.rejects(service.settings(owner.userId,{...input,resumeId:'ownerA'}),{code:'operation_conflict'});
    await assert.rejects(service.settings(owner.userId,{...input,requestId:randomUUID()}),{code:'revision_conflict'});
    await assert.rejects(service.operation(member.userId,input.requestId),{code:'operation_unknown'});
    f.lists.set(owner.userId,undefined);await assert.rejects(service.refresh(owner.userId,randomUUID()));
    assert.equal((await service.get(owner.userId)).resumes.length,2);assert.equal((await service.get(owner.userId)).lastError,'refresh_failed');
  }finally{await f.close();}
});
test('auto raise is explicit, personal, four-hour bounded, durable on unknown and stops after rights revocation',async()=>{
  const f=await fixture();try {
    const {owner,member,service,worker}=f;await service.get(owner.userId);await service.get(member.userId);
    await worker.tick();assert.equal(f.raises.length,0);
    await service.settings(owner.userId,await f.input(owner.userId,'ownerA',true));
    await Promise.all([worker.raiseOne(owner.userId),worker.raiseOne(owner.userId)]);assert.equal(f.raises.length,1);assert.equal(f.raises[0].resumeId,'ownerA');
    assert.equal((await service.get(owner.userId)).autoRaise.lastOutcome,'raised');
    await worker.raiseOne(owner.userId);assert.equal(f.raises.length,1);
    f.advance();f.unknown();await worker.raiseOne(owner.userId);assert.equal(f.raises.length,2);
    const state=await service.get(owner.userId);assert.equal(state.autoRaise.enabled,false);assert.equal(state.autoRaise.lastOutcome,'unknown');
    f.advance();await worker.raiseOne(owner.userId);assert.equal(f.raises.length,2);
    const blocked=await f.input(owner.userId,'ownerA',true);await assert.rejects(service.settings(owner.userId,blocked),{code:'operation_unknown'});
    assert.equal((await service.operation(owner.userId,state.autoRaise.lastOperationId)).status,'complete');
    assert.equal(f.raises.length,2);assert.equal((await service.get(owner.userId)).autoRaise.enabled,false);
    assert.equal((await service.get(owner.userId)).autoRaise.lastOutcome,'raised');
    const memberState=await f.access.getAccessForTelegram('303');await f.access.mutate(owner.userId,'user.update',
      {operationId:randomUUID(),revision:memberState.revision,overrides:{jobs:'deny'}},'303');
    const reads=f.reads.length;await assert.rejects(service.get(member.userId),{code:'JOB_SCOPE_DENIED'});
    await assert.rejects(service.refresh(member.userId,randomUUID()),{code:'JOB_SCOPE_DENIED'});assert.equal(f.reads.length,reads);
  }finally{await f.close();}
});
test('real Mini App routes bind selection to authenticated actor, origin and CSRF, never a supplied user ID',async()=>{
  const f=await fixture(),app=Fastify();const origin='https://mini.fixture';
  try {
    const routes=registerMiniAppRoutes(app,{config:{miniAppPublicOrigin:origin},pool:f.pool,accessService:f.access,
      registerUserRoutes:options=>registerMiniAppSelfRoutes(options,{pool:f.pool,accessService:f.access,getJobResumeService:()=>f.service})});
    await app.ready();const owner=await routes.sessions.create('101'),member=await routes.sessions.create('303');
    const headers={cookie:sessionCookie(owner.token).split(';')[0],origin,'x-jarvis-csrf':owner.csrfToken};
    assert.equal((await app.inject({method:'GET',url:'/mini/api/jobs/resumes'})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url:'/mini/api/jobs/resumes',headers})).statusCode,200);
    const payload=await f.input(f.owner.userId,'ownerB');
    assert.equal((await app.inject({method:'POST',url:'/mini/api/jobs/resumes/settings',headers:{...headers,origin:'https://foreign.test'},payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/mini/api/jobs/resumes/settings',headers:{...headers,'x-jarvis-csrf':''},payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/mini/api/jobs/resumes/settings',headers,payload:{...payload,userId:f.member.userId}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/mini/api/jobs/resumes/settings',headers,payload})).json().status,'complete');
    assert.equal((await app.inject({method:'GET',url:`/mini/api/jobs/resumes/operations/${payload.requestId}`,headers:{cookie:sessionCookie(member.token).split(';')[0]}})).statusCode,404);
    assert.equal((await f.service.get(f.member.userId)).primaryResumeId,'memberA');
  }finally{await app.close();await f.close();}
});
