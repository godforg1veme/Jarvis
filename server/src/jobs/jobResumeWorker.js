const { randomUUID } = require('node:crypto');
const { trackWorker } = require('../lifecycle');
const { stamp } = require('./jobResumeRepository');
const { INTERVAL } = require('./jobResumeService');
class JobResumeWorker {
  constructor({service,repository,browserClient,now=Date.now,intervalMs=30000,report=()=>{}}) {
    Object.assign(this,{service,repository,browserClient,now,intervalMs,report});this.timer=null;this.running=false;trackWorker(this,'tick');
  }
  async recover() {
    // A process may have died after persisting intent but before saving receipt.
    // Never turn that record into a fresh raise operation.
    await this.repository.pool.query(`WITH interrupted AS (UPDATE job_resume_operations SET status='unknown',completed_at=now()
      WHERE kind='raise' AND status='working' RETURNING user_id)
      UPDATE job_resume_managers SET auto_raise_enabled=false,next_raise_at=NULL,last_outcome='unknown',last_error='operation_unknown'
      WHERE user_id IN (SELECT user_id FROM interrupted)`);
  }
  async raiseOne(userId) {
    // Hold the same access lock as revocation while dispatching this bounded
    // external mutation. Changing permissions cannot overtake an approved raise.
    let op;
    await this.repository.transaction(userId,async(c,access)=>{
      const {connection,manager:m}=await this.repository.current(c,userId);
      if(connection?.status!=='connected'||!m.auto_raise_enabled||!m.next_raise_at||new Date(m.next_raise_at).getTime()>this.now())return;
      const pending=await c.query("SELECT 1 FROM job_resume_operations WHERE user_id=$1 AND kind IN ('settings','raise') AND status IN ('working','unknown')",[userId]);
      if(pending.rowCount)return;
      if(connection.resume_id!==m.auto_raise_resume_id) {
        await c.query("UPDATE job_resume_managers SET auto_raise_enabled=false,next_raise_at=NULL,last_error='resume_missing' WHERE user_id=$1",[userId]);return;
      }
      const requestId=randomUUID();
      op=(await c.query(`INSERT INTO job_resume_operations(user_id,request_id,kind,status,payload)
        VALUES($1,$2,'raise','working',$3) RETURNING *`,[userId,requestId,{input:{resumeId:connection.resume_id},stamp:stamp(access),connectionRevision:connection.revision,managerRevision:m.revision}])).rows[0];
      await c.query('UPDATE job_resume_managers SET next_raise_at=$2 WHERE user_id=$1',[userId,new Date(this.now()+INTERVAL)]);
    });
    if(!op)return;
    try {
      await this.repository.transaction(userId,async(c,access)=>{
        const {connection,manager:m}=await this.repository.current(c,userId);
        const current=(await c.query('SELECT status FROM job_resume_operations WHERE user_id=$1 AND request_id=$2',[userId,op.request_id])).rows[0];
        if(current?.status!=='working')return;
        if(stamp(access)!==op.payload.stamp||!m.auto_raise_enabled||m.revision!==op.payload.managerRevision
          ||connection?.revision!==op.payload.connectionRevision||connection.resume_id!==op.payload.input.resumeId) {
          await c.query("UPDATE job_resume_operations SET status='failed',result='{}',completed_at=now() WHERE user_id=$1 AND request_id=$2",[userId,op.request_id]);return;
        }
        let result;
        try { result=await this.browserClient.forUser(userId).raiseResume({operationId:op.request_id,resumeId:op.payload.input.resumeId}); }
        catch { result={outcome:'unknown'}; }
        const unknown=result.outcome==='unknown';
        const next=Math.max(this.now()+INTERVAL,Number.isFinite(Date.parse(result.nextAllowedAt))?Date.parse(result.nextAllowedAt):0);
        await c.query(`UPDATE job_resume_operations SET status=$3,result=$4,completed_at=now() WHERE user_id=$1 AND request_id=$2`,
          [userId,op.request_id,unknown?'unknown':'complete',result]);
        await c.query(`UPDATE job_resume_managers SET auto_raise_enabled=CASE WHEN $2 THEN false ELSE auto_raise_enabled END,
          next_raise_at=CASE WHEN $2 THEN NULL ELSE $3::timestamptz END,last_outcome=$4,last_raise_at=CASE WHEN $4='raised' THEN now() ELSE last_raise_at END,
          last_error=CASE WHEN $2 THEN 'operation_unknown' ELSE NULL END,updated_at=now() WHERE user_id=$1`,[userId,unknown,new Date(next),result.outcome]);
      });
    } catch {
      // If current access was revoked, no read/write is admitted by transaction().
      // Persist a closed interruption without invoking the browser again.
      await this.repository.pool.query(`UPDATE job_resume_operations SET status='unknown',completed_at=now()
        WHERE user_id=$1 AND request_id=$2 AND status='working'`,[userId,op.request_id]);
      await this.repository.pool.query(`UPDATE job_resume_managers SET auto_raise_enabled=false,next_raise_at=NULL,last_outcome='unknown',
        last_error='operation_unknown' WHERE user_id=$1`,[userId]);
    }
  }
  async tick() {
    if(this.running)return;this.running=true;
    try {
      await this.service.refreshDue();
      if(!this.browserClient.resumeToken)return;
      const due=(await this.repository.pool.query(`SELECT user_id FROM job_resume_managers WHERE auto_raise_enabled AND next_raise_at<=now()
        ORDER BY next_raise_at LIMIT 5`)).rows;
      for(const row of due)await this.raiseOne(row.user_id).catch(()=>{});
    } finally {this.running=false;}
  }
  async start() {await this.recover();if(!this.timer){this.timer=setInterval(()=>{void this.tick().catch(()=>this.report('JOB_RESUME_WORKER_UNAVAILABLE'));},this.intervalMs);this.timer.unref?.();}}
  stop() {clearInterval(this.timer);this.timer=null;}
}
module.exports={JobResumeWorker};
