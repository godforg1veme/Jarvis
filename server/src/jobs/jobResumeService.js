const { randomUUID, createHash } = require('node:crypto');
const { z } = require('zod');
const { jobError } = require('./jobSchemas');
const { resumeSchema,settingsInput,stamp } = require('./jobResumeRepository');
const INTERVAL=4*60*60*1000, REFRESH=15*60*1000;
const publicOperation=op=>({requestId:op.request_id,status:op.status,kind:op.kind,...(op.result?{result:op.result}:{})});
const inspectionInput=z.object({confirmed:z.literal(true),confirmationRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const inspectionRevision=(op,access)=>createHash('sha256').update(JSON.stringify([op.request_id,op.payload,stamp(access)])).digest('hex');
class JobResumeService {
  constructor({repository,browserClient,now=Date.now}) {this.repository=repository;this.browserClient=browserClient;this.now=now;}
  async get(userId) {
    return this.repository.transaction(userId,async c=>{
      const {connection,manager:m}=await this.repository.current(c,userId);
      const last=(await c.query("SELECT request_id FROM job_resume_operations WHERE user_id=$1 AND kind='raise' ORDER BY created_at DESC,request_id DESC LIMIT 1",[userId])).rows[0];
      return {connected:connection?.status==='connected',primaryResumeId:connection?.resume_id??null,connectionRevision:connection?.revision??0,
        revision:m.revision,resumes:z.array(resumeSchema).max(20).parse(m.resumes),updatedAt:m.refreshed_at,
        autoRaise:{enabled:m.auto_raise_enabled,resumeId:m.auto_raise_resume_id,nextAt:m.next_raise_at,lastAt:m.last_raise_at,lastOutcome:m.last_outcome,lastOperationId:last?.request_id??null},
        lastError:m.last_error,raiseAvailable:Boolean(this.browserClient.resumeToken)};
    });
  }
  async refresh(userId,requestId) {
    const claim=await this.repository.claim(userId,requestId,'refresh');
    if(!claim.fresh)return publicOperation(claim.operation);
    try {
      const resumes=z.array(resumeSchema).max(20).parse(await this.browserClient.forUser(userId).listResumes());
      await this.repository.transaction(userId,async(c,a)=>{
        if(stamp(a)!==claim.operation.payload.stamp)throw jobError('JOB_ACCESS_REVOKED');
        const {connection}=await this.repository.current(c,userId);
        if(connection?.status!=='connected'||connection.revision!==claim.connection.revision)throw jobError('revision_conflict');
        await c.query(`UPDATE job_resume_managers SET resumes=$2,refreshed_at=now(),next_refresh_at=$3,
          refresh_lease_until=NULL,last_error=NULL,updated_at=now() WHERE user_id=$1`,[userId,JSON.stringify(resumes),new Date(this.now()+REFRESH)]);
        await c.query(`UPDATE job_resume_operations SET status='complete',result='{}',completed_at=now() WHERE user_id=$1 AND request_id=$2`,[userId,requestId]);
      });
    } catch(e) {
      await this.repository.transaction(userId,async c=>{
        await c.query(`UPDATE job_resume_managers SET next_refresh_at=$2,refresh_lease_until=NULL,last_error='refresh_failed' WHERE user_id=$1`,[userId,new Date(this.now()+300000)]);
        await c.query(`UPDATE job_resume_operations SET status='failed',result='{}',completed_at=now() WHERE user_id=$1 AND request_id=$2`,[userId,requestId]);
      }).catch(()=>{});
      throw e;
    }
    return {requestId,status:'complete',kind:'refresh'};
  }
  async settings(userId,input) {
    input=settingsInput.parse(input);
    if(input.autoRaiseEnabled&&!this.browserClient.resumeToken)throw jobError('JOB_RESUME_RAISE_UNAVAILABLE');
    const claim=await this.repository.claim(userId,input.requestId,'settings',input);
    if(!claim.fresh)return this.operation(userId,input.requestId);
    let selectionStarted=false;
    try {
      // Stopping this user's current schedule is a local setting. It must
      // remain possible when HH is offline or the primary resume disappeared.
      if(!input.autoRaiseEnabled&&claim.connection.resume_id===input.resumeId) {
        await this.completeSettings(userId,claim.operation);
        return {requestId:input.requestId,status:'complete',kind:'settings'};
      }
      const list=z.array(resumeSchema).max(20).parse(await this.browserClient.forUser(userId).listResumes());
      if(!list.some(r=>r.id===input.resumeId))throw jobError('JOB_LOGIN_RESUME_INVALID');
      await this.repository.transaction(userId,async(c,a)=>{
        const {connection,manager}=await this.repository.current(c,userId);
        if(stamp(a)!==claim.operation.payload.stamp)throw jobError('JOB_ACCESS_REVOKED');
        if(connection?.revision!==input.connectionRevision||manager.revision!==input.expectedRevision)throw jobError('revision_conflict');
        if(input.autoRaiseEnabled && manager.last_outcome==='unknown')throw jobError('operation_unknown');
        // Serialize dispatch and its commit with permission revocation and a
        // concurrent primary change. The durable request was claimed above.
        selectionStarted=true;
        await this.browserClient.forUser(userId).selectResume({resumeId:input.resumeId});
        const selected=await this.browserClient.forUser(userId).connection();
        if(selected.resumeId!==input.resumeId)throw jobError('operation_unknown');
        await this.completeSettingsLocked(c,a,userId,claim.operation);
      });
    } catch(e) {
      await this.repository.finish(userId,input.requestId,selectionStarted?'unknown':'failed').catch(()=>{});
      if(selectionStarted)return {requestId:input.requestId,status:'unknown',kind:'settings'};
      throw e;
    }
    return {requestId:input.requestId,status:'complete',kind:'settings'};
  }
  async completeSettings(userId,op) {
    return this.repository.transaction(userId,(c,a)=>this.completeSettingsLocked(c,a,userId,op));
  }
  async completeSettingsLocked(c,a,userId,op) {
    const input=op.payload.input;
      if(stamp(a)!==op.payload.stamp)throw jobError('JOB_ACCESS_REVOKED');
      const {connection,manager}=await this.repository.current(c,userId);
      const fresh=(await c.query('SELECT status FROM job_resume_operations WHERE user_id=$1 AND request_id=$2',[userId,op.request_id])).rows[0];
      if(fresh?.status==='complete')return;
      if(connection?.revision!==input.connectionRevision||manager.revision!==input.expectedRevision)throw jobError('revision_conflict');
      if(input.autoRaiseEnabled&&manager.last_outcome==='unknown')throw jobError('operation_unknown');
      if(connection.resume_id!==input.resumeId) {
        await c.query(`UPDATE job_connections SET resume_id=$2,revision=revision+1,updated_at=now() WHERE user_id=$1`,[userId,input.resumeId]);
        await c.query("UPDATE job_confirmations SET status='stale' WHERE user_id=$1 AND kind='apply' AND status='pending'",[userId]);
      }
      const next=Math.max(this.now(),manager.last_raise_at?new Date(manager.last_raise_at).getTime()+INTERVAL:0);
      await c.query(`UPDATE job_resume_managers SET revision=revision+1,auto_raise_enabled=$2,auto_raise_resume_id=$3,
        next_raise_at=$4,auto_raise_preference=$2,auto_raise_policy_applied=true,updated_at=now() WHERE user_id=$1`,
        [userId,input.autoRaiseEnabled,input.resumeId,input.autoRaiseEnabled?new Date(next):null]);
      await c.query(`UPDATE job_resume_operations SET status='complete',result='{}',completed_at=now() WHERE user_id=$1 AND request_id=$2`,[userId,op.request_id]);
  }
  async operation(userId,requestId) {
    let op=await this.repository.status(userId,requestId);
    if(op.kind==='refresh'&&op.status==='working'&&this.now()-new Date(op.created_at).getTime()>120000) {
      await this.repository.finish(userId,requestId,'failed');op=await this.repository.status(userId,requestId);
    }
    if(op.kind==='settings'&&(op.status==='unknown'||op.status==='working'&&this.now()-new Date(op.created_at).getTime()>120000)) {
      const changed=await this.repository.transaction(userId,async(_c,a)=>stamp(a)!==op.payload.stamp);
      // A role revision is not evidence that HH rejected the original write.
      // Keep the original request blocked until its target is verified.
      if(changed){
        if(op.status==='working'){await this.repository.finish(userId,requestId,'unknown');op=await this.repository.status(userId,requestId);}
        return publicOperation(op);
      }
    }
    if(op.kind==='settings'&&(op.status==='unknown'||op.status==='working'&&this.now()-new Date(op.created_at).getTime()>120000)) {
      const localOff=await this.repository.transaction(userId,async c=>{
        const {connection}=await this.repository.current(c,userId);
        return op.payload.input.autoRaiseEnabled===false&&connection?.status==='connected'
          && connection.resume_id===op.payload.input.resumeId&&connection.revision===op.payload.input.connectionRevision;
      });
      if(localOff){await this.completeSettings(userId,op);return publicOperation(await this.repository.status(userId,requestId));}
      // Read the original operation's selected target; never reissue select_resume.
      const selected=await this.browserClient.forUser(userId).connection().catch(()=>null);
      if(selected?.resumeId===op.payload.input.resumeId) {
        await this.completeSettings(userId,op);op=await this.repository.status(userId,requestId);
      }
    }
    if(op.kind==='raise'&&(op.status==='unknown'||op.status==='working'&&this.now()-new Date(op.created_at).getTime()>120000)) {
      const result=await this.browserClient.forUser(userId).resumeRaiseStatus({operationId:requestId,resumeId:op.payload.input.resumeId}).catch(()=>({outcome:'unknown'}));
      if(result.outcome!=='unknown') {
        await this.repository.transaction(userId,async c=>{
          await c.query(`UPDATE job_resume_operations SET status='complete',result=$3,completed_at=now() WHERE user_id=$1 AND request_id=$2 AND status IN ('working','unknown')`,[userId,requestId,result]);
          const last=(await c.query("SELECT request_id FROM job_resume_operations WHERE user_id=$1 AND kind='raise' ORDER BY created_at DESC,request_id DESC LIMIT 1",[userId])).rows[0];
          if(last?.request_id===requestId)await c.query(`UPDATE job_resume_managers SET last_outcome=$2,last_error=NULL,
            last_raise_at=CASE WHEN $2='raised' THEN $3::timestamptz ELSE last_raise_at END WHERE user_id=$1`,
            [userId,result.outcome,result.nextAllowedAt?new Date(Date.parse(result.nextAllowedAt)-INTERVAL):op.created_at]);
        });
        op=await this.repository.status(userId,requestId);
      }
    }
    return publicOperation(op);
  }
  async inspectOperation(userId, requestId) {
    // Reconcile only the original operation. This never dispatches select/raise.
    await this.operation(userId, requestId);
    return this.repository.transaction(userId, async (db, access) => {
      const op = (await db.query('SELECT * FROM job_resume_operations WHERE user_id=$1 AND request_id=$2', [userId, requestId])).rows[0];
      if (!op) throw jobError('operation_unknown');
      const input = op.payload?.input || {};
      const {connection,manager} = await this.repository.current(db,userId);
      const target = Array.isArray(manager?.resumes) ? manager.resumes.find((r) => r.id === input.resumeId) : null;
      const accessChanged=op.kind==='settings'&&stamp(access)!==op.payload?.stamp;
      let selectionVerified=false;
      if(accessChanged&&op.status==='unknown'&&connection?.status==='connected'
        &&connection.revision===input.connectionRevision&&manager.revision===input.expectedRevision) {
        const selected=await this.browserClient.forUser(userId).connection().catch(()=>null);
        selectionVerified=Boolean(selected?.resumeId===input.resumeId);
      }
      return { ...publicOperation(op), inspection: {
        requestId, kind: op.kind, targetResumeId: typeof input.resumeId === 'string' ? input.resumeId : null,
        targetTitle: typeof target?.title === 'string' ? target.title.slice(0, 500) : null,
        autoRaiseEnabled: typeof input.autoRaiseEnabled === 'boolean' ? input.autoRaiseEnabled : null,
        accessChanged,selectionVerified,
        confirmationRevision:selectionVerified?inspectionRevision(op,access):null,
        retryDispatched: false,
      } };
    });
  }
  async confirmInspection(userId,requestId,input) {
    z.uuid().parse(requestId);input=inspectionInput.parse(input);
    return this.repository.transaction(userId,async(db,access)=>{
      const op=(await db.query('SELECT * FROM job_resume_operations WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[userId,requestId])).rows[0];
      if(op?.kind==='settings'&&op.status==='complete')return publicOperation(op);
      if(!op||op.kind!=='settings'||op.status!=='unknown')throw jobError('operation_unknown');
      if(stamp(access)===op.payload?.stamp||inspectionRevision(op,access)!==input.confirmationRevision)throw jobError('revision_conflict');
      const {connection,manager}=await this.repository.current(db,userId);
      const original=op.payload.input;
      if(connection?.status!=='connected'||connection.revision!==original.connectionRevision
        ||manager.revision!==original.expectedRevision)throw jobError('revision_conflict');
      const selected=await this.browserClient.forUser(userId).connection().catch(()=>null);
      if(selected?.resumeId!==original.resumeId)throw jobError('operation_unknown');
      // The fresh, explicit confirmation authorizes a local commit under the
      // current role. Preserve the original durable request and its payload.
      await this.completeSettingsLocked(db,access,userId,{...op,payload:{...op.payload,stamp:stamp(access)}});
      await db.query("UPDATE job_resume_operations SET result=$3 WHERE user_id=$1 AND request_id=$2",[userId,requestId,{reconciledAfterAccessChange:true}]);
      return {requestId,status:'complete',kind:'settings',result:{reconciledAfterAccessChange:true}};
    });
  }
  async refreshDue() {
    await this.repository.pool.query(`INSERT INTO job_resume_managers(user_id) SELECT user_id FROM job_connections
      WHERE status='connected' ON CONFLICT DO NOTHING`);
    const due=(await this.repository.pool.query(`UPDATE job_resume_managers m SET refresh_lease_until=now()+interval '2 minutes'
      WHERE m.user_id IN (SELECT x.user_id FROM job_resume_managers x JOIN job_connections c ON c.user_id=x.user_id
      WHERE c.status='connected' AND x.next_refresh_at<=now() AND (x.refresh_lease_until IS NULL OR x.refresh_lease_until<now())
      ORDER BY x.next_refresh_at LIMIT 5 FOR UPDATE OF x SKIP LOCKED) RETURNING m.user_id`)).rows;
    for(const row of due)await this.refresh(row.user_id,randomUUID()).catch(async error=>{
      if(error?.code==='JOB_SCOPE_DENIED')await this.repository.pool.query(`UPDATE job_resume_managers SET next_refresh_at=$2,
        refresh_lease_until=NULL,last_error='access_denied' WHERE user_id=$1`,[row.user_id,new Date(this.now()+REFRESH)]);
    });
  }
}
module.exports={JobResumeService,INTERVAL,REFRESH};
