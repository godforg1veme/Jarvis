const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { manifest, runSuite } = require('./testCore.cjs');
const fixedManifest = require('./coreTestManifest.json');

test('core suite membership comes only from the fixed manifest', () => {
  const suites = manifest();
  assert.deepEqual(suites.map(({ name, files }) => ({ name, files })),
    fixedManifest.map(({ name, files }) => ({ name, files })));
  assert.equal(suites.some(({ files }) => files.includes('cloud/futureEnvironment.test.js')), false);
});

async function fixture(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-core-runner-'));
  try {
    fs.writeFileSync(path.join(dir, 'fixture.test.cjs'), source);
    return await runSuite({ cwd: dir, files: ['fixture.test.cjs'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('runner accepts a passing suite with counted cases', async () => {
  const result = await fixture("require('node:test')('works', () => {});");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.totals.tests, 1);
  assert.equal(result.totals.pass, 1);
});

test('runner rejects assertion failure', async () => {
  const result = await fixture("require('node:test')('fails', () => { throw Error('expected fixture failure') });");
  assert.equal(result.ok, false);
  assert.equal(result.totals.fail, 1);
});

test('runner rejects empty suite', async () => {
  const result = await fixture('// no tests');
  assert.equal(result.ok, false);
  assert.equal(result.totals.tests, 1); // Node counts an otherwise empty test file.
});

test('runner rejects skipped suite', async () => {
  const result = await fixture("require('node:test')('skipped', { skip: true }, () => {});");
  assert.equal(result.ok, false);
  assert.equal(result.totals.skipped, 1);
});
