const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { AccessService } = require('../src/access/accessService');
const { JobResumeRepository } = require('../src/jobs/jobResumeRepository');
const { JobResumeService, INTERVAL } = require('../src/jobs/jobResumeService');
const { JobResumeWorker } = require('../src/jobs/jobResumeWorker');

test('migration preserves previous explicit off and on choices without dispatching HH actions', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query('ALTER TABLE job_resume_managers DROP COLUMN auto_raise_policy_applied, DROP COLUMN auto_raise_preference');
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'ownerA','connected'),($2,'memberA','connected')",[f.owner,f.stranger]);
    await f.pool.query('INSERT INTO job_resume_managers(user_id,auto_raise_enabled,auto_raise_resume_id,next_raise_at) VALUES($1,false,NULL,NULL),($2,true,\'memberA\',now())',[f.owner,f.stranger]);
    for (const [userId,enabled] of [[f.owner,false],[f.stranger,true]]) {
      await f.pool.query(`INSERT INTO job_resume_operations(user_id,request_id,kind,status,payload,result)
        VALUES($1,$2,'settings','complete',$3,'{}')`,[userId,randomUUID(),{input:{autoRaiseEnabled:enabled}}]);
    }
    const migration=await readFile(path.join(__dirname,'../src/db/migrations/042_job_resume_defaults.sql'),'utf8');
    await f.pool.query(migration);
    const rows=(await f.pool.query('SELECT user_id,auto_raise_enabled,auto_raise_policy_applied,auto_raise_preference FROM job_resume_managers ORDER BY user_id')).rows;
    assert.equal(rows.length,2);
    assert.deepEqual(rows.find(r=>r.user_id===f.owner),{
      user_id:f.owner,auto_raise_enabled:false,auto_raise_policy_applied:true,auto_raise_preference:false,
    });
    assert.deepEqual(rows.find(r=>r.user_id===f.stranger),{
      user_id:f.stranger,auto_raise_enabled:true,auto_raise_policy_applied:true,auto_raise_preference:true,
    });
  } finally { await f.close(); }
});

