const assert = require('node:assert/strict');
const test = require('node:test');
const { TelegramMemoryGalleryService, parseGalleryCallback } = require('../src/telegram/telegramMemoryGalleryService');

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const VISUAL_ID = '22222222-2222-4222-8222-222222222222';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x01]);

function harness(overrides = {}) {
  const calls = [];
  const service = new TelegramMemoryGalleryService({
    repository: {
      async listPage(input) {
        calls.push(['list', input]);
        return { page: input.page, hasNext: input.page === 0, items: [
          { source_kind: 'd', id: DOCUMENT_ID, label: 'photo.jpg', media_type: 'image/jpeg', category: 'image', event_at: '2026-09-14T12:00:00Z' },
          { source_kind: 'v', id: VISUAL_ID, label: 'Кадр камеры', media_type: 'image/jpeg', category: 'visual', event_at: '2026-09-14T11:00:00Z' },
        ] };
      },
    },
    knowledgeService: {
      async readForDelivery(input) { calls.push(['read-document', input]); return { content: JPEG, contentType: 'image/jpeg', filename: 'photo.jpg' }; },
      async remove(input) { calls.push(['remove-document', input]); return { original_name: 'photo.jpg' }; },
    },
    visualMemoryService: {
      async read(input) { calls.push(['read-visual', input]); return { payload: { contentType: 'image/jpeg', image: JPEG.toString('base64') } }; },
      async remove(input) { calls.push(['remove-visual', input]); return true; },
    },
    ...overrides,
  });
  return { service, calls, context: { userId: 'owner-a' } };
}

test('gallery parser accepts only closed bounded callbacks', () => {
  assert.deepEqual(parseGalleryCallback('gallery:page:12'), { action: 'page', page: 12 });
  assert.deepEqual(parseGalleryCallback(`gallery:open:d:${DOCUMENT_ID}:0`), { action: 'open', source: 'd', id: DOCUMENT_ID, page: 0 });
  assert.equal(parseGalleryCallback('gallery:open:x:../../secret:0'), null);
  assert.equal(parseGalleryCallback('gallery:page:10000'), null);
});

test('gallery combines safe labels and bounded pagination controls', async () => {
  const { service, calls, context } = harness();
  const result = await service.handleCallback('gallery:page:0', context);
  assert.match(result.answer, /photo\.jpg/);
  assert.equal(result.buttons.some((row) => row.some((button) => button.data === 'gallery:page:1')), true);
  assert.equal(calls[0][1].includeVisual, true);
  assert.equal(JSON.stringify(result).includes('storage_key'), false);
});

test('gallery previews documents and visual frames before any mutation', async () => {
  const { service, calls, context } = harness();
  const document = await service.handleCallback(`gallery:open:d:${DOCUMENT_ID}:0`, context);
  assert.equal(document.media.kind, 'photo');
  assert.equal(document.media.buttons[0][0].data, `gallery:delete:d:${DOCUMENT_ID}:0`);
  const visual = await service.handleCallback(`gallery:open:v:${VISUAL_ID}:0`, context);
  assert.deepEqual(visual.media.content, JPEG);
  assert.equal(calls.some(([name]) => name.startsWith('remove-')), false);
});

test('keep does not mutate and delete delegates only to the selected source', async () => {
  const { service, calls, context } = harness();
  await service.handleCallback('gallery:keep:0', context);
  assert.equal(calls.some(([name]) => name.startsWith('remove-')), false);
  await service.handleCallback(`gallery:delete:d:${DOCUMENT_ID}:0`, context);
  assert.equal(calls.filter(([name]) => name === 'remove-document').length, 1);
  assert.equal(calls.filter(([name]) => name === 'remove-visual').length, 0);
  await service.handleCallback(`gallery:delete:v:${VISUAL_ID}:0`, context);
  assert.equal(calls.filter(([name]) => name === 'remove-visual').length, 1);
});

test('missing content is non-destructive and returns to the current page', async () => {
  const { service, calls, context } = harness({
    knowledgeService: { async readForDelivery() { return null; }, async remove() { throw new Error('must not remove'); } },
    visualMemoryService: null,
  });
  const result = await service.handleCallback(`gallery:open:d:${DOCUMENT_ID}:0`, context);
  assert.match(result.answer, /недоступен/);
  assert.equal(calls.some(([name]) => name.startsWith('remove-')), false);
});

test('read failures expose no storage error and do not delete content', async () => {
  const { service, calls, context } = harness({
    knowledgeService: { async readForDelivery() { throw new Error('/srv/private/opaque'); }, async remove() { throw new Error('must not remove'); } },
    visualMemoryService: null,
  });
  const result = await service.handleCallback(`gallery:open:d:${DOCUMENT_ID}:0`, context);
  assert.match(result.answer, /не удалось подготовить/);
  assert.doesNotMatch(result.answer, /srv|opaque/);
  assert.equal(calls.some(([name]) => name.startsWith('remove-')), false);
});
