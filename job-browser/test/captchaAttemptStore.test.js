const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CaptchaAttemptStore, MAX_RECORDS, TTL_MS, MAX_BYTES } = require('../src/captchaAttemptStore');
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=';
const linux = { skip: process.platform !== 'linux' };
async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-evidence-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const ownerId = randomUUID(), root = path.join(parent, 'archive'); let time = 1000000000;
  const store = new CaptchaAttemptStore({ root, ownerId, now: () => time });
  return { store, root, parent, ownerId, advance: n => { time += n; },
    start: () => store.start({ recoveryId: randomUUID(), attempt: 1, pngBase64 }) };
}
test('Linux evidence round trip is durable, private, closed and owner-bound', linux, async t => {
  const f = await fixture(t), record = await f.start();
  await f.store.update(record.id, { answer: 'проверка картинки', phase: 'dispatch_started' });
  const restarted = new CaptchaAttemptStore({ root: f.root, ownerId: f.ownerId });
  const value = await restarted.read(record.id);
  assert.equal(value.pngBase64, pngBase64); assert.equal(value.answer, 'проверка картинки');
  assert.equal((await fs.stat(f.root)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(f.store.file(record.id))).mode & 0o777, 0o600);
  await assert.rejects(new CaptchaAttemptStore({ root: f.root, ownerId: randomUUID() }).export());
  await assert.rejects(f.store.update(record.id, { headers: 'private' }));
  await assert.rejects(f.store.update(record.id, { answer: 'private-token' }));
  await assert.rejects(f.store.update(record.id, { receipt: { received: true, permitted: 1, httpStatus: 200, verification: 'captcha', body: 'private' } }));
});
test('Linux retention removes expired records, caps count and exports no expired data', linux, async t => {
  const f = await fixture(t); await f.start(); f.advance(TTL_MS + 1);
  assert.deepEqual(await f.store.export(), []);
  await f.store.prune(); assert.equal((await fs.readdir(f.root)).length, 1);
  for (let i = 0; i < MAX_RECORDS + 2; i++) { f.advance(1); await f.start(); }
  assert.equal((await f.store.export()).length, MAX_RECORDS);
  assert.equal((await fs.readdir(f.root)).length, MAX_RECORDS + 1);
});
test('Linux evidence rejects unsafe files, symlinks and oversized records', linux, async t => {
  const f = await fixture(t), record = await f.start(), file = f.store.file(record.id);
  await fs.chmod(file, 0o644); await assert.rejects(f.store.export()); await fs.chmod(file, 0o600);
  const copy = path.join(f.parent, 'copy'); await fs.rename(file, copy); await fs.symlink(copy, file);
  await assert.rejects(f.store.export()); await fs.unlink(file); await fs.rename(copy, file);
  await fs.writeFile(file, Buffer.alloc(MAX_BYTES + 1)); await assert.rejects(f.store.export());
  await fs.unlink(file); await fs.chmod(f.root, 0o755); await assert.rejects(f.store.export());
  await fs.chmod(f.root, 0o700);
  const link = path.join(f.parent, 'link'); await fs.symlink(f.root, link);
  await assert.rejects(new CaptchaAttemptStore({ root: link, ownerId: f.ownerId }).export());
});
