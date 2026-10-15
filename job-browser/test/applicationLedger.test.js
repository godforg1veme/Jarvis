const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ApplicationLedger } = require('../src/applicationLedger');

test('Linux durable ledger: concurrent claims click once, restart/new IDs cannot repeat unknown; confirmed results are immutable',
  { skip: process.platform !== 'linux' }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-job-ledger-')); await fs.chmod(root, 0o700);
    const ownerId = randomUUID(), input = { userId: ownerId, operationId: randomUUID(), externalId: '123', resumeId: 'fixtureResume', letter: 'Одобренный текст, без изменений.' };
    const create = () => new ApplicationLedger({ root, ownerId });
    try {
      const results = await Promise.all(Array.from({ length: 8 }, () => create().reserve(input)));
      assert.equal(results.filter((value) => value.execute).length, 1);
      assert.equal((await create().reserve(input)).execute, false);
      assert.equal((await create().reserve({ ...input, operationId: randomUUID() })).execute, false);
      assert.deepEqual(await create().lookup(input), { outcome: 'unknown' });
      await assert.rejects(create().reserve({ ...input, letter: `${input.letter} ` }), { code: 'JOB_BROWSER_OPERATION_CHANGED' });
      await assert.rejects(create().reserve({ ...input, externalId: '124' }), { code: 'JOB_BROWSER_OPERATION_CHANGED' });
      await assert.rejects(create().reserve({ ...input, userId: randomUUID() }), { code: 'JOB_BROWSER_ACCESS_DENIED' });
      assert.deepEqual(await create().finish(input, { outcome: 'sent', externalId: 'fixture-topic' }), { outcome: 'unknown' });
      const confirmed = { outcome: 'sent', verified: true, externalId: 'fixture-topic' };
      assert.deepEqual(await create().finish(input, confirmed), confirmed);
      assert.deepEqual(await create().finish(input, { outcome: 'failed', verified: true }), confirmed);
      assert.deepEqual(await create().lookup(input), confirmed);
      const files = await fs.readdir(root);
      for (const name of files) {
        assert.equal((await fs.stat(path.join(root, name))).mode & 0o777, 0o600);
        assert.ok(!(await fs.readFile(path.join(root, name), 'utf8')).includes(input.letter), 'journal does not store letter text');
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

test('Linux ledger fails closed for partial files, unsafe permissions and symlinks', { skip: process.platform !== 'linux' }, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-job-ledger-')); await fs.chmod(parent, 0o700);
  const root = path.join(parent, 'ledger'), ownerId = randomUUID();
  const input = { userId: ownerId, operationId: randomUUID(), externalId: '123', resumeId: 'fixture', letter: 'Fixture approved letter' };
  const ledger = new ApplicationLedger({ root, ownerId });
  try {
    await ledger.reserve(input);
    const operation = (await fs.readdir(root)).find((name) => name.startsWith('operation-'));
    await fs.writeFile(path.join(root, operation), '{');
    await assert.rejects(ledger.reserve(input), { code: 'JOB_BROWSER_LEDGER_UNAVAILABLE' });
    await fs.chmod(root, 0o755);
    await assert.rejects(ledger.lookup(input), { code: 'JOB_BROWSER_LEDGER_UNAVAILABLE' });
    await fs.chmod(root, 0o700);
    const linkedRoot = path.join(parent, 'linked'); await fs.symlink(root, linkedRoot);
    await assert.rejects(new ApplicationLedger({ root: linkedRoot, ownerId }).lookup(input), { code: 'JOB_BROWSER_LEDGER_UNAVAILABLE' });
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
