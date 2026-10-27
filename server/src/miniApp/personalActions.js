const { createHash } = require('node:crypto');
const { z } = require('zod');
const { accessError } = require('../access/accessPolicy');
const { hash } = require('./sessionService');

const commandSchema = z.strictObject({
  operationId: z.uuid(), kind: z.string().min(1).max(40), targetId: z.uuid().nullable(),
  revision: z.union([z.number().int().nonnegative(), z.string().regex(/^[a-f0-9]{64}$/)]).nullable(),
  input: z.record(z.string(), z.unknown()),
});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
// Receipts contain only result metadata. Body text, filenames and storage keys are excluded.
const storedFields = ['id','type','status','revision','deleted','pairingId','expiresAt','dueAt','pinned','hiddenUntil','codeCipher'];
const publicFields = storedFields.filter((key) => key !== 'codeCipher').concat(['code','codeAvailable']);
const project = (result, fields) => Object.fromEntries(fields.filter((key) => Object.hasOwn(result || {}, key)).map((key) => [key, result[key]]));

class PersonalActions {
  constructor({ accessService, sections = {} }) { this.accessService = accessService; this.sections = sections; }
  available(section) { return Object.hasOwn(this.sections, section) && Boolean(this.sections[section]); }
  config(section) {
    if (!this.available(section)) throw accessError('unavailable');
    return this.sections[section];
  }
  async authorized(db, session, section) {
    const actor = await this.accessService.repository.get(db, 'user', session.actor.userId);
    if (!actor || actor.blocked || !actor.permissions.includes(section)) throw accessError('forbidden');
    if (!(await db.query(`SELECT 1 FROM mini_app_sessions WHERE token_hash=$1 AND user_id=$2
      AND expires_at>now() FOR SHARE`, [hash(session.token), actor.userId])).rowCount) throw accessError('unauthorized');
    return actor;
  }
  async publicResult(config, result, context) {
    return project(config.publicResult ? await config.publicResult(result, context) : result, publicFields);
  }
  async limitNew(db, userId) {
    const row = (await db.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE created_at>now()-interval '1 day')::int AS daily
      FROM mini_app_personal_operations WHERE user_id=$1`, [userId])).rows[0];
    if (row.total >= 20000 || row.daily >= 1000) throw accessError('limit_reached');
  }
  async describe(session, section) {
    const config = this.config(section);
    return this.accessService.transaction(async (db) => {
      const actor = await this.authorized(db, session, section);
      return { kinds: [...config.kinds], ...await config.describe({ db, actor, session }) };
    });
  }
  async target(session, section, kind, targetId) {
    const config = this.config(section);
    if (!config.kinds.includes(kind) || !z.uuid().safeParse(targetId).success) throw accessError('invalid_request');
    return this.accessService.transaction(async (db) => {
      const actor = await this.authorized(db, session, section);
      const target = await config.target({ db, actor, session, kind, targetId });
      return { ...target, type: target?.type || (section === 'documents' ? 'document' : section === 'devices' ? 'device' : undefined) };
    });
  }
  async execute(session, section, raw, data = null) {
    const config = this.config(section);
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success || !config.kinds.includes(parsed.data.kind)) throw accessError('invalid_request');
    const command = config.validate(parsed.data) || parsed.data;
    const requestHash = createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex');
    let effect = null, prepared = null, callbackFinished = false, duplicate = false;
    if (config.prepare) {
      const preliminary = await this.accessService.transaction(async (db) => {
        const actor = await this.authorized(db, session, section);
        const old = (await db.query(`SELECT section,request_hash,status,result FROM mini_app_personal_operations
          WHERE user_id=$1 AND operation_id=$2`, [actor.userId, command.operationId])).rows[0];
        if (old) {
          if (old.section !== section || (old.status !== 'cancelled' && old.request_hash !== requestHash)) throw accessError('operation_conflict');
          return { outcome: { status: old.status, result: old.status === 'completed'
            ? await this.publicResult(config, old.result, { db, actor, session }) : {} } };
        }
        await this.limitNew(db, actor.userId);
        return { actor };
      });
      if (preliminary.outcome) return preliminary.outcome;
      // Opaque file preparation happens without holding the global access lock.
      prepared = await config.prepare({ actor: preliminary.actor, session, command, data });
    }
    try {
      const outcome = await this.accessService.transaction(async (db) => {
        const actor = await this.authorized(db, session, section);
        const previous = (await db.query(`SELECT section,request_hash,status,result FROM mini_app_personal_operations
          WHERE user_id=$1 AND operation_id=$2`, [actor.userId, command.operationId])).rows[0];
        if (previous) {
          duplicate = true;
          if (previous.section !== section) throw accessError('operation_conflict');
          if (previous.status === 'cancelled') { callbackFinished = true; return { status: 'cancelled', result: {} }; }
          if (previous.request_hash !== requestHash) throw accessError('operation_conflict');
          const result = await this.publicResult(config, previous.result, { db, actor, session });
          callbackFinished = true;
          return { status: 'completed', result };
        }
        await this.limitNew(db, actor.userId);
        effect = await config.execute({ db, actor, session, command, data, prepared });
        const stored = project(effect.result, storedFields);
        if (command.kind !== 'pair') delete stored.codeCipher;
        await db.query(`INSERT INTO mini_app_personal_operations
          (user_id,operation_id,section,kind,request_hash,status,result) VALUES($1,$2,$3,$4,$5,'completed',$6)`,
        [actor.userId, command.operationId, section, command.kind, requestHash, JSON.stringify(stored)]);
        const result = await this.publicResult(config, stored, { db, actor, session });
        callbackFinished = true;
        return { status: 'completed', result };
      });
      if (duplicate && prepared?.onRollback) { try { await prepared.onRollback(); } catch {} }
      // A cleanup failure cannot turn a committed operation into an unconfirmed write.
      if (effect?.afterCommit) { try { await effect.afterCommit(); } catch {} }
      return outcome;
    } catch (error) {
      // Never delete a file if COMMIT may have succeeded but lost its acknowledgement.
      const rollback = effect?.onRollback || prepared?.onRollback;
      if ((duplicate || !callbackFinished) && rollback) { try { await rollback(); } catch {} }
      throw error;
    }
  }
  async operation(session, section, operationId, cancel = false) {
    const config = this.config(section);
    if (!z.uuid().safeParse(operationId).success) throw accessError('invalid_request');
    return this.accessService.transaction(async (db) => {
      const actor = await this.authorized(db, session, section);
      if (cancel) {
        const exists = (await db.query('SELECT 1 FROM mini_app_personal_operations WHERE user_id=$1 AND operation_id=$2', [actor.userId, operationId])).rowCount;
        if (!exists) {
          await this.limitNew(db, actor.userId);
          await db.query(`INSERT INTO mini_app_personal_operations(user_id,operation_id,section,status)
            VALUES($1,$2,$3,'cancelled')`, [actor.userId, operationId, section]);
        }
      }
      const row = (await db.query(`SELECT section,status,result FROM mini_app_personal_operations
        WHERE user_id=$1 AND operation_id=$2`, [actor.userId, operationId])).rows[0];
      if (!row || row.section !== section) throw accessError('operation_unknown');
      return { status: row.status, result: row.status === 'completed' ? await this.publicResult(config, row.result, { db, actor, session }) : {} };
    });
  }
}
module.exports = { PersonalActions };
