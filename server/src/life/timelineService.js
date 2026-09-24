const { publicEvent } = require('./lifePublic');

function encodeCursor(event) {
  return Buffer.from(JSON.stringify({ v: 1, at: new Date(event.occurred_at).toISOString(), id: event.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return { beforeOccurredAt: null, beforeId: null };
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.v !== 1 || !/^\d{4}-\d{2}-\d{2}T/.test(value.at) || !/^[a-f0-9-]{36}$/i.test(value.id)) throw new Error();
    const at = new Date(value.at);
    if (Number.isNaN(at.getTime())) throw new Error();
    return { beforeOccurredAt: at, beforeId: value.id };
  } catch (_) {
    const error = new Error('LIFE_CURSOR_INVALID');
    error.statusCode = 400;
    error.publicCode = 'LIFE_CURSOR_INVALID';
    throw error;
  }
}

class TimelineService {
  constructor(options = {}) { this.repository = options.repository; }

  async list({ userId, projectId = null, areaId = null, from = null, to = null, cursor = null, limit = 40 }) {
    const position = decodeCursor(cursor);
    const rows = await this.repository.listTimeline({ userId, projectId, areaId, from, to, ...position, limit: Number(limit) + 1 });
    const hasMore = rows.length > Number(limit);
    const visible = rows.slice(0, Number(limit));
    return { items: visible.map(publicEvent), nextCursor: hasMore ? encodeCursor(visible.at(-1)) : null };
  }
}

module.exports = { TimelineService, decodeCursor, encodeCursor };
