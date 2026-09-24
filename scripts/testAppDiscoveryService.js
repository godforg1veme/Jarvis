const assert = require('assert');
const { AppDiscoveryService, shouldExcludeDirectory } = require('../tools/appDiscoveryService');

assert.strictEqual(shouldExcludeDirectory('node_modules', 'C:\\x\\node_modules'), true);
assert.strictEqual(shouldExcludeDirectory('Apps', 'D:\\Apps'), false);

function dirent(name, type) {
  return { name, isDirectory: () => type === 'dir', isFile: () => type === 'file' };
}

const tree = {
  'D:\\': [dirent('Apps', 'dir'), dirent('node_modules', 'dir')],
  'D:\\Apps': [dirent('Obsidian.exe', 'file'), dirent('readme.txt', 'file')],
};
const fakeFs = {
  promises: {
    readdir: async target => {
      if (!tree[target]) throw new Error('denied');
      return tree[target];
    },
  },
};

(async () => {
  let progress = null;
  const service = new AppDiscoveryService({ fs: fakeFs, driveProvider: () => ['D:\\'], now: () => 0 });
  const result = await service.discoverExtended('obsidian', { timeoutMs: 100, onProgress: value => { progress = value; } });
  assert.strictEqual(result.candidates.length, 1);
  assert.strictEqual(result.candidates[0].path, 'D:\\Apps\\Obsidian.exe');
  assert.strictEqual(progress.found, 1);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await service.discoverExtended('x', { signal: controller.signal });
  assert.strictEqual(cancelled.cancelled, true);
  console.log('testAppDiscoveryService: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
