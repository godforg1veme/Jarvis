const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDocumentActions } = require('../src/miniApp/documentActions');
const { KnowledgeService } = require('../src/knowledge/knowledgeService');
const { DocumentRepository } = require('../src/knowledge/documentRepository');
const { DocumentStorage, storageKeyForId } = require('../src/knowledge/documentStorage');

const OWNER = '0f08a3ee-e496-47d7-92e0-bc6e35888dcc';
const OTHER = '8f67a243-0b6e-463d-9eb3-37bf595ec8d1';
const ID = 'e312e4a1-53a7-4a3d-b78e-959073f09fc0';
const OPERATION = '07cac75b-cbb0-4081-947a-50ac25491695';

function setup() {
  const files = new Map();
  const rows = new Map();
  const calls = [];
  const db = {
    async query(sql, values) {
      const statement = String(sql).trim();
      calls.push({ statement, values });
      if (statement.includes('ops_maintenance_flags')) return { rows: [{ enabled: false }], rowCount: 1 };
      if (statement.includes('SELECT id FROM users')) return { rows: [{ id: values[0] }], rowCount: 1 };
      if (statement.includes('COALESCE(SUM(byte_size)')) return { rows: [{ byte_size: '0' }], rowCount: 1 };
      if (statement.includes('INSERT INTO documents')) {
        const row = { id: values[0], user_id: values[1], original_name: values[2], media_type: values[3], storage_key: values[4], status: 'pending' };
        rows.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (statement.includes('INSERT INTO jobs')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (statement.includes('SELECT id,original_name,media_type,storage_key')) {
        const row = rows.get(values[0]);
        return { rows: row && row.user_id === values[1] && row.status !== 'deleted' ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (statement.includes('DELETE FROM documents')) {
        const row = rows.get(values[0]);
        if (!row || row.user_id !== values[1] || row.status === 'deleted') return { rows: [], rowCount: 0 };
        rows.delete(row.id);
        return { rows: [row], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${statement.slice(0, 45)}`);
    },
  };
  const storage = {
    async write(key, data) { files.set(key, Buffer.from(data)); },
    async remove(key) { files.delete(key); },
  };
  const pool = { async connect() { throw new Error('nested transaction'); }, async query() { throw new Error('outside transaction'); } };
  const knowledgeService = new KnowledgeService({ repository: new DocumentRepository(pool), storage, maxBytes: 1024 });
  return { actions: createDocumentActions({ knowledgeService }), db, rows, files, calls };
}

function uploadCommand(data, overrides = {}) {
  return {
    operationId: OPERATION, kind: 'upload', targetId: null, revision: null,
    input: { name: 'notes.txt', mediaType: 'text/plain', byteSize: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'), ...overrides },
  };
}

test('document Mini App upload validates exact file metadata and joins the caller transaction', async () => {
  const { actions, db, files, calls } = setup();
  const data = Buffer.from('personal notes');
  for (const invalid of [
    uploadCommand(data, { name: '../notes.txt' }),
    uploadCommand(data, { mediaType: 'application/octet-stream' }),
    uploadCommand(data, { name: 'notes.exe' }),
    uploadCommand(data, { byteSize: 1025 }),
  ]) assert.throws(() => actions.validate(invalid), { code: 'invalid_request' });
  const command = actions.validate(uploadCommand(data));
  await assert.rejects(actions.prepare({ actor: { userId: OWNER }, command, data: Buffer.from('tampered') }), { code: 'invalid_request' });
  const prepared = await actions.prepare({ actor: { userId: OWNER }, command, data });
  assert.equal(calls.length, 0, 'file preparation must not hold a database transaction');
  await assert.rejects(actions.execute({ db, actor: { userId: OTHER }, command, prepared }), /prepared document/);
  const outcome = await actions.execute({ db, actor: { userId: OWNER }, command, prepared });
  assert.deepEqual(Object.keys(outcome.result), ['id', 'title', 'revision']);
  assert.equal(files.size, 1);
  assert.ok(calls.some(({ statement }) => statement.includes('INSERT INTO jobs')));
  assert.ok(!calls.some(({ statement }) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(statement)));
  assert.ok(!JSON.stringify(outcome.result).includes('storage_key'));
  await outcome.onRollback();
  assert.equal(files.size, 0);
});

test('document storage removes a partial write without touching an existing file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-doc-atomic-'));
  const key = storageKeyForId(ID);
  const target = path.join(root, key);
  try {
    const failingFs = {
      ...fs,
      async open(file, flags, mode) {
        const handle = await fs.open(file, flags, mode);
        return {
          async writeFile(data) {
            await handle.writeFile(data.subarray(0, 3));
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          },
          async close() { await handle.close(); },
        };
      },
    };
    const storage = new DocumentStorage({ root, fs: failingFs });
    await assert.rejects(storage.write(key, Buffer.from('private content')), { code: 'ENOSPC' });
    assert.deepEqual(await fs.readdir(path.dirname(target)), []);
    await fs.writeFile(target, 'original');
    await assert.rejects(storage.write(key, Buffer.from('replacement')), { code: 'ENOSPC' });
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    await assert.rejects(new DocumentStorage({ root }).write(key, Buffer.from('replacement')), { code: 'EEXIST' });
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(path.dirname(target)), [ID]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('document Mini App delete keeps file through rollback and removes it only after commit', async () => {
  const { actions, db, rows, files } = setup();
  const row = { id: ID, user_id: OWNER, original_name: 'secret.txt', media_type: 'text/plain', storage_key: 'aa/opaque', status: 'ready' };
  rows.set(ID, row);
  files.set(row.storage_key, Buffer.from('secret'));
  const target = await actions.target({ db, actor: { userId: OWNER }, targetId: ID });
  await assert.rejects(actions.target({ db, actor: { userId: OTHER }, targetId: ID }), { code: 'not_found' });
  const command = actions.validate({ operationId: OPERATION, kind: 'delete', targetId: ID, revision: target.revision, input: {} });
  await assert.rejects(actions.execute({ db, actor: { userId: OTHER }, command }), { code: 'not_found' });
  await assert.rejects(actions.execute({ db, actor: { userId: OWNER }, command: { ...command, revision: '0'.repeat(64) } }), { code: 'revision_conflict' });
  const outcome = await actions.execute({ db, actor: { userId: OWNER }, command });
  assert.deepEqual(outcome.result, { id: ID, deleted: true });
  assert.equal(rows.has(ID), false);
  assert.equal(files.size, 1);
  rows.set(ID, row); // simulate a transaction rollback
  assert.equal(files.size, 1);
  rows.delete(ID); // simulate committed retry
  await outcome.afterCommit();
  assert.equal(files.size, 0);
});
