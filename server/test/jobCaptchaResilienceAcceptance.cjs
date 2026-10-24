const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobCaptchaRepository } = require('../src/jobs/jobCaptchaRepository');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

async function fixture() {
  const f=await createJobPostgresFixture();
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')",[f.owner]);
  const accessService=configuredOwnerJobAccess(f.pool,'101');
  const repository=new JobCaptchaRepository(f.pool,{accessService}),search=new JobSearchRepository(f.pool,{accessService});
  await search.ensure({scope:f.scope}); return {...f,repository,search,accessService};
}
const challenge=()=>({challengeId:randomUUID(),revision:3,expiresAt:new Date(Date.now()+600000).toISOString()});
test('PG durable request acknowledgement preserves concurrent refresh and auto errors do not override clicks',async()=>{
  const f=await fixture();try{
    await f.repository.request(f.scope,true);const first=await f.repository.getRequest(f.scope);
    await f.repository.request(f.scope,false);const second=await f.repository.getRequest(f.scope);
    assert.notEqual(first.request_id,second.request_id);assert.equal(second.refresh_requested,true);
    await f.repository.ackRequest(f.scope,first.request_id);assert.deepEqual(await f.repository.getRequest(f.scope),second);
    assert.deepEqual(await f.repository.ensureRequest(f.scope),second);
    await assert.rejects(f.repository.getRequest({...f.scope,userId:f.stranger}));
    await f.repository.ackRequest(f.scope,second.request_id);assert.equal(await f.repository.getRequest(f.scope),null);
  }finally{await f.close();}
});
test('PG refresh invalidates old reply immediately, stale request cannot claim; unknown leases never resend',async()=>{
  const f=await fixture();try{
    const old=challenge();await f.repository.enqueue(f.scope,old);
    const photo=await f.repository.claim(f.scope,old.challengeId);await f.repository.delivered(f.scope,photo.id,500,'sent');
    await f.repository.request(f.scope,true);assert.equal(await f.repository.consume(f.scope,'500'),undefined);
    const request=await f.repository.getRequest(f.scope),next=challenge();await f.repository.enqueue(f.scope,next);
    assert.equal(await f.repository.claim(f.scope,next.challengeId),undefined,'new request prevents an earlier tick from sending');
    const fresh=await f.repository.claim(f.scope,next.challengeId,request.request_id);assert.ok(fresh);
    await f.pool.query("UPDATE job_captcha_photos SET lease_until=now()-interval '1 second' WHERE id=$1",[fresh.id]);
    await f.repository.recover(f.scope);assert.equal(await f.repository.hasUnknownDelivery(f.scope),'unknown');
    assert.equal(await f.repository.claim(f.scope,next.challengeId,request.request_id),undefined);
    await f.repository.request(f.scope,true);assert.equal(await f.repository.hasUnknownDelivery(f.scope),null);
  }finally{await f.close();}
});
test('PG retries use original photo and bounded attempts; unknown answer blocks until explicit refresh',async()=>{
  const f=await fixture();try{
    const c=challenge();await f.repository.enqueue(f.scope,c);
    let p=await f.repository.claim(f.scope,c.challengeId);await f.repository.delivered(f.scope,p.id,null,'queued',30000);
    assert.equal(await f.repository.claim(f.scope,c.challengeId),undefined);
    await f.pool.query('UPDATE job_captcha_photos SET available_at=now() WHERE id=$1',[p.id]);
    const retried=await f.repository.claim(f.scope,c.challengeId);assert.equal(retried.id,p.id);assert.equal(retried.attempts,2);
    await f.repository.delivered(f.scope,p.id,501,'sent');const answer=await f.repository.consume(f.scope,'501');
    assert.equal(await f.repository.hasUnknownDelivery(f.scope),'answer_sending');
    await f.repository.finish(f.scope,answer.operation_id,'unknown');assert.equal(await f.repository.hasUnknownDelivery(f.scope),'answer_unknown');
    await f.repository.request(f.scope,false);assert.equal(await f.repository.hasUnknownDelivery(f.scope),'answer_unknown');
    await f.repository.request(f.scope,true);assert.equal(await f.repository.hasUnknownDelivery(f.scope),null);
    assert.equal(await f.repository.consume(f.scope,'501'),undefined);
  }finally{await f.close();}
});
test('PG notices deduplicate, send with paused search and reject changed conversation before delivery',async()=>{
  const f=await fixture();let sends=0;try{
    const deliveries=new JobDeliveryRepository(f.pool,{accessService:f.accessService});
    await f.repository.request(f.scope,false); const requestId=(await f.repository.getRequest(f.scope)).request_id;
    const worker=new JobDeliveryWorker({pool:f.pool,accessService:f.accessService,searchRepository:f.search,deliveryRepository:deliveries,send:async view=>{sends++;assert.equal(view.chatId,'101');assert.match(view.answer,/Не удалось подготовить/);return{message_id:601};}});
    await f.repository.notify(f.scope,'PREPARATION_DELAYED',requestId);await f.repository.notify(f.scope,'PREPARATION_DELAYED',requestId);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_deliveries')).rows[0].n,1);
    await worker.tick();assert.equal(sends,1);
    await f.repository.notify(f.scope,'PHOTO_UNKNOWN',requestId);
    const claimed = await deliveries.claim();
    assert.ok(claimed);
    const originalClaim = deliveries.claim.bind(deliveries);
    deliveries.claim = async () => { deliveries.claim = originalClaim; return claimed; };
    const other=(await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','102') RETURNING id",[f.owner])).rows[0].id;
    await f.pool.query("UPDATE job_searches SET conversation_id=$1,chat_id='102' WHERE user_id=$2",[other,f.owner]);
    await worker.tick();assert.equal(sends,1);
    assert.equal((await f.pool.query("SELECT status FROM job_deliveries WHERE payload->>'code'='PHOTO_UNKNOWN'")).rows[0].status,'failed');
    await assert.rejects(f.repository.notify({...f.scope,userId:f.stranger},'PHOTO_UNKNOWN'));
    await f.pool.query('UPDATE job_searches SET conversation_id=$1,chat_id=$2 WHERE user_id=$3',[f.scope.conversationId,f.scope.chatId,f.owner]);
    await f.pool.query('DELETE FROM user_identities WHERE user_id=$1',[f.owner]);
    await assert.rejects(f.repository.notify(f.scope,'PHOTO_FAILED',requestId),{code:'JOB_SCOPE_DENIED'});await worker.tick();assert.equal(sends,1,'revoked identity cannot receive notices');
  }finally{await f.close();}
});
test('PG recovery removes pending delay notice and explicit refresh retires obsolete queued notices',async()=>{
  const f=await fixture();try{
    await f.repository.request(f.scope,false);const request=(await f.repository.getRequest(f.scope)).request_id;
    await f.repository.notify(f.scope,'PREPARATION_DELAYED',request);
    await f.repository.ackRequest(f.scope,request);
    assert.equal((await f.pool.query('SELECT status FROM job_deliveries')).rows[0].status,'failed');
    await f.repository.notify(f.scope,'REFRESH_REQUIRED');await f.repository.request(f.scope,true);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM job_deliveries WHERE status='queued'")).rows[0].n,0);
  }finally{await f.close();}
});
test('PG notice retries a transient scope lookup failure before send, without confusing it with revoked scope',async()=>{
  const f=await fixture();let sends=0;try{
    await f.repository.notify(f.scope,'PHOTO_FAILED',randomUUID());
    const worker=new JobDeliveryWorker({pool:{query:async(...args)=>{
      if(String(args[0]).includes('user_identities'))throw Object.assign(Error('fixture connection lost'),{code:'08006'});
      return f.pool.query(...args);
    }},accessService:f.accessService,searchRepository:f.search,deliveryRepository:new JobDeliveryRepository(f.pool,{accessService:f.accessService}),send:async()=>{sends++;return{message_id:701};}});
    await worker.tick();assert.equal(sends,0);
    assert.equal((await f.pool.query('SELECT status FROM job_deliveries')).rows[0].status,'queued');
    await f.pool.query('UPDATE job_deliveries SET available_at=now()');worker.pool=f.pool;
    await worker.tick();assert.equal(sends,1);
    assert.equal((await f.pool.query('SELECT status FROM job_deliveries')).rows[0].status,'sent');
  }finally{await f.close();}
});
