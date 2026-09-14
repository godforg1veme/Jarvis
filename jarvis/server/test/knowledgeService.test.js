const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const { DocumentStorage, storageKeyForId } = require('../src/knowledge/documentStorage');
const { chunkText, extractDocumentText } = require('../src/knowledge/documentText');
const { attachmentFromTelegramMessage, classifyAttachment } = require('../src/knowledge/fileTypes');
const { KnowledgeService, renderDocumentCitations } = require('../src/knowledge/knowledgeService');
const { SystemDocumentExtractor } = require('../src/knowledge/systemDocumentExtractor');

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const source = Buffer.from(text, 'utf8');
    const compressed = zlib.deflateRawSync(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

test('classifies text, office, image, audio, video, archive, and arbitrary binary attachments', () => {
  assert.equal(classifyAttachment({ name: 'notes.md', mimeType: 'text/markdown' }).category, 'text');
  assert.equal(classifyAttachment({ name: 'contract.pdf', mimeType: 'application/pdf' }).category, 'document');
  assert.equal(classifyAttachment({ name: 'voice.ogg', mimeType: 'audio/ogg' }).category, 'audio');
  assert.equal(classifyAttachment({ name: 'clip.mp4', mimeType: 'video/mp4' }).category, 'video');
  assert.equal(classifyAttachment({ name: 'archive.7z', mimeType: 'application/x-7z-compressed' }).category, 'archive');
  assert.equal(classifyAttachment({ name: 'firmware.bin', mimeType: 'application/octet-stream' }).category, 'binary');

  const attachment = attachmentFromTelegramMessage({
    video: { file_id: 'video-id', file_unique_id: 'unique-video', file_size: 44, mime_type: 'video/mp4', duration: 12 },
    caption: 'семейный ролик',
  });
  assert.equal(attachment.category, 'video');
  assert.equal(attachment.durationSeconds, 12);
  assert.equal(attachment.caption, 'семейный ролик');
});

test('text extraction normalizes text while media remains searchable by private metadata', () => {
  const text = extractDocumentText({
    buffer: Buffer.from('  # План\r\nПривет, мир  ', 'utf8'),
    document: { originalName: 'plan.md', mediaType: 'text/markdown', category: 'text' },
  });
  assert.equal(text.mode, 'content');
  assert.match(text.content, /План/);
  assert.match(text.content, /Привет, мир/);

  const media = extractDocumentText({
    buffer: Buffer.from([1, 2, 3]),
    document: { originalName: 'voice.ogg', mediaType: 'audio/ogg', category: 'audio', durationSeconds: 19, caption: 'голосовая заметка' },
  });
  assert.equal(media.mode, 'metadata');
  assert.match(media.content, /voice\.ogg/);
  assert.match(media.content, /19 с/);
  assert.match(media.content, /голосовая заметка/);
  assert.ok(chunkText('x'.repeat(12000)).length > 1);
});

test('extracts DOCX body, header, and footer without unpacking the archive to disk', () => {
  const docx = makeZip([
    ['word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Основной текст</w:t></w:r></w:p></w:body></w:document>'],
    ['word/header1.xml', '<w:hdr><w:p><w:r><w:t>Шапка</w:t></w:r></w:p></w:hdr>'],
    ['word/footer1.xml', '<w:ftr><w:p><w:r><w:t>Подвал</w:t></w:r></w:p></w:ftr>'],
  ]);
  const extracted = extractDocumentText({
    buffer: docx,
    document: { originalName: 'contract.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document' },
  });
  assert.equal(extracted.mode, 'content');
  assert.match(extracted.content, /Основной текст/);
  assert.match(extracted.content, /Шапка/);
  assert.match(extracted.content, /Подвал/);
  assert.throws(() => extractDocumentText({
    buffer: Buffer.from('not a zip'),
    document: { originalName: 'broken.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document' },
  }), /invalid|missing|unsupported/i);
});

test('extracts PDF text into page-cited chunks through the bounded system adapter', async () => {
  const calls = [];
  const extractor = new SystemDocumentExtractor({
    pdfToTextBin: 'safe-pdftotext',
    runCommand: async (input) => {
      calls.push(input);
      return 'Первая страница\fВторая страница';
    },
  });
  const extracted = await extractor.extract({
    buffer: Buffer.from('%PDF'),
    storagePath: '/private/opaque-file',
    document: { originalName: 'manual.pdf', mediaType: 'application/pdf', category: 'document' },
  });
  assert.equal(extracted.mode, 'content');
  assert.deepEqual(calls[0], {
    executable: 'safe-pdftotext',
    args: ['-enc', 'UTF-8', '/private/opaque-file', '-'],
  });
  assert.equal(extracted.chunks.find((chunk) => chunk.metadata.page === 1).content, 'Первая страница');
  assert.equal(extracted.chunks.find((chunk) => chunk.metadata.page === 2).content, 'Вторая страница');
});

test('adds bounded media metadata without failing an accepted upload on probe errors', async () => {
  const extractor = new SystemDocumentExtractor({
    ffprobeBin: 'safe-ffprobe',
    runCommand: async () => JSON.stringify({
      format: { duration: '42.4', tags: { title: 'Семейная запись', artist: 'Макс' } },
    }),
  });
  const extracted = await extractor.extract({
    buffer: Buffer.from([1, 2, 3]),
    storagePath: '/private/opaque-file',
    document: { originalName: 'voice.ogg', mediaType: 'audio/ogg', category: 'audio' },
  });
  assert.equal(extracted.mode, 'metadata');
  assert.match(extracted.content, /42 с/);
  assert.match(extracted.content, /Семейная запись/);
  assert.match(extracted.content, /Макс/);

  const unavailable = new SystemDocumentExtractor({ runCommand: async () => { throw new Error('not installed'); } });
  const fallback = await unavailable.extract({
    buffer: Buffer.from([1, 2, 3]),
    storagePath: '/private/opaque-file',
    document: { originalName: 'voice.ogg', mediaType: 'audio/ogg', category: 'audio', caption: 'заметка' },
  });
  assert.equal(fallback.mode, 'metadata');
  assert.match(fallback.content, /заметка/);
});

test('storage rejects path traversal and writes opaque documents with private permissions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-docs-'));
  try {
    const storage = new DocumentStorage({ root });
    const id = crypto.randomUUID();
    const key = storageKeyForId(id);
    await storage.write(key, Buffer.from('private text'));
    assert.equal((await storage.read(key)).toString('utf8'), 'private text');
    assert.throws(() => storage.pathFor('../outside'), /invalid document storage key/);
    await storage.remove(key);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ingests and indexes an owner-scoped text file, then renders only known citations', async () => {
  const state = { documents: new Map(), jobs: [], chunks: [], searchedUser: null };
  const storage = {
    files: new Map(),
    async write(key, data) { this.files.set(key, Buffer.from(data)); },
    async read(key) { return this.files.get(key); },
    async remove(key) { this.files.delete(key); },
  };
  const repository = {
    async createPending(input) {
      const document = { id: input.id, user_id: input.userId, original_name: input.originalName, media_type: input.mediaType, storage_key: input.storageKey, category: input.category, metadata: input.metadata, status: 'pending' };
      state.documents.set(input.id, document);
      return document;
    },
    async enqueueIngest({ userId, documentId }) {
      const job = { id: 'job-1', user_id: userId, payload: { documentId }, attempts: 1, max_attempts: 3 };
      state.jobs.push(job);
      return job;
    },
    async getForWorker(id) { return state.documents.get(id) || null; },
    async markReady({ documentId, chunks, extractionMode }) {
      state.documents.get(documentId).status = 'ready';
      state.documents.get(documentId).extraction_mode = extractionMode;
      state.chunks = chunks;
    },
    async completeJob() {},
    async failJob() { throw new Error('must not fail'); },
    async search({ userId }) {
      state.searchedUser = userId;
      return [{ original_name: 'notes.md', media_type: 'text/markdown', category: 'text', content: state.chunks[0].content, metadata: { page: 3 } }];
    },
  };
  const service = new KnowledgeService({ repository, storage, maxBytes: 1024 * 1024 });
  const data = Buffer.from('Привет, мир!');
  const document = await service.ingest({
    userId: 'owner-a',
    attachment: { name: 'notes.md', mimeType: 'text/markdown', byteSize: data.length, caption: 'личная заметка' },
    data,
  });
  assert.equal(document.category, 'text');
  await service.processJob(state.jobs[0]);
  assert.equal(state.documents.get(document.id).status, 'ready');
  const sources = await service.searchForPrompt({ userId: 'owner-a', query: 'Привет' });
  assert.equal(state.searchedUser, 'owner-a');
  assert.equal(sources[0].source, 'S1');
  assert.equal(renderDocumentCitations('Ответ [S1] и [S99].', sources), 'Ответ [notes.md, стр. 3] и .');
});

