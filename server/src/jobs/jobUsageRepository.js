const { uuid, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');

function jobMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find((x) => x.type === 'year').value}-${parts.find((x) => x.type === 'month').value}`;
}

class JobUsageRepository {
  constructor(pool) { this.pool = pool; }
  async record({ userId, requestId, providerRequestId = null, costUsd = null, outcome, occurredAt = new Date() }) {
    if (!['success', 'failed', 'pending'].includes(outcome) || typeof requestId !== 'string' || requestId.length > 150
      || (costUsd != null && (!Number.isFinite(costUsd) || costUsd < 0))) throw jobError('JOB_INVALID_USAGE');
    return (await this.pool.query(`INSERT INTO job_usage(user_id,request_id,provider_request_id,cost_usd,outcome,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,request_id) DO UPDATE SET
      cost_usd=COALESCE(job_usage.cost_usd,excluded.cost_usd),
      provider_request_id=COALESCE(job_usage.provider_request_id,excluded.provider_request_id),
      outcome=CASE WHEN COALESCE(job_usage.cost_usd,excluded.cost_usd) IS NULL THEN 'pending' ELSE excluded.outcome END
      RETURNING *`, [uuid.parse(userId), requestId, providerRequestId, costUsd,
      costUsd == null ? 'pending' : outcome, occurredAt])).rows[0];
  }
  async getMonth({ userId, now = new Date() }) {
    const month = jobMonth(now);
    const row = (await this.pool.query(`SELECT COALESCE(sum(cost_usd),0)::float8 AS total,
      count(*) FILTER(WHERE cost_usd IS NULL)::int AS pending FROM job_usage
      WHERE user_id=$1 AND to_char(occurred_at AT TIME ZONE 'Europe/Moscow','YYYY-MM')=$2`,
    [uuid.parse(userId), month])).rows[0];
    return { month, ...row };
  }
  async claimBudgetNotice({ userId, now = new Date(), thresholdUsd }) {
    if (!(thresholdUsd > 0)) throw jobError('JOB_INVALID_BUDGET');
    const month = jobMonth(now);
    return jobTransaction(this.pool, async (client) => {
      const notice = await client.query(`INSERT INTO job_budget_notices(user_id,month,threshold_usd)
        SELECT $1,$2,$3 WHERE (SELECT COALESCE(sum(cost_usd),0) FROM job_usage WHERE user_id=$1
        AND to_char(occurred_at AT TIME ZONE 'Europe/Moscow','YYYY-MM')=$2)>=$3
        ON CONFLICT DO NOTHING RETURNING user_id`, [uuid.parse(userId), month, thresholdUsd]);
      if (!notice.rowCount) return false;
      await client.query(`INSERT INTO job_deliveries(user_id,kind,dedup_key,payload)
        VALUES($1,'budget',$2,$3) ON CONFLICT DO NOTHING`, [userId, `budget:${month}:${thresholdUsd}`, { month, thresholdUsd }]);
      return true;
    });
  }
}

module.exports = { jobMonth, JobUsageRepository };
