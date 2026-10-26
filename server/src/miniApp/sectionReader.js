const { randomBytes, createHash } = require('node:crypto');
const { publicDocumentStatus } = require('../knowledge/knowledgeService');
const { formatMoscowDateTime } = require('../../../shared/time');

const PAGE_SIZE = 30;
const SOURCES = Object.freeze({
  memory: { table: 'memories', fields: 'id,content AS title', condition: 'active=true' },
  documents: { table: 'documents', fields: 'id,original_name AS title,status,extraction_mode,embedding_status', condition: "status<>'deleted'" },
  devices: { table: 'devices', fields: 'id,name AS title,status', condition: "status<>'revoked'" },
  life: { table: 'life_commitments', fields: 'id,title,due_at', condition: "status='open'" },
  assistant: { table: 'messages', fields: 'id,role,content', condition: "role IN ('user','assistant')" },
});
const invalid = () => { throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' }); };

class SectionReader {
  constructor({ pool, now = Date.now, ttlMs = 600000, capacity = 2000 }) {
    this.pool = pool; this.now = now; this.ttlMs = ttlMs; this.capacity = capacity; this.cursors = new Map();
  }

  cursor(scope, anchor) {
    const now = this.now();
    for (const [key, value] of this.cursors) if (value.expiresAt <= now) this.cursors.delete(key);
    while (this.cursors.size >= this.capacity) this.cursors.delete(this.cursors.keys().next().value);
    const token = randomBytes(24).toString('hex');
    this.cursors.set(token, { ...scope, anchor, expiresAt: now + this.ttlMs });
    return token;
  }

  async read({ userId, section, conversationId = null, cursor = null }) {
    const source = Object.hasOwn(SOURCES, section) ? SOURCES[section] : null;
    if (!source || (section === 'assistant' && !conversationId)) invalid();
    let anchor = null;
    if (cursor !== null) {
      if (typeof cursor !== 'string' || !/^[a-f0-9]{48}$/.test(cursor)) invalid();
      const saved = this.cursors.get(cursor);
      if (!saved || saved.expiresAt <= this.now() || saved.userId !== userId
        || saved.section !== section || saved.conversationId !== conversationId) invalid();
      anchor = saved.anchor;
    }
    const args = [userId];
    const conditions = ['user_id=$1', source.condition];
    if (conversationId) { args.push(conversationId); conditions.push(`conversation_id=$${args.length}`); }
    if (anchor) {
      args.push(anchor.time, anchor.id);
      const after = `(created_at,id)<($${args.length - 1}::timestamptz,$${args.length}::${section === 'assistant' ? 'bigint' : 'uuid'})`;
      if (section === 'life') {
        if (anchor.due === null) conditions.push(`due_at IS NULL AND ${after}`);
        else {
          args.push(anchor.due);
          conditions.push(`(due_at>$${args.length}::timestamptz OR due_at IS NULL OR (due_at=$${args.length}::timestamptz AND ${after}))`);
        }
      } else conditions.push(after);
    }
    args.push(PAGE_SIZE + 1);
    // All SQL identifiers and conditions above come from a closed local table.
    const result = await this.pool.query(`SELECT ${source.fields},created_at::text AS page_time${section === 'life' ? ',due_at::text AS page_due' : ''}
      FROM ${source.table} WHERE ${conditions.join(' AND ')}
      ORDER BY ${section === 'life' ? 'due_at ASC NULLS LAST,' : ''}created_at DESC,id DESC LIMIT $${args.length}`, args);
    const rows = result.rows.slice(0, PAGE_SIZE);
    const last = rows.at(-1);
    const nextCursor = result.rows.length > PAGE_SIZE
      ? this.cursor({ userId, section, conversationId }, { time: last.page_time, id: String(last.id),
        ...(section === 'life' ? { due: last.page_due } : {}) }) : null;
    const paging = { pageSize: PAGE_SIZE, nextCursor };
    if (section === 'assistant') return { messages: rows.reverse().map((row) => ({ id: String(row.id), role: row.role, content: row.content })), paging };
    return { items: rows.map((row) => ({ id: String(row.id), title: row.title,
      ...(section === 'memory' ? { expectedDigest: createHash('sha256').update(row.title, 'utf8').digest('hex') }
        : section === 'documents' ? { detail: publicDocumentStatus(row) }
        : section === 'devices' ? { detail: row.status }
          : section === 'life' ? { detail: row.due_at ? `Договорённость · ${formatMoscowDateTime(row.due_at)}` : 'Договорённость' } : {}) })), paging };
  }
}

module.exports = { SectionReader, PAGE_SIZE };