test('connected resume gets one default free raise schedule; explicit off and unknown survive reads and restart', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const access = new AccessService({ pool:f.pool, ownerTelegramId:'101' });
    await access.initialize();
    const owner = await access.getAccessForTelegram('101');
    const role = await access.mutate(owner.userId,'role.create', { operationId:randomUUID(),name:'Resume defaults',permissions:['jobs'] });
    const member = await access.mutate(owner.userId,'user.create', {
      operationId:randomUUID(),telegramId:'303',displayName:'Resume member',level:'member',roleId:role.id,
    });
    const another = await access.mutate(owner.userId,'user.create', {
      operationId:randomUUID(),telegramId:'404',displayName:'Resume other',level:'member',roleId:role.id,
    });
    const pendingUser = await access.mutate(owner.userId,'user.create', {
      operationId:randomUUID(),telegramId:'505',displayName:'Resume pending',level:'member',roleId:role.id,
    });
    const unknownUser = await access.mutate(owner.userId,'user.create', {
      operationId:randomUUID(),telegramId:'606',displayName:'Resume unknown',level:'member',roleId:role.id,
    });
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'ownerA','connected'),($2,'memberA','connected'),($3,'otherA','connected'),($4,'pendingA','connected'),($5,'unknownA','connected')",
      [owner.userId,member.userId,another.userId,pendingUser.userId,unknownUser.userId]);
    await f.pool.query(`INSERT INTO job_resume_managers(user_id,last_outcome) VALUES($1,'unknown')`,[unknownUser.userId]);
    const pendingId=randomUUID();
    await f.pool.query(`INSERT INTO job_resume_operations(user_id,request_id,kind,status,payload) VALUES($1,$2,'settings','unknown','{}')`,
      [pendingUser.userId,pendingId]);
    const now = Date.now();
    const repository = new JobResumeRepository(f.pool,access,()=>now);
    const calls=[];
    let outcome='raised';
    const browserClient={ resumeToken:'synthetic', forUser(userId){ return {
      async listResumes(){ return [{id:userId===owner.userId?'ownerA':userId===member.userId?'memberA':'otherA',title:'Resume'}]; },
      async selectResume(){ return {ok:true}; },
      async connection(){ return {resumeId:'memberA'}; },
      async raiseResume(args){ calls.push([userId,args.operationId]); return {outcome,verified:outcome!=='unknown'}; },
      async resumeRaiseStatus(){ return {outcome:'unknown'}; },
    };}};
    const service = new JobResumeService({repository,browserClient,now:()=>now});
    const worker = new JobResumeWorker({repository,service,browserClient,now:()=>now});
    const initial = await service.get(owner.userId);
    assert.equal(initial.autoRaise.enabled,true);
    assert.equal(initial.autoRaise.resumeId,'ownerA');
    assert.ok(new Date(initial.autoRaise.nextAt).getTime() <= now);
    await service.get(owner.userId);
    assert.equal((await f.pool.query('SELECT revision FROM job_resume_managers WHERE user_id=$1',[owner.userId])).rows[0].revision,1);
    assert.equal((await service.get(pendingUser.userId)).autoRaise.enabled,false);
    assert.equal((await f.pool.query('SELECT auto_raise_policy_applied FROM job_resume_managers WHERE user_id=$1',[pendingUser.userId])).rows[0].auto_raise_policy_applied,false);
    await f.pool.query("UPDATE job_resume_operations SET status='failed' WHERE user_id=$1 AND request_id=$2",[pendingUser.userId,pendingId]);
    assert.equal((await service.get(pendingUser.userId)).autoRaise.enabled,true);
    assert.equal((await service.get(unknownUser.userId)).autoRaise.enabled,false);
    assert.equal((await f.pool.query('SELECT auto_raise_policy_applied FROM job_resume_managers WHERE user_id=$1',[unknownUser.userId])).rows[0].auto_raise_policy_applied,true);

    // An existing explicit "off" is a durable preference, even across worker startup.
    await service.settings(member.userId, {
      requestId:randomUUID(),expectedRevision:1,connectionRevision:1,resumeId:'memberA',autoRaiseEnabled:false,
    });
    await worker.recover();
    await service.get(member.userId);
    assert.equal((await service.get(member.userId)).autoRaise.enabled,false);
    assert.equal((await f.pool.query('SELECT auto_raise_preference FROM job_resume_managers WHERE user_id=$1',[member.userId])).rows[0].auto_raise_preference,false);

    await worker.raiseOne(owner.userId);
    assert.equal(calls.length,1);
    const after = await service.get(owner.userId);
    assert.equal(after.autoRaise.lastOutcome,'raised');
    assert.ok(new Date(after.autoRaise.nextAt).getTime() >= now+INTERVAL);
    await worker.raiseOne(owner.userId);
    assert.equal(calls.length,1);

    // Unknown action remains stopped after reads, refreshes, and a new worker.
    outcome='unknown';
    await worker.raiseOne(another.userId);
    assert.equal(calls.length,2);
    const restarted = new JobResumeWorker({repository,service,browserClient,now:()=>now});
    await restarted.recover();
    await service.get(another.userId);
    await service.refresh(another.userId,randomUUID());
    await restarted.raiseOne(another.userId);
    assert.equal(calls.length,2);
    assert.equal((await service.get(another.userId)).autoRaise.enabled,false);

    const memberAccess=await access.getAccessForTelegram('303');
    await access.mutate(owner.userId,'user.update', {operationId:randomUUID(),revision:memberAccess.revision,overrides:{jobs:'deny'}},'303');
    await assert.rejects(service.get(member.userId),{code:'JOB_SCOPE_DENIED'});
    await assert.rejects(worker.raiseOne(member.userId),{code:'JOB_SCOPE_DENIED'});
    assert.equal(calls.length,2);
  } finally { await f.close(); }
});
