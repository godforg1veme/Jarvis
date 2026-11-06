const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { apply, OUTPUT_SHA256 } = require('../patches/applyPlaywrightRouteCleanup');

function withIsolatedPackage(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-playwright-patch-'));
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    const source = path.join(__dirname, '..', 'node_modules', 'playwright-core');
    fs.copyFileSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
    fs.copyFileSync(path.join(source, 'lib', 'coreBundle.js'), path.join(root, 'lib', 'coreBundle.js'));
    return run(root);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.match(path.basename(root), /^jarvis-playwright-patch-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('pinned patch changes only isolated bundle and preserves valid JavaScript', () => withIsolatedPackage(root => {
  const bundle = path.join(root, 'lib', 'coreBundle.js');
  const before = fs.readFileSync(bundle, 'utf8');
  apply(root);
  const after = fs.readFileSync(bundle, 'utf8');
  assert.equal(createHash('sha256').update(after).digest('hex'), OUTPUT_SHA256);
  if (createHash('sha256').update(before).digest('hex') !== OUTPUT_SHA256) assert.notEqual(after, before);
  assert.match(after, /this\.on\(BrowserContextEvent\.PageClosed, \(page\) =>/);
  assert.match(after, /if \(route\._request\?\._frame\?\._page === page\) this\.removeRouteInFlight\(route\)/);
  assert.equal((after.match(/finally \{ this\._endHandling\(\); \}/g) || []).length, 4);
  new vm.Script(after);
  apply(root);
  assert.equal(fs.readFileSync(bundle, 'utf8'), after);
}));

test('patch refuses version or source drift before writing', () => withIsolatedPackage(root => {
  const manifest = path.join(root, 'package.json'), bundle = path.join(root, 'lib', 'coreBundle.js');
  const original = fs.readFileSync(bundle);
  fs.writeFileSync(manifest, JSON.stringify({ name: 'playwright-core', version: '1.64.1' }));
  assert.throws(() => apply(root), { message: 'PLAYWRIGHT_ROUTE_PATCH_FAILED' });
  assert.deepEqual(fs.readFileSync(bundle), original);
  fs.writeFileSync(manifest, JSON.stringify({ name: 'playwright-core', version: '1.64.0' }));
  fs.appendFileSync(bundle, '\n');
  const drifted = fs.readFileSync(bundle);
  assert.throws(() => apply(root), { message: 'PLAYWRIGHT_ROUTE_PATCH_FAILED' });
  assert.deepEqual(fs.readFileSync(bundle), drifted);
}));
