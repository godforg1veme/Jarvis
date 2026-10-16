const { settingsSchema, profileSchema, assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');

function parseSettingsEdit(text, current) {
  const next = structuredClone(current);
  const keys = { зарплата: 'targetRub', город: 'officeCity', интервал: 'intervalMs', период: 'historyDays', бюджет: 'budgetUsd', модель: 'model' };
  for (const raw of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
    let match = /^(запрос|исключение)\s*([+-])\s*(.{2,200})$/iu.exec(raw);
    if (match) {
      const key = match[1].toLowerCase() === 'запрос' ? 'queries' : 'exclusions';
      next[key] = match[2] === '+' ? [...new Set([...next[key], match[3]])] : next[key].filter((x) => x !== match[3]); continue;
    }
    if (/^включить$/iu.test(raw)) { next.activated = true; next.paused = false; continue; }
    if (/^удал[её]нка\s*=\s*(да|нет)$/iu.test(raw)) { next.remote = /да$/iu.test(raw); continue; }
    match = /^(зарплата|город|интервал|период|бюджет|модель)\s*=\s*(.+)$/iu.exec(raw);
    if (!match) throw jobError('JOB_INVALID_SETTINGS_INPUT');
    const key = keys[match[1].toLowerCase()];
    next[key] = ['model', 'officeCity'].includes(key) ? match[2].trim() : Number(match[2].replace(/\s/g, '').replace(',', '.')) * (key === 'intervalMs' ? 60000 : 1);
  }
  return settingsSchema.parse(next);
}

function parseProfileEdit(text, current) {
  if (/\b(?:sk-[\w-]{16,}|Bearer\s+[\w.-]{16,})|(?:пароль|password|api[_ -]?key|токен)\s*[:=]\s*\S+/iu.test(text)) throw jobError('JOB_SENSITIVE_INPUT');
  const result = structuredClone(current);
  for (const raw of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const match = /^(факт|пример)\s*:\s*(.+)$/iu.exec(raw);
    if (!match) throw jobError('JOB_INVALID_PROFILE_INPUT');
    if (match[1].toLowerCase() === 'пример') result.examples.push(match[2]);
    else {
      let index = 1; const ids = new Set(result.facts.map((x) => x.id));
      while (ids.has(`fact_${index}`)) index++;
      result.facts.push({ id: `fact_${index}`, text: match[2], confirmed: true });
    }
  }
  result.confirmed = true;
  return profileSchema.parse(result);
}

class JobSettingsService {
  constructor({ pool, searchRepository, profileRepository, now = () => new Date() }) {
    Object.assign(this, { pool, searchRepository, profileRepository, now });
  }
  async preview({ scope, kind, targetId, revision, value, returnTo }) {
    await assertJobScope(this.pool, scope);
    if (!['settings', 'profile'].includes(kind)) throw jobError('JOB_INVALID_ACTION');
    if (returnTo !== undefined && (kind !== 'settings' || !returnTo || Object.keys(returnTo).length !== 2
      || !['panel','queries','exclusions'].includes(returnTo.field) || !Number.isInteger(returnTo.page)
      || returnTo.page < 0 || returnTo.page > 12)) throw jobError('JOB_INVALID_ACTION');
    const result = await this.pool.query(`INSERT INTO job_confirmations(user_id,conversation_id,chat_id,channel,
      kind,target_id,frozen,expires_at) VALUES($1,$2,$3,'telegram',$4,$5,$6,$7) RETURNING *`,
    [scope.userId, scope.conversationId, scope.chatId, kind, targetId, { revision, value, ...(returnTo ? { returnTo } : {}) }, new Date(this.now().getTime() + 600000)]);
    return result.rows[0];
  }
  async approve({ scope, confirmationId, panel = false }) {
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      const row = (await client.query(`UPDATE job_confirmations SET status='consumed' WHERE id=$1 AND user_id=$2
        AND conversation_id=$3 AND chat_id=$4 AND channel='telegram' AND kind IN ('settings','profile')
        AND status='pending' AND expires_at>$5 AND ($6::boolean=false OR (kind='settings' AND frozen ? 'returnTo')) RETURNING *`,
      [confirmationId, scope.userId, scope.conversationId, scope.chatId, this.now(), panel])).rows[0];
      if (!row) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
      let updated;
      if (row.kind === 'settings') updated = await client.query(`UPDATE job_searches SET settings=$1,revision=revision+1,
        next_check_at=now(),progress=NULL,lease_id=NULL,lease_until=NULL WHERE id=$2 AND user_id=$3 AND revision=$4 RETURNING id`,
      [settingsSchema.parse(row.frozen.value), row.target_id, scope.userId, row.frozen.revision]);
      else {
        updated = await client.query(`UPDATE job_profiles SET profile=$1,revision=revision+1,updated_at=now()
          WHERE id=$2 AND user_id=$3 AND revision=$4 RETURNING id`,
        [profileSchema.parse(row.frozen.value), row.target_id, scope.userId, row.frozen.revision]);
        await client.query("UPDATE job_confirmations SET status='stale' WHERE user_id=$1 AND kind='apply' AND status='pending'", [scope.userId]);
      }
      if (!updated.rowCount) throw jobError('JOB_REVISION_CONFLICT');
      return panel ? {kind:row.kind,returnTo:row.frozen.returnTo} : row.kind;
    });
  }
}
module.exports = { parseSettingsEdit, parseProfileEdit, JobSettingsService };
