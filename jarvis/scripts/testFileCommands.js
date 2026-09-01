const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeLocation, resolveLocationPath, isBroadLocation } = require('../tools/fileLocations');
const { isDangerousFile, normalizeExtension } = require('../tools/fileSafety');
const { searchDirectory, searchFiles } = require('../tools/fileSearch');
const { writeIndex, readIndex, searchIndex } = require('../tools/fileIndex');
const { parseFileCommand } = require('../tools/fileCommandParser');
const fileCommander = require('../tools/fileCommander');
const { parseIntent } = require('../voice/intentParser');

function testLocations() {
  assert.strictEqual(normalizeLocation('на рабочем столе'), 'desktop');
  assert.strictEqual(normalizeLocation('в загрузках'), 'downloads');
  assert.strictEqual(normalizeLocation('в документах'), 'documents');
  assert.strictEqual(normalizeLocation('на компьютере'), 'computer');
  assert.strictEqual(normalizeLocation('не помню где'), 'computer');
  assert.strictEqual(isBroadLocation('computer'), true);
  assert.strictEqual(isBroadLocation('desktop'), false);

  const desktop = resolveLocationPath('desktop', { USERPROFILE: 'C:\\Users\\Tester' });
  assert.strictEqual(desktop, path.join('C:\\Users\\Tester', 'Desktop'));
}

function testSafety() {
  assert.strictEqual(normalizeExtension('Setup.EXE'), '.exe');
  assert.strictEqual(normalizeExtension('archive.tar.gz'), '.gz');
  assert.strictEqual(isDangerousFile('run.bat'), true);
  assert.strictEqual(isDangerousFile('install.MSI'), true);
  assert.strictEqual(isDangerousFile('invoice.pdf'), false);
}

function makeTempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-file-'));
  fs.mkdirSync(path.join(root, 'Desktop'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Documents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Downloads'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Desktop', 'проверка'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Desktop', 'image.png'), 'png');
  fs.writeFileSync(path.join(root, 'Documents', 'config.json'), '{}');
  fs.writeFileSync(path.join(root, 'Downloads', 'invoice.pdf'), 'pdf');
  fs.writeFileSync(path.join(root, 'Downloads', 'setup.exe'), 'exe');
  fs.writeFileSync(path.join(root, 'node_modules', 'setup.exe'), 'skip');
  return root;
}

async function testSearchAndIndex() {
  const root = makeTempTree();
  const docs = path.join(root, 'Documents');
  const downloads = path.join(root, 'Downloads');
  const indexPath = path.join(root, 'file-index.json');

  const configResults = searchDirectory(docs, 'config.json', { maxResults: 10, maxDepth: 2 });
  assert.strictEqual(configResults.length, 1);
  assert.strictEqual(configResults[0].name, 'config.json');
  assert.strictEqual(configResults[0].dangerous, false);

  const folderResults = searchDirectory(path.join(root, 'Desktop'), 'проверка', { maxResults: 10, maxDepth: 2 });
  assert.strictEqual(folderResults.length, 1);
  assert.strictEqual(folderResults[0].name, 'проверка');
  assert.strictEqual(folderResults[0].type, 'directory');
  assert.strictEqual(folderResults[0].dangerous, false);

  const wildcardResults = searchDirectory(path.join(root, 'Desktop'), '*.png', { maxResults: 10, maxDepth: 2 });
  assert.strictEqual(wildcardResults.length, 1);
  assert.strictEqual(wildcardResults[0].name, 'image.png');

  const broadResults = await searchFiles({ query: 'setup.exe', location: 'computer' }, {
    standardLocations: [{ id: 'downloads', path: downloads }],
    indexPath,
    enableDiskScan: false,
    useEverything: false,
  });
  assert.strictEqual(broadResults.results[0].name, 'setup.exe');
  assert.strictEqual(broadResults.results[0].dangerous, true);

  writeIndex(indexPath, [{ id: 'downloads', path: downloads }], { now: '2026-06-18T00:00:00.000Z' });
  const index = readIndex(indexPath);
  assert.strictEqual(index.files.some((file) => file.name === 'setup.exe'), true);
  const indexed = searchIndex(indexPath, 'setup.exe');
  assert.strictEqual(indexed[0].name, 'setup.exe');

  const desktopPath = path.join(root, 'Desktop');
  const providerCalls = [];
  const providerResult = await searchFiles({
    query: 'проверка',
    location: 'desktop',
    targetType: 'directory',
  }, {
    locationPath: desktopPath,
    standardLocations: [{ id: 'desktop', path: desktopPath }],
    everythingProvider: async (args) => {
      providerCalls.push(args.exact);
      return {
        ok: true,
        results: [
          { type: 'directory', name: 'проверка', path: path.join(desktopPath, 'проверка'), score: 0 },
          { type: 'directory', name: 'проверка', path: path.join(desktopPath, 'nested', 'проверка'), score: 0 },
        ],
      };
    },
  });
  assert.deepStrictEqual(providerCalls, [true]);
  assert.strictEqual(providerResult.provider, 'everything');
  assert.deepStrictEqual(providerResult.results.map((result) => result.path), [path.join(desktopPath, 'проверка')]);

  const degraded = await searchFiles({ query: 'invoice.pdf', location: 'downloads', targetType: 'file' }, {
    locationPath: downloads,
    standardLocations: [{ id: 'downloads', path: downloads }],
    everythingProvider: async () => ({ ok: false, reason: 'everything_ipc_unavailable', results: [] }),
  });
  assert.strictEqual(degraded.degraded, true);
  assert.strictEqual(degraded.providerFailure, 'everything_ipc_unavailable');
  assert.strictEqual(degraded.results[0].name, 'invoice.pdf');
}

function testTextFileCommandParsing() {
  assert.deepStrictEqual(parseFileCommand('открой файл invoice.pdf в загрузках'), {
    action: 'open',
    query: 'invoice.pdf',
    location: 'downloads',
    targetType: 'file',
  });
  assert.deepStrictEqual(parseFileCommand('покажи config.json в документах'), {
    action: 'reveal',
    query: 'config.json',
    location: 'documents',
    targetType: 'any',
  });
  assert.deepStrictEqual(parseFileCommand('найди setup.exe на компьютере'), {
    action: 'find',
    query: 'setup.exe',
    location: 'computer',
    targetType: 'any',
  });
  assert.deepStrictEqual(parseFileCommand('джарвис открой файл vscode.bat на рабочем столе'), {
    action: 'open',
    query: 'vscode.bat',
    location: 'desktop',
    targetType: 'file',
  });
  assert.deepStrictEqual(parseFileCommand('джарвис открой папку "проверка" на рабочем столе'), {
    action: 'open',
    query: 'проверка',
    location: 'desktop',
    targetType: 'directory',
  });
  assert.deepStrictEqual(parseFileCommand('open directory Project on desktop'), {
    action: 'open',
    query: 'project',
    location: 'desktop',
    targetType: 'directory',
  });
}

async function testFileCommander() {
  const root = makeTempTree();
  const downloads = path.join(root, 'Downloads');
  const desktop = path.join(root, 'Desktop');

  const findResult = await fileCommander.execute({
    action: 'find',
    query: 'invoice.pdf',
    location: 'downloads',
    _testOptions: {
      locationPath: downloads,
      standardLocations: [{ id: 'downloads', path: downloads }],
      enableDiskScan: false,
      useEverything: false,
      shell: { openPath: async () => '', showItemInFolder: () => {} },
    },
  });
  assert.strictEqual(findResult.ok, true);
  assert.strictEqual(findResult.type, 'file');
  assert.strictEqual(findResult.data.results[0].name, 'invoice.pdf');

  const dangerous = await fileCommander.execute({
    action: 'open',
    query: 'setup.exe',
    location: 'downloads',
    _testOptions: {
      locationPath: downloads,
      standardLocations: [{ id: 'downloads', path: downloads }],
      enableDiskScan: false,
      useEverything: false,
      shell: { openPath: async () => '', showItemInFolder: () => {} },
    },
  });
  assert.strictEqual(dangerous.needsConfirmation, true);
  assert.strictEqual(dangerous.commandToConfirm.tool, 'fileCommander');

  const selectedDangerous = await fileCommander.execute({
    action: 'open',
    query: 'setup.exe',
    location: 'direct',
    selectedFile: {
      type: 'file',
      name: 'setup.exe',
      path: path.join(downloads, 'setup.exe'),
      directory: downloads,
      dangerous: true,
    },
    confirmed: true,
    _testOptions: {
      shell: { openPath: async () => '', showItemInFolder: () => {} },
    },
  });
  assert.strictEqual(selectedDangerous.ok, true);

  const opened = [];
  const folderResult = await fileCommander.execute({
    action: 'open',
    query: 'проверка',
    location: 'desktop',
    targetType: 'directory',
    _testOptions: {
      locationPath: desktop,
      standardLocations: [{ id: 'desktop', path: desktop }],
      enableDiskScan: false,
      useEverything: false,
      shell: {
        openPath: async (target) => {
          opened.push(target);
          return '';
        },
        showItemInFolder: () => {},
      },
    },
  });
  assert.strictEqual(folderResult.ok, true);
  assert.strictEqual(folderResult.data.type, 'directory');
  assert.strictEqual(opened[0], path.join(desktop, 'проверка'));

  const missingFolder = await fileCommander.execute({
    action: 'open',
    query: 'отсутствует',
    location: 'desktop',
    targetType: 'directory',
    _testOptions: {
      locationPath: desktop,
      standardLocations: [{ id: 'desktop', path: desktop }],
      useEverything: false,
      shell: { openPath: async () => '', showItemInFolder: () => {} },
    },
  });
  assert.strictEqual(missingFolder.title, 'Папка не найдена');
}

function testVoiceFileIntentParsing() {
  const openIntent = parseIntent('джарвис открой файл vscode.bat на рабочем столе');
  assert.strictEqual(openIntent.ok, true);
  assert.strictEqual(openIntent.action, 'open_file');
  assert.strictEqual(openIntent.query, 'vscode.bat');
  assert.strictEqual(openIntent.location, 'desktop');

  const revealIntent = parseIntent('покажи config.json в документах');
  assert.strictEqual(revealIntent.ok, true);
  assert.strictEqual(revealIntent.action, 'reveal_file');
  assert.strictEqual(revealIntent.query, 'config.json');
  assert.strictEqual(revealIntent.location, 'documents');

  const findIntent = parseIntent('найди setup.exe на компьютере');
  assert.strictEqual(findIntent.ok, true);
  assert.strictEqual(findIntent.action, 'find_file');
  assert.strictEqual(findIntent.location, 'computer');

  const folderIntent = parseIntent('джарвис открой папку "проверка" на рабочем столе');
  assert.strictEqual(folderIntent.ok, true);
  assert.strictEqual(folderIntent.action, 'open_file');
  assert.strictEqual(folderIntent.query, 'проверка');
  assert.strictEqual(folderIntent.location, 'desktop');
  assert.strictEqual(folderIntent.targetType, 'directory');
  assert.strictEqual(openIntent.targetType, 'file');
  assert.strictEqual(revealIntent.targetType, 'any');
}

async function run() {
  testLocations();
  testSafety();
  await testSearchAndIndex();
  testTextFileCommandParsing();
  await testFileCommander();
  testVoiceFileIntentParsing();
  console.log('[testFileCommands] helper tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
