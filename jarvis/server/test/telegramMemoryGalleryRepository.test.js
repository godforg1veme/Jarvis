const assert = require('node:assert/strict');
const test = require('node:test');
const { GALLERY_PAGE_SIZE, TelegramMemoryGalleryRepository, boundedPage } = require('../src/telegram/telegramMemoryGalleryRepository');

test('gallery query is owner-scoped, bounded, deterministic, and metadata-only', async () => {
  const calls = [];
  const rows = Array.from({ length: GALLERY_PAGE_SIZE + 1 }, (_, index) => ({ source_kind: index % 2 ? 'v' : 'd', id: `id-${index}`, label: `item-${index}` }));
  const repository = new TelegramMemoryGalleryRepository({ async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows }; } });
  const result = await repository.listPage({ userId: 'owner-a', page: 2, includeVisual: true });
  assert.equal(result.items.length, GALLERY_PAGE_SIZE);
  assert.equal(result.hasNext, true);
  assert.equal(result.page, 2);
  assert.deepEqual(calls[0].params, ['owner-a', true, GALLERY_PAGE_SIZE + 1, GALLERY_PAGE_SIZE * 2]);
  assert.equal((calls[0].sql.match(/user_id=\$1/g) || []).length, 2);
  assert.match(calls[0].sql, /ORDER BY event_at DESC,id DESC/);
  assert.doesNotMatch(calls[0].sql.match(/SELECT source_kind[\s\S]*?FROM gallery/)[0], /storage_key|blob_key|content_hash|source_id/);
});

test('gallery page rejects unbounded values and can omit visual rows', async () => {
  assert.equal(boundedPage('0'), 0);
  assert.throws(() => boundedPage(-1), /invalid/);
  assert.throws(() => boundedPage(10000), /invalid/);
  const calls = [];
  const repository = new TelegramMemoryGalleryRepository({ async query(sql, params) { calls.push(params); return { rows: [] }; } });
  await repository.listPage({ userId: 'owner-a', page: 0, includeVisual: false });
  assert.equal(calls[0][1], false);
});
