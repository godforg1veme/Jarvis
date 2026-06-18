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

  const created = await executeToolRequest({
    action: 'file.create_folder',
    args: { path: path.join(root, 'Images') },
  }, { allowRoots: [root], confirmed: true });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(fs.existsSync(path.join(root, 'Images')), true);

  const createdAgain = await executeToolRequest({
    action: 'file.create_folder',
    args: { path: path.join(root, 'Images') },
  }, { allowRoots: [root], confirmed: true });
  assert.strictEqual(createdAgain.ok, true);
  assert.strictEqual(path.basename(createdAgain.path), 'Images (1)');

  const renameSource = path.join(root, 'rename-me.txt');
  fs.writeFileSync(renameSource, 'rename');
  const renamed = await executeToolRequest({
    action: 'file.rename',
    args: { from: renameSource, newName: 'renamed.txt' },
  }, { allowRoots: [root], confirmed: true });
  assert.strictEqual(renamed.ok, true);
  assert.strictEqual(fs.existsSync(path.join(root, 'renamed.txt')), true);

  const copySource = path.join(root, 'copy-me.txt');
  fs.writeFileSync(copySource, 'copy');
  const copied = await executeToolRequest({
    action: 'file.copy',
    args: { from: copySource, to: path.join(root, 'Images') },
  }, { allowRoots: [root], confirmed: true });
  assert.strictEqual(copied.ok, true);
  assert.strictEqual(fs.existsSync(path.join(root, 'Images', 'copy-me.txt')), true);

  const moved = await executeToolRequest({
    action: 'file.move',
    args: { from: copied.to, to: path.join(root, 'moved.txt') },
  }, { allowRoots: [root], confirmed: true });
  assert.strictEqual(moved.ok, true);
  assert.strictEqual(fs.existsSync(path.join(root, 'moved.txt')), true);

  const trashed = [];
  const recycled = await executeToolRequest({
    action: 'file.delete',
    args: { path: moved.to },
  }, {
    allowRoots: [root],
    confirmed: true,
    shell: { trashItem: async (targetPath) => { trashed.push(targetPath); } },
  });
  assert.strictEqual(recycled.ok, true);
  assert.deepStrictEqual(trashed, [moved.to]);

  const permanentPath = path.join(root, 'permanent.txt');
  fs.writeFileSync(permanentPath, 'delete');
  const permanent = await executeToolRequest({
    action: 'file.permanent_delete',
    args: { path: permanentPath },
  }, { allowRoots: [root], strongConfirmed: true });
  assert.strictEqual(permanent.ok, true);
  assert.strictEqual(fs.existsSync(permanentPath), false);

  const batchDir = path.join(root, 'Batch');
  fs.mkdirSync(batchDir);
  const batchFiles = ['a.txt', 'b.txt'].map((name) => {
    const filePath = path.join(root, name);
    fs.writeFileSync(filePath, name);
    return filePath;
  });
  const batchMoved = await executeToolRequest({
    action: 'file.move_batch',
    args: { paths: batchFiles, to: batchDir },
  }, { allowRoots: [root], strongConfirmed: true });
  assert.strictEqual(batchMoved.ok, true);
  assert.strictEqual(batchMoved.results.length, 2);

  const tooMany = await executeToolRequest({
    action: 'file.copy_batch',
    args: { paths: Array.from({ length: 21 }, (_, index) => ({ path: path.join(batchDir, 'a.txt'), to: path.join(root, `x-${index}.txt`) })) },
  }, { allowRoots: [root], strongConfirmed: true });
  assert.strictEqual(tooMany.ok, false);
  assert.match(tooMany.error, /batch limit exceeded/);

  const windowCalls = [];
  const fakeWindowTools = {
    listWindows: async () => [{ hwnd: 1, title: 'Code' }],
    focusWindow: async (hwnd) => ({ ok: true, hwnd }),
    restoreWindow: async (hwnd) => ({ ok: true, hwnd }),
    closeWindow: async (hwnd) => ({ ok: true, hwnd }),
    moveResizeWindow: async (hwnd, rect) => {
      windowCalls.push({ hwnd, rect });
      return { ok: true };
    },
    snapRect: (position) => ({ x: position === 'right' ? 500 : 0, y: 0, width: 500, height: 800 }),
    multiWindowLayout: () => [
      { x: 0, y: 0, width: 500, height: 800 },
      { x: 500, y: 0, width: 500, height: 800 },
    ],
  };

  const windows = await executeToolRequest({ action: 'window.list', args: {} }, { windowTools: fakeWindowTools });
  assert.strictEqual(windows.ok, true);
  assert.strictEqual(windows.windows[0].title, 'Code');

  const focused = await executeToolRequest({ action: 'window.focus', args: { hwnd: 1 } }, { windowTools: fakeWindowTools });
  assert.strictEqual(focused.ok, true);

  const closeBlocked = await executeToolRequest({ action: 'window.close', args: { hwnd: 1 } }, { windowTools: fakeWindowTools });
  assert.strictEqual(closeBlocked.requiresConfirmation, true);

  const layout = await executeToolRequest({
    action: 'window.layout',
    args: { hwnds: [1, 2], layout: 'two-columns' },
  }, { windowTools: fakeWindowTools, confirmed: true });
  assert.strictEqual(layout.ok, true);
  assert.strictEqual(windowCalls.length, 2);

  console.log('[testToolGateway] gateway policy tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
