const crypto = require('node:crypto');
const { FAMILY_PERMISSIONS, FAMILY_RESOURCE_TYPES } = require('../life/people/peopleSchemas');

const INTERACTION_TTL_MS = 10 * 60 * 1000;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KINDS = new Set([
  'vpn_access_label',
  'device_pairing_name',
  'device_instruction',
  'memory_add',
  'memory_correct_replacement',
  'life_project_create',
  'life_project_update',
  'life_person_create',
  'life_person_update',
  'life_relationship_create',
  'life_project_link_create',
  'life_family_grant_create',
  'life_family_grant_confirm',
  'life_reminder_create',
  'life_reminder_reschedule',
  'life_source_create',
  'life_source_update',
  'life_preference_set',
]);

function validateContext(kind, value) {
  const context = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const keys = Object.keys(context);
  if (kind === 'vpn_access_label') {
    if (keys.length < 1 || keys.length > 2 || !['vless', 'hysteria2'].includes(context.protocol) || (context.node && !['de', 'nl'].includes(context.node))) throw new Error('invalid Telegram interaction context');
    return { protocol: context.protocol, node: context.node || 'de' };
  }
  if (kind === 'device_instruction') {
    if (keys.length !== 1 || !UUID_RE.test(String(context.deviceId || ''))) throw new Error('invalid Telegram interaction context');
    return { deviceId: String(context.deviceId).toLowerCase() };
  }
  if (kind === 'memory_correct_replacement') {
    if (keys.length !== 1 || !UUID_RE.test(String(context.memoryId || ''))) throw new Error('invalid Telegram interaction context');
    return { memoryId: String(context.memoryId).toLowerCase() };
  }
  if (kind === 'life_preference_set') {
    if (keys.some((key) => !['key', 'revision'].includes(key)) || typeof context.key !== 'string'
      || context.key.length > 80 || (context.revision !== null && context.revision !== undefined && !Number.isInteger(context.revision))) {
      throw new Error('invalid Telegram interaction context');
    }
    return { key: context.key, revision: context.revision ?? null };
  }
  if (['life_project_update', 'life_person_update', 'life_reminder_reschedule', 'life_source_update'].includes(kind)) {
    if (keys.length !== 2 || !UUID_RE.test(String(context.targetId || ''))
      || !Number.isInteger(context.revision) || context.revision < 1) {
      throw new Error('invalid Telegram interaction context');
    }
    return { targetId: String(context.targetId).toLowerCase(), revision: context.revision };
  }
  if (kind === 'life_family_grant_confirm') {
    if (keys.length !== 4 || !UUID_RE.test(String(context.memberUserId || ''))
      || !UUID_RE.test(String(context.resourceId || ''))
      || !FAMILY_RESOURCE_TYPES.includes(context.resourceType) || !FAMILY_PERMISSIONS.includes(context.permission)) {
      throw new Error('invalid Telegram interaction context');
    }
    return {
      memberUserId: String(context.memberUserId).toLowerCase(), resourceType: context.resourceType,
      resourceId: String(context.resourceId).toLowerCase(), permission: context.permission,
    };
  }
  if (keys.length !== 0) throw new Error('invalid Telegram interaction context');
  return {};
}

function validateInteraction({ userId, conversationId, chatId, kind, context }) {
  if (!UUID_RE.test(String(userId || '')) || !UUID_RE.test(String(conversationId || ''))) throw new Error('invalid Telegram interaction owner');
  if (!/^-?\d{1,20}$/.test(String(chatId || '')) || !KINDS.has(kind)) throw new Error('invalid Telegram interaction');
  return { userId, conversationId, chatId: String(chatId), kind, context: validateContext(kind, context) };
}

class TelegramInteractionRepository {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.now = options.now || (() => new Date());
    this.ttlMs = Number(options.ttlMs || INTERACTION_TTL_MS);
  }

  async begin(input) {
    const valid = validateInteraction(input);
    const id = crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`telegram-interaction:${valid.userId}:${valid.conversationId}`]);
      await client.query(`
        UPDATE telegram_interactions SET status='cancelled',updated_at=now()
        WHERE user_id=$1 AND conversation_id=$2 AND status='active'
      `, [valid.userId, valid.conversationId]);
      const result = await client.query(`
        INSERT INTO telegram_interactions (id,user_id,conversation_id,chat_id,kind,context,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *
      `, [id, valid.userId, valid.conversationId, valid.chatId, valid.kind, JSON.stringify(valid.context), expiresAt]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getActive({ userId, conversationId, chatId }) {
    const expired = await this.pool.query(`
      UPDATE telegram_interactions SET status='expired',updated_at=now()
      WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND status='active' AND expires_at<=now()
      RETURNING id
    `, [userId, conversationId, String(chatId)]);
    const result = await this.pool.query(`
      SELECT * FROM telegram_interactions
      WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND status='active' AND expires_at>now()
      ORDER BY created_at DESC LIMIT 1
    `, [userId, conversationId, String(chatId)]);
    return { interaction: result.rows[0] || null, expired: expired.rowCount > 0 };
  }

  async consume({ id, userId, conversationId, chatId }) {
    const result = await this.pool.query(`
      UPDATE telegram_interactions SET status='consumed',updated_at=now()
      WHERE id=$1 AND user_id=$2 AND conversation_id=$3 AND chat_id=$4
        AND status='active' AND expires_at>now()
      RETURNING *
    `, [id, userId, conversationId, String(chatId)]);
    return result.rows[0] || null;
  }

  async cancel({ id = null, userId, conversationId, chatId }) {
    const result = await this.pool.query(`
      UPDATE telegram_interactions SET status='cancelled',updated_at=now()
      WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND status='active'
        AND ($4::uuid IS NULL OR id=$4)
      RETURNING id
    `, [userId, conversationId, String(chatId), id]);
    return result.rowCount > 0;
  }
}

module.exports = {
  INTERACTION_TTL_MS,
  KINDS,
  TelegramInteractionRepository,
  validateContext,
  validateInteraction,
};
