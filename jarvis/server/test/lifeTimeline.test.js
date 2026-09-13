const test = require('node:test');
const assert = require('node:assert/strict');
const { TimelineService, decodeCursor, encodeCursor } = require('../src/life/timelineService');

const ID = '22222222-2222-4222-8222-222222222222';
const row = (n) => ({ id: n === 1 ? ID : '33333333-3333-4333-8333-333333333333', event_type: 'message.received',
  occurred_at: new Date(`2026-09-1${n}T10:00:00Z`), recorded_at: new Date(), source_channel: 'desktop', summary: `event ${n}`,
  confidence: 1, privacy_class: 'personal', trust_level: 'user', links: [] });

test('timeline returns bounded public records and an opaque stable cursor', async () => {
  const service = new TimelineService({ repository: { async listTimeline(input) { assert.equal(input.limit, 2); return [row(2), row(1)]; } } });
  const result = await service.list({ userId: ID, limit: 1 });
  assert.equal(result.items.length, 1);
  assert.ok(result.nextCursor);
  assert.equal(decodeCursor(result.nextCursor).beforeId, result.items[0].id);
  assert.equal(Object.hasOwn(result.items[0], 'userId'), false);
});

test('cursor tampering and malformed cursors are rejected', () => {
  assert.throws(() => decodeCursor('not-json'), /LIFE_CURSOR_INVALID/);
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify({ v: 2, at: new Date().toISOString(), id: ID })).toString('base64url')), /LIFE_CURSOR_INVALID/);
  assert.ok(encodeCursor(row(1)));
});