test('passes only the opaque storage path to a queued extractor', async () => {
  const documentId = crypto.randomUUID();
  let received = null;
  const repository = {
    async getForWorker() {
      return {
        id: documentId,
        user_id: 'owner-a',
        storage_key: 'aa/bb/opaque',
        original_name: 'private.pdf',
        media_type: 'application/pdf',
        category: 'document',
        metadata: {},
      };
    },
    async markReady() {},
    async completeJob() {},
    async failJob() { throw new Error('must not fail'); },
  };
  const storage = {
    async read() { return Buffer.from('%PDF'); },
    pathFor(key) {
      assert.equal(key, 'aa/bb/opaque');
      return '/srv/jarvis/documents/aa/bb/opaque';
    },
  };
  const service = new KnowledgeService({
    repository,
    storage,
    extract: async (input) => {
      received = input;
      return { content: 'индексируемый текст', mode: 'content' };
    },
  });
  await service.processJob({ id: 'job-1', payload: { documentId }, attempts: 1, maxAttempts: 3 });
  assert.equal(received.storagePath, '/srv/jarvis/documents/aa/bb/opaque');
  assert.equal(received.document.originalName, 'private.pdf');
});

test('rejects changed or oversized attachment bytes before persistence', async () => {
  const repository = { async createPending() { throw new Error('must not persist'); } };
  const storage = { async write() { throw new Error('must not write'); }, async remove() {} };
  const service = new KnowledgeService({ repository, storage, maxBytes: 4 });
  await assert.rejects(
    service.ingest({ userId: 'owner', attachment: { name: 'a.txt', mimeType: 'text/plain', byteSize: 10 }, data: Buffer.from('abc') }),
    /size changed/,
  );
  await assert.rejects(
    service.ingest({ userId: 'owner', attachment: { name: 'a.txt', mimeType: 'text/plain', byteSize: 5 }, data: Buffer.from('abcde') }),
    /too large/,
  );
});

test('reads a document for delivery only through an owner-scoped record', async () => {
  const calls = [];
  const repository = {
    async getActiveForUser(input) {
      calls.push(input);
      return input.userId === 'owner-a'
        ? { original_name: 'photo.jpg', media_type: 'image/jpeg', category: 'image', storage_key: 'aa/opaque' }
        : null;
    },
  };
  const storage = { async read(key) { assert.equal(key, 'aa/opaque'); return Buffer.from('private-image'); } };
  const service = new KnowledgeService({ repository, storage, maxBytes: 1024 });
  const delivery = await service.readForDelivery({ userId: 'owner-a', documentId: 'doc-a' });
  assert.equal(delivery.content.toString(), 'private-image');
  assert.equal(delivery.filename, 'photo.jpg');
  assert.equal('storageKey' in delivery || 'storage_key' in delivery, false);
  assert.equal(await service.readForDelivery({ userId: 'other-owner', documentId: 'doc-a' }), null);
  assert.deepEqual(calls[0], { userId: 'owner-a', documentId: 'doc-a' });
});
