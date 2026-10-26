const { createHash } = require('node:crypto');
const { z } = require('zod');
const { accessError } = require('../access/accessPolicy');
const { hash: hashSession } = require('./sessionService');

const digest = (value) => createHash('sha256').update(value).digest('hex');
const uuid = z.uuid();
const memoryDigest = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.discriminatedUnion('kind', [
  z.strictObject({ operationId: uuid, kind: z.literal('add'), memoryId: z.null(), expectedDigest: z.null(), content: z.string().min(1).max(1000) }),
  z.strictObject({ operationId: uuid, kind: z.literal('correct'), memoryId: uuid, expectedDigest: memoryDigest, content: z.string().min(1).max(1000) }),
  z.strictObject({ operationId: uuid, kind: z.literal('forget'), memoryId: uuid, expectedDigest: memoryDigest, content: z.null() }),
]);

class MemoryActions {
  constructor({ accessService, memoryService }) {
    this.accessService = accessService;
    this.memoryService = memoryService;
  }

  async authorized(db, session) {
    const userId = session.actor.userId;
    const actor = await this.accessService.repository.get(db, 'user', userId);
    if (!actor || actor.blocked || !actor.permissions.includes('memory')) throw accessError('forbidden');
    const sessionHash = hashSession(session.token);
    const live = (await db.query(`SELECT 1 FROM mini_app_sessions
      WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR SHARE`, [sessionHash, userId])).rowCount;
    if (!live) throw accessError('unauthorized');
    return { userId, sessionHash };
  }

  async execute(session, raw) {
    const parsed = input.safeParse(raw);
    if (!parsed.success) throw accessError('invalid_request');
    const command = parsed.data;
    const requestHash = digest(JSON.stringify(command));
    return this.accessService.transaction(async (db) => {
      const { userId, sessionHash } = await this.authorized(db, session);
      const previous = (await db.query(`SELECT status,request_hash,memory_id FROM mini_app_memory_operations
        WHERE user_id=$1 AND operation_id=$2`, [userId, command.operationId])).rows[0];
      if (previous) {
        if (previous.status === 'cancelled') return { status: 'cancelled' };
        if (previous.request_hash !== requestHash) throw accessError('operation_conflict');
        return { status: 'completed', memoryId: previous.memory_id };
      }

      if (command.kind !== 'add') {
        const target = (await db.query(`SELECT content FROM memories
          WHERE id=$1 AND user_id=$2 AND active=true FOR UPDATE`, [command.memoryId, userId])).rows[0];
        if (!target || digest(target.content) !== command.expectedDigest) throw accessError('revision_conflict');
      }

      const args = { userId, memoryId: command.memoryId, content: command.content, db };
      const result = command.kind === 'add'
        ? await this.memoryService.remember(args)
        : command.kind === 'correct'
          ? await this.memoryService.correctById(args)
          : await this.memoryService.forgetById(args);
      if (!result.ok || !result.memory) throw accessError('invalid_request');
      const memoryId = result.memory.id;
      await db.query(`INSERT INTO mini_app_memory_operations
        (user_id,operation_id,request_hash,session_hash,status,memory_id)
        VALUES($1,$2,$3,$4,'completed',$5)`, [userId, command.operationId, requestHash, sessionHash, memoryId]);
      return { status: 'completed', memoryId };
    });
  }

  async operation(session, operationId) {
    if (!uuid.safeParse(operationId).success) throw accessError('invalid_request');
    return this.accessService.transaction(async (db) => {
      const { userId } = await this.authorized(db, session);
      const row = (await db.query(`SELECT status,memory_id FROM mini_app_memory_operations
        WHERE user_id=$1 AND operation_id=$2`, [userId, operationId])).rows[0];
      if (!row) throw accessError('operation_unknown');
      return row.status === 'cancelled'
        ? { status: 'cancelled' }
        : { status: 'completed', memoryId: row.memory_id };
    });
  }

  async cancel(session, operationId) {
    if (!uuid.safeParse(operationId).success) throw accessError('invalid_request');
    return this.accessService.transaction(async (db) => {
      const { userId, sessionHash } = await this.authorized(db, session);
      const row = (await db.query(`INSERT INTO mini_app_memory_operations
        (user_id,operation_id,session_hash,status)
        VALUES($1,$2,$3,'cancelled') ON CONFLICT(user_id,operation_id) DO NOTHING
        RETURNING status`, [userId, operationId, sessionHash])).rows[0];
      if (row) return { status: 'cancelled' };
      const existing = (await db.query(`SELECT status,memory_id FROM mini_app_memory_operations
        WHERE user_id=$1 AND operation_id=$2`, [userId, operationId])).rows[0];
      return existing.status === 'cancelled'
        ? { status: 'cancelled' }
        : { status: 'completed', memoryId: existing.memory_id };
    });
  }
}

module.exports = { MemoryActions };
