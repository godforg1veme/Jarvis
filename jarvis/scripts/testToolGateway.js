const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  POLICY,
  executeToolRequest,
  normalizePath,
  policyForAction,
  validateToolRequest,
} = require('../agents/toolGateway');

function makeTempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-gateway-'));
  fs.mkdirSync(path.join(root, 'Desktop'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Desktop', 'image.png'), 'png');
  fs.writeFileSync(path.join(root, 'Desktop', 'run.bat'), 'bat');
  return root;
}

async function run() {
  assert.strictEqual(policyForAction('file.search'), POLICY.OBSERVE);
  assert.strictEqual(policyForAction('file.move_batch'), POLICY.STRONG);
  assert.throws(() => validateToolRequest({ action: 'file.nope', args: {} }), /unknown tool action/);

  const root = makeTempTree();
  const desktop = path.join(root, 'Desktop');
  assert.strictEqual(normalizePath(path.join(desktop, '..', 'Desktop'), { allowRoots: [root] }), desktop);
  assert.throws(() => normalizePath('C:\\Windows', { allowRoots: [root] }), /outside allowed roots/);

  const listed = await executeToolRequest({
    action: 'file.list_directory',
    args: { path: desktop },
  }, { allowRoots: [root] });
  assert.strictEqual(listed.ok, true);
  assert.strictEqual(listed.entries.some((entry) => entry.name === 'image.png'), true);

  const searched = await executeToolRequest({
    action: 'file.search',
    args: { query: 'image.png', location: 'desktop', limit: 5 },
  }, {
    locationPath: desktop,
    standardLocations: [{ id: 'desktop', path: desktop }],
    enableDiskScan: false,
  });
  assert.strictEqual(searched.ok, true);
  assert.strictEqual(searched.results[0].name, 'image.png');

  const reveal = await executeToolRequest({
    action: 'file.reveal',
    args: { path: path.join(desktop, 'image.png') },
  }, {
    allowRoots: [root],
    shell: { showItemInFolder: () => {} },
  });
  assert.strictEqual(reveal.ok, true);

  const dangerousOpen = await executeToolRequest({
    action: 'file.open',
    args: { path: path.join(desktop, 'run.bat') },
  }, { allowRoots: [root] });
  assert.strictEqual(dangerousOpen.requiresConfirmation, true);

  const mutation = await executeToolRequest({
    action: 'file.move',
    args: { from: 'a', to: 'b' },
  });
  assert.strictEqual(mutation.requiresConfirmation, true);

  const strong = await executeToolRequest({
    action: 'file.delete_batch',
    args: { paths: ['a'] },
  });
  assert.strictEqual(strong.requiresStrongConfirmation, true);

  console.log('[testToolGateway] gateway policy tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
