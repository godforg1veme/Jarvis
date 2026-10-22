const { z } = require('zod');
const { isDeepStrictEqual } = require('node:util');
const { jobError, assertUserJobAccess } = require('./jobSchemas');
const resumeId = z.string().regex(/^[a-zA-Z0-9]{1,100}$/);
const resumeSchema = z.object({ id:resumeId, title:z.string().trim().min(1).max(500), canRaise:z.boolean().optional() }).strict();
const settingsInput = z.object({ requestId:z.uuid(), expectedRevision:z.number().int().positive(), connectionRevision:z.number().int().positive(),
  resumeId, autoRaiseEnabled:z.boolean() }).strict();
const stamp = a => JSON.stringify([a.userId,a.revision,a.roleId??null,a.roleRevision??0]);
class JobResumeRepository {
  constructor(pool,accessService) { this.pool=pool; this.accessService=accessService; }
  async transaction(userId,fn) {
    z.uuid().parse(userId);const c=await this.pool.connect();
    try { await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
      const access=await assertUserJobAccess(c,this.accessService,userId);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`job-owner:${userId}`]);
      const result=await fn(c,access);await c.query('COMMIT');return result;
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async current(c,userId) {
    const connection=(await c.query('SELECT resume_id,status,revision FROM job_connections WHERE user_id=$1',[userId])).rows[0];
    await c.query('INSERT INTO job_resume_managers(user_id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
    const manager=(await c.query('SELECT * FROM job_resume_managers WHERE user_id=$1',[userId])).rows[0];
    return {connection,manager};
  }
  async claim(userId,requestId,kind,payload={}) {
    z.uuid().parse(requestId);
    return this.transaction(userId,async(c,access)=>{
      const old=(await c.query('SELECT * FROM job_resume_operations WHERE user_id=$1 AND request_id=$2',[userId,requestId])).rows[0];
      if(old) {
        if(old.kind!==kind || !isDeepStrictEqual(old.payload.input??{},payload)) throw jobError('operation_conflict');
        return {fresh:false,operation:old};
      }
      const {connection,manager}=await this.current(c,userId);
      if(connection?.status!=='connected')throw jobError('JOB_HH_NOT_CONNECTED');
      if(kind==='settings') {
        if(manager.revision!==payload.expectedRevision || connection.revision!==payload.connectionRevision)throw jobError('revision_conflict');
        const pending=await c.query("SELECT 1 FROM job_resume_operations WHERE user_id=$1 AND kind='settings' AND status IN ('working','unknown')",[userId]);
        if(pending.rowCount)throw jobError('operation_unknown');
      }
      const operation=(await c.query(`INSERT INTO job_resume_operations(user_id,request_id,kind,status,payload)
        VALUES($1,$2,$3,'working',$4) RETURNING *`,[userId,requestId,kind,{input:payload,stamp:stamp(access),connectionRevision:connection.revision}])).rows[0];
      return {fresh:true,operation,connection,manager};
    });
  }
  async status(userId,requestId) {
    z.uuid().parse(requestId);return this.transaction(userId,async c=>{
      const op=(await c.query('SELECT * FROM job_resume_operations WHERE user_id=$1 AND request_id=$2',[userId,requestId])).rows[0];
      if(!op)throw jobError('operation_unknown');return op;
    });
  }
  async finish(userId,requestId,status,result={}) {
    return this.transaction(userId,c=>c.query(`UPDATE job_resume_operations SET status=$3,result=$4,completed_at=now()
      WHERE user_id=$1 AND request_id=$2 AND status IN ('working','unknown')`,[userId,requestId,status,result]));
  }
}
module.exports={JobResumeRepository,resumeSchema,settingsInput,stamp};
