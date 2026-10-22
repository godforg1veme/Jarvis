const {assertJobScope,assertUserJobAccess,jobError}=require('./jobSchemas');
const {jobTransaction}=require('./jobTransaction');
const {historySchema}=require('./jobHistorySchema');
class JobHistorySyncRepository{
  constructor(pool,history,{now=()=>new Date(),accessService=null}={}){Object.assign(this,{pool,history,now,accessService});}
  async state(scope){await assertJobScope(this.pool,scope,this.accessService);return(await this.pool.query('SELECT * FROM job_history_syncs WHERE user_id=$1',[scope.userId])).rows[0]||null;}
  async scheduleDue(){
    const now=this.now();
    const candidates=(await this.pool.query(`SELECT j.user_id,x.id AS conversation_id,i.external_id AS chat_id
      FROM job_connections j
      JOIN user_identities i ON i.user_id=j.user_id AND i.provider='telegram' AND i.external_id ~ '^[1-9][0-9]{0,19}$'
      JOIN conversations x ON x.user_id=j.user_id AND x.channel='telegram' AND x.external_chat_id=i.external_id
      LEFT JOIN job_history_syncs s ON s.user_id=j.user_id
      WHERE j.status='connected' AND j.resume_id IS NOT NULL
        AND (s.user_id IS NULL OR (s.status IN ('complete','incomplete','failed') AND s.updated_at<=$1::timestamptz-interval '1 hour'))
      ORDER BY j.user_id,x.created_at,x.id`,[now])).rows;
    let scheduled=0;
    const seen=new Set();
    for(const candidate of candidates){
      if(seen.has(candidate.user_id))continue;
      seen.add(candidate.user_id);
      try{
        const queued=await jobTransaction(this.pool,async c=>{
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`job-history:${candidate.user_id}`]);
          const scope={userId:candidate.user_id,conversationId:candidate.conversation_id,chatId:candidate.chat_id,channel:'telegram'};
          await assertJobScope(c,scope,this.accessService);
          if(!(await c.query("SELECT 1 FROM job_connections WHERE user_id=$1 AND status='connected' AND resume_id IS NOT NULL",[scope.userId])).rowCount)return false;
          const old=(await c.query('SELECT * FROM job_history_syncs WHERE user_id=$1 FOR UPDATE',[scope.userId])).rows[0];
          if(old&&(old.status==='queued'||old.status==='running'||old.status==='paused'||old.updated_at>new Date(now.getTime()-3600000)))return false;
          await c.query(`INSERT INTO job_history_syncs(user_id,conversation_id,chat_id,next_attempt_at,started_at)
            VALUES($1,$2,$3,$4,$4) ON CONFLICT(user_id) DO UPDATE SET conversation_id=excluded.conversation_id,chat_id=excluded.chat_id,
            run_id=gen_random_uuid(),status='queued',section='active',page=0,pass=1,pages_read=0,expected_total=NULL,expected_pages=NULL,
            seen_ids='[]',lease_id=NULL,lease_until=NULL,attempts=0,failure_code=NULL,next_attempt_at=$4,started_at=$4,updated_at=$4`,
          [scope.userId,scope.conversationId,scope.chatId,now]);
          return true;
        });
        if(queued)scheduled++;
      }catch(error){if(error?.code!=='JOB_SCOPE_DENIED')throw error;}
    }
    return scheduled;
  }
  async request({scope,firstOnly=false}){
    return jobTransaction(this.pool,async c=>{await assertJobScope(c,scope,this.accessService);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`job-history:${scope.userId}`]);
      const connection=(await c.query("SELECT 1 FROM job_connections WHERE user_id=$1 AND status='connected' AND resume_id IS NOT NULL",[scope.userId])).rowCount;
      if(!connection)throw jobError('JOB_HH_NOT_CONNECTED');
      const old=(await c.query('SELECT * FROM job_history_syncs WHERE user_id=$1 FOR UPDATE',[scope.userId])).rows[0];
      if(old&&(firstOnly||['queued','running'].includes(old.status)))return old;
      if(old?.status==='paused')return(await c.query(`UPDATE job_history_syncs SET status='queued',next_attempt_at=$2,updated_at=$2 WHERE user_id=$1 RETURNING *`,[scope.userId,this.now()])).rows[0];
      return(await c.query(`INSERT INTO job_history_syncs(user_id,conversation_id,chat_id,next_attempt_at,started_at)
        VALUES($1,$2,$3,$4,$4) ON CONFLICT(user_id) DO UPDATE SET conversation_id=excluded.conversation_id,chat_id=excluded.chat_id,
        run_id=gen_random_uuid(),status='queued',section='active',page=0,pass=1,pages_read=0,expected_total=NULL,expected_pages=NULL,
        seen_ids='[]',lease_id=NULL,lease_until=NULL,attempts=0,failure_code=NULL,next_attempt_at=$4,started_at=$4,updated_at=$4 RETURNING *`,
      [scope.userId,scope.conversationId,scope.chatId,this.now()])).rows[0];});
  }
  async claim(){
    return jobTransaction(this.pool,async c=>{
      for(;;){
        const candidates=(await c.query(`SELECT s.* FROM job_history_syncs s
        JOIN conversations x ON x.id=s.conversation_id AND x.user_id=s.user_id AND x.channel='telegram' AND x.external_chat_id=s.chat_id
        JOIN user_identities i ON i.user_id=s.user_id AND i.provider='telegram' AND i.external_id=s.chat_id
        JOIN job_connections j ON j.user_id=s.user_id AND j.status='connected' AND j.resume_id IS NOT NULL
        WHERE s.status IN('queued','running','paused') AND s.next_attempt_at<=$1 AND (s.lease_until IS NULL OR s.lease_until<$1)
        ORDER BY s.next_attempt_at,s.user_id LIMIT 50 FOR UPDATE OF s SKIP LOCKED`,[this.now()])).rows;
        if(!candidates.length)return null;
      for(const candidate of candidates){
        try{await assertUserJobAccess(c,this.accessService,candidate.user_id);}
        catch(error){
          if(error?.code!=='JOB_SCOPE_DENIED')throw error;
          await c.query("UPDATE job_history_syncs SET status='failed',failure_code='JOB_ACCESS_REVOKED',lease_id=NULL,lease_until=NULL,updated_at=$2 WHERE user_id=$1 AND run_id=$3",
            [candidate.user_id,this.now(),candidate.run_id]);
          continue;
        }
        return(await c.query(`UPDATE job_history_syncs SET status='running',lease_id=gen_random_uuid(),lease_until=$2::timestamptz+interval '2 minutes'
          WHERE user_id=$1 AND run_id=$3 RETURNING *`,[candidate.user_id,this.now(),candidate.run_id])).rows[0]||null;
      }
      }
    });
  }
  async readPage({run,read}){
    const {pending}=await jobTransaction(this.pool,async c=>{
      const s=(await c.query('SELECT * FROM job_history_syncs WHERE user_id=$1 AND run_id=$2 AND lease_id=$3 FOR UPDATE',
        [run.user_id,run.run_id,run.lease_id])).rows[0];
      if(!s||s.status!=='running'||s.lease_until<=this.now())return {pending:null};
      await assertJobScope(c,{userId:s.user_id,conversationId:s.conversation_id,chatId:s.chat_id,channel:'telegram'},this.accessService);
      if(!(await c.query("SELECT 1 FROM job_connections WHERE user_id=$1 AND status='connected' AND resume_id IS NOT NULL",[s.user_id])).rowCount)throw jobError('JOB_HH_NOT_CONNECTED');
      // Dispatch under the access lock, but release it before waiting for HH.
      // Both outcomes are handled immediately, including if COMMIT itself fails.
      const pending=Promise.resolve(read({section:s.section,page:s.page}))
        .then(value=>({ok:true,value}),error=>({ok:false,error}));
      return {pending};
    });
    if(!pending)return null;
    const outcome=await pending;
    if(!outcome.ok)throw outcome.error;
    return outcome.value;
  }
  async applyPage({run,leaseId,result}){
    result=historySchema.parse(result);
    return jobTransaction(this.pool,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`job-history:${run.user_id}`]);
      const s=(await c.query('SELECT * FROM job_history_syncs WHERE user_id=$1 AND run_id=$2 AND lease_id=$3 FOR UPDATE',[run.user_id,run.run_id,leaseId])).rows[0];
      if(!s||s.lease_until<this.now())return false;
      await assertJobScope(c,{userId:s.user_id,conversationId:s.conversation_id,chatId:s.chat_id,channel:'telegram'},this.accessService);
      const identity=await c.query("SELECT 1 FROM user_identities WHERE user_id=$1 AND provider='telegram' AND external_id=$2",[s.user_id,s.chat_id]);
      if(!identity.rowCount)throw jobError('JOB_SCOPE_DENIED');
      if(!(await c.query("SELECT 1 FROM job_connections WHERE user_id=$1 AND status='connected' AND resume_id IS NOT NULL",[s.user_id])).rowCount)throw jobError('JOB_HH_NOT_CONNECTED');
      if(s.section!==result.section||s.page!==result.page)throw jobError('JOB_HH_INVALID_RESPONSE');
      for(const item of result.items)await this.history.upsertIn(c,s.user_id,item,this.now(),{section:s.section,runId:s.run_id});
      let seen=[...new Set([...s.seen_ids,...result.items.map(x=>x.topicId)])],section=s.section,page=s.page+1,pass=s.pass,status='queued';
      let total=s.expected_total??result.total,pages=s.expected_pages??result.pages;
      const unstable=total!==result.total||pages!==result.pages||(page>=result.pages&&seen.length!==result.total);
      const exhausted=s.pages_read+1>=1000*s.pass;
      if(unstable||exhausted&&page<result.pages){
        if(pass===1){pass=2;page=0;seen=[];total=null;pages=null;}else status='incomplete';
      }else if(page>=result.pages){
        if(section==='active'){section='archived';page=0;pass=1;seen=[];total=null;pages=null;}
        else status='complete';
      }
      if(s.pages_read+1>=2000&&status!=='complete')status='incomplete';
      // A terminal page never persists an out-of-range next-page cursor.
      if(status==='complete'||status==='incomplete')page=Math.min(s.page,999);
      return(await c.query(`UPDATE job_history_syncs SET status=$4,section=$5,page=$6,pass=$7,seen_ids=$8,
        expected_total=$9,expected_pages=$10,pages_read=pages_read+1,attempts=0,failure_code=CASE WHEN $4='incomplete' THEN 'JOB_HISTORY_INCOMPLETE' ELSE NULL END,
        lease_id=NULL,lease_until=NULL,next_attempt_at=$11::timestamptz+interval '1 second',updated_at=$11,
        last_success_at=CASE WHEN $4='complete' THEN $11 ELSE last_success_at END,
        last_success_run_id=CASE WHEN $4='complete' THEN run_id ELSE last_success_run_id END
        WHERE user_id=$1 AND run_id=$2 AND lease_id=$3 RETURNING user_id`,[s.user_id,s.run_id,leaseId,status,section,page,pass,JSON.stringify(seen),total,pages,this.now()])).rowCount===1;
    });
  }
  async fail({run,leaseId,code}){
    const captcha=['JOB_HH_CAPTCHA_REQUIRED','JOB_HH_CAPTCHA_MANUAL_REQUIRED','JOB_HH_CAPTCHA_WAITING','JOB_HH_MANUAL_ACTIVE'].includes(code);
    const transient=captcha||['JOB_HH_UNAVAILABLE','JOB_BROWSER_BUSY','JOB_HH_RATE_LIMIT'].includes(code);
    const safe=/^JOB_[A-Z_]{1,70}$/.test(code||'')?code:'JOB_HH_UNAVAILABLE';
    await this.pool.query(`UPDATE job_history_syncs SET status=CASE WHEN $4 AND ($5 OR attempts<3) THEN 'paused' ELSE 'failed' END,
      attempts=CASE WHEN $5 THEN attempts ELSE LEAST(attempts+1,4) END,failure_code=$6,lease_id=NULL,lease_until=NULL,
      next_attempt_at=$7::timestamptz+interval '60 seconds',updated_at=$7 WHERE user_id=$1 AND run_id=$2 AND lease_id=$3`,
    [run.user_id,run.run_id,leaseId,transient,captcha,safe,this.now()]);
  }
}
module.exports={JobHistorySyncRepository};
