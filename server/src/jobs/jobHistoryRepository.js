const {assertJobScope,uuid,jobError}=require('./jobSchemas');
const {jobTransaction}=require('./jobTransaction');
const {itemSchema}=require('./jobHistorySchema');

// Operations and external observations remain independent until an exact topic proof links them.
const merged=`WITH observed AS (
 SELECT h.id,'hh'::text AS row_kind,h.title,h.company,h.external_vacancy_id,
 h.resume_title,h.resume_native_id,h.applied_at,h.first_seen_at,h.checked_at,h.status_checked_at,h.employer_status,
 h.vacancy_archived,a.id AS operation_id,a.status AS send_status,a.approved_text,
 CASE WHEN a.status='sent' THEN 'jarvis' ELSE 'hh' END AS origin
 FROM job_history_observations h
 LEFT JOIN LATERAL(SELECT proved.* FROM(
   SELECT a.*,count(*) OVER() AS candidates FROM job_applications a JOIN job_vacancies v ON v.id=a.vacancy_id
   WHERE a.user_id=h.user_id AND a.external_id=h.topic_id AND a.status='sent'
     AND v.external_id=h.external_vacancy_id AND (h.resume_hash IS NULL OR h.resume_hash=a.resume_id)
 )proved WHERE proved.candidates=1)a ON true
 WHERE h.user_id=$1
), records AS (
 SELECT * FROM observed
 UNION ALL
 SELECT a.id,'local',v.snapshot->>'title',v.snapshot->>'company',v.external_id,
 NULL,NULL,NULL::timestamptz,a.created_at,NULL,NULL,'unknown',
 COALESCE((v.snapshot->>'archived')::boolean,false),a.id,a.status,a.approved_text,'jarvis'
 FROM job_applications a JOIN job_vacancies v ON v.id=a.vacancy_id
 WHERE a.user_id=$1 AND NOT EXISTS(SELECT 1 FROM observed h WHERE h.operation_id=a.id)
)`;
class JobHistoryRepository {
  constructor(pool){this.pool=pool;}
  async upsertIn(client,userId,input,now=new Date()){
    const x=itemSchema.parse(input);
    const old=(await client.query('SELECT * FROM job_history_observations WHERE user_id=$1 AND topic_id=$2 FOR UPDATE',[userId,x.topicId])).rows[0];
    if(old&&(old.external_vacancy_id!==x.vacancyId||old.resume_native_id!==x.resumeId
      ||old.resume_hash&&x.resumeHash&&old.resume_hash!==x.resumeHash))throw jobError('JOB_HH_INVALID_RESPONSE');
    const candidates=(await client.query(`SELECT a.id FROM job_applications a JOIN job_vacancies v ON v.id=a.vacancy_id
      WHERE a.user_id=$1 AND a.external_id=$2 AND v.external_id=$3 AND a.status='sent'
      AND ($4::text IS NULL OR a.resume_id=$4) LIMIT 2`,[userId,x.topicId,x.vacancyId,x.resumeHash])).rows;
    const linked=candidates.length===1?candidates[0].id:null;
    const row=(await client.query(`INSERT INTO job_history_observations(user_id,topic_id,external_vacancy_id,resume_native_id,
      resume_hash,resume_title,title,company,applied_at,employer_status,status_checked_at,vacancy_archived,application_id,first_seen_at,last_seen_at,checked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $10='unknown' THEN NULL ELSE $13::timestamptz END,$11,$12,$13,$13,$13)
      ON CONFLICT(user_id,topic_id) DO UPDATE SET resume_hash=COALESCE(excluded.resume_hash,job_history_observations.resume_hash),
      resume_title=COALESCE(excluded.resume_title,job_history_observations.resume_title),title=COALESCE(excluded.title,job_history_observations.title),
      company=COALESCE(excluded.company,job_history_observations.company),applied_at=COALESCE(excluded.applied_at,job_history_observations.applied_at),
      employer_status=CASE WHEN excluded.employer_status='unknown' THEN job_history_observations.employer_status ELSE excluded.employer_status END,
      status_checked_at=COALESCE(excluded.status_checked_at,job_history_observations.status_checked_at),
      vacancy_archived=CASE WHEN $14::boolean IS NULL THEN job_history_observations.vacancy_archived ELSE excluded.vacancy_archived END,
      application_id=COALESCE(excluded.application_id,job_history_observations.application_id),last_seen_at=excluded.last_seen_at,checked_at=excluded.checked_at
      RETURNING *`,[userId,x.topicId,x.vacancyId,x.resumeId,x.resumeHash,x.resumeTitle,x.title,x.company,x.appliedAt,x.status,x.archived??false,linked,now,x.archived])).rows[0];
    if(!old||old.employer_status!==row.employer_status)await client.query('INSERT INTO job_history_events(observation_id,employer_status,observed_at) VALUES($1,$2,$3)',[row.id,row.employer_status,now]);
    return row;
  }
  async observe({scope,item}){
    return jobTransaction(this.pool,async client=>{await assertJobScope(client,scope);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`job-history:${scope.userId}`]);
      return this.upsertIn(client,scope.userId,item);});
  }
  async list({scope,page=0}){
    await assertJobScope(this.pool,scope);if(!Number.isInteger(page)||page<0||page>9999)throw jobError('JOB_INVALID_PAGE');
    // Letter bodies are selected only for a scoped detail card, never for list rendering.
    const rows=(await this.pool.query(`${merged} SELECT id,row_kind,title,company,external_vacancy_id,origin,send_status,
      employer_status,applied_at,first_seen_at,checked_at,status_checked_at FROM records
      ORDER BY COALESCE(applied_at,first_seen_at) DESC,id LIMIT 10 OFFSET $2`,[scope.userId,page*10])).rows;
    const total=(await this.pool.query(`${merged} SELECT count(*)::int AS n FROM records`,[scope.userId])).rows[0].n;
    return{items:rows,total};
  }
  async get({scope,id}){
    await assertJobScope(this.pool,scope);const row=(await this.pool.query(`${merged} SELECT * FROM records WHERE id=$2`,[scope.userId,uuid.parse(id)])).rows[0];
    if(!row)throw jobError('JOB_NOT_FOUND');
    const events=row.row_kind==='hh'?(await this.pool.query(`SELECT employer_status,observed_at FROM job_history_events
      WHERE observation_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 8`,[row.id])).rows:[];
    return{...row,events};
  }
}
module.exports={JobHistoryRepository};
