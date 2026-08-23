# Jarvis File Commands Implementation Plan

**Status (2026-08-23):** Implemented and verified. Deterministic file-command,
voice parser, wildcard search, Vosk load/stream, and Electron smoke checks pass.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build safe natural-language file commands so Jarvis can open, reveal, and find files from text or voice.

**Architecture:** Add a separate file-command path instead of extending app launch resolution. Pure search/index/safety modules feed a high-level `fileCommander` tool, which is exposed through existing IPC and used by both renderer text commands and voice intent execution.

**Tech Stack:** Electron 42, Node.js CommonJS, Windows shell/Explorer, existing renderer HTML/CSS/JS, no new production dependencies.

---

## File Structure

- Create `tools/fileLocations.js`: normalize Russian/English location phrases and resolve them to safe Windows user folders.
- Create `tools/fileSafety.js`: dangerous extension detection and file metadata helpers.
- Create `tools/fileSearch.js`: live directory search, indexed search, scoring, candidate shaping.
- Create `tools/fileIndex.js`: create/read/write local generated `data/file-index.json` metadata index.
- Create `tools/fileCommander.js`: high-level `execute(args, confirmed)` tool for `open`, `reveal`, `find`, candidate selection, and confirmation.
- Modify `main.js`: allow `fileCommander`, inject file-command voice helpers, and expose a safe way to show Jarvis for voice selections.
- Modify `preload.js`: no new broad filesystem API; keep using `executeTool` and `confirmCommand`.
- Modify `tools/index.js`: parse text commands into `fileCommander`.
- Modify `renderer/renderer.js`: detect file commands, render `file` results/candidates in the current style, and launch selected file candidates safely.
- Modify `renderer/style.css`: add minimal `file` badge/warning styling consistent with current result rows.
- Modify `voice/intentParser.js`: parse file intents.
- Modify `actions/executeIntent.js`: execute file intents through injected `executeFileCommand`.
- Create `scripts/testFileCommands.js`: deterministic Node checks for parsing, search, safety, and commander result shapes.
- Modify `.gitignore`: ignore generated `data/file-index.json`.

## Task 1: File Locations And Safety

**Files:**
- Create: `tools/fileLocations.js`
- Create: `tools/fileSafety.js`
- Create: `scripts/testFileCommands.js`
- Modify: `.gitignore`

- [x] **Step 1: Write failing tests for location and safety helpers**

Create `scripts/testFileCommands.js` with this initial content:

```js
const assert = require('assert');
const path = require('path');

const { normalizeLocation, resolveLocationPath, isBroadLocation } = require('../tools/fileLocations');
const { isDangerousFile, normalizeExtension } = require('../tools/fileSafety');

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

function run() {
  testLocations();
  testSafety();
  console.log('[testFileCommands] helper tests passed');
}

run();
```

- [x] **Step 2: Run helper tests and verify they fail**

Run: `node scripts/testFileCommands.js`

Expected: FAIL with `Cannot find module '../tools/fileLocations'`.

- [x] **Step 3: Implement `tools/fileLocations.js`**

Create `tools/fileLocations.js`:

```js
const path = require('path');

const LOCATION_ALIASES = [
  { id: 'desktop', aliases: ['desktop', 'рабочий стол', 'рабочем столе', 'на рабочем столе'] },
  { id: 'downloads', aliases: ['downloads', 'download', 'загрузки', 'загрузках', 'в загрузках'] },
  { id: 'documents', aliases: ['documents', 'document', 'документы', 'документах', 'в документах'] },
  { id: 'pictures', aliases: ['pictures', 'images', 'изображения', 'картинки', 'фото'] },
  { id: 'videos', aliases: ['videos', 'video', 'видео'] },
  { id: 'music', aliases: ['music', 'музыка', 'музыке'] },
  { id: 'home', aliases: ['home', 'user', 'домашняя папка', 'папка пользователя'] },
  { id: 'computer', aliases: ['computer', 'pc', 'на пк', 'на компьютере', 'везде', 'не помню где'] },
];

const LOCATION_DIRS = {
  desktop: 'Desktop',
  downloads: 'Downloads',
  documents: 'Documents',
  pictures: 'Pictures',
  videos: 'Videos',
  music: 'Music',
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocation(input) {
  const text = normalizeText(input);
  if (!text) return '';

  for (const entry of LOCATION_ALIASES) {
    if (entry.aliases.some((alias) => text.includes(normalizeText(alias)))) {
      return entry.id;
    }
  }

  return '';
}

function isBroadLocation(location) {
  return location === 'computer';
}

function getUserProfile(env = process.env) {
  return env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : '');
}

function resolveLocationPath(location, env = process.env) {
  const userProfile = getUserProfile(env);
  if (!userProfile) return '';
  if (location === 'home') return userProfile;
  const dirName = LOCATION_DIRS[location];
  return dirName ? path.join(userProfile, dirName) : '';
}

function getStandardLocations(env = process.env) {
  return ['desktop', 'downloads', 'documents', 'pictures', 'videos', 'music', 'home']
    .map((id) => ({ id, path: resolveLocationPath(id, env) }))
    .filter((entry) => entry.path);
}

module.exports = {
  normalizeText,
  normalizeLocation,
  isBroadLocation,
  resolveLocationPath,
  getStandardLocations,
};
```

- [x] **Step 4: Implement `tools/fileSafety.js`**

Create `tools/fileSafety.js`:

```js
const path = require('path');

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.ps1',
  '.msi',
  '.reg',
  '.vbs',
  '.js',
  '.jar',
  '.scr',
  '.com',
]);

function normalizeExtension(fileName) {
  return path.extname(String(fileName || '')).toLowerCase();
}

function isDangerousFile(fileName) {
  return DANGEROUS_EXTENSIONS.has(normalizeExtension(fileName));
}

function toFileCandidate(filePath, stats, source, score = 0) {
  const name = path.basename(filePath);
  const extension = normalizeExtension(name);
  return {
    type: 'file',
    name,
    path: filePath,
    extension,
    directory: path.dirname(filePath),
    size: stats && typeof stats.size === 'number' ? stats.size : 0,
    modifiedAt: stats && stats.mtime ? stats.mtime.toISOString() : '',
    source: source || 'live',
    score,
    dangerous: isDangerousFile(name),
  };
}

module.exports = {
  DANGEROUS_EXTENSIONS,
  normalizeExtension,
  isDangerousFile,
  toFileCandidate,
};
```

- [x] **Step 5: Ignore generated file index**

Append this line to `.gitignore` if it is not already present:

```gitignore
data/file-index.json
```

- [x] **Step 6: Run helper tests and commit**

Run: `node scripts/testFileCommands.js`

Expected: PASS with `[testFileCommands] helper tests passed`.

Commit:

```bash
git add .gitignore tools/fileLocations.js tools/fileSafety.js scripts/testFileCommands.js
git commit -m "feat: add file command helpers"
```

## Task 2: Search And Index Modules

**Files:**
- Create: `tools/fileSearch.js`
- Create: `tools/fileIndex.js`
- Modify: `scripts/testFileCommands.js`

- [x] **Step 1: Extend tests for live search, scoring, and index search**

Add this block to `scripts/testFileCommands.js` above `run()`:

```js
const fs = require('fs');
const os = require('os');

const { searchDirectory, searchFiles } = require('../tools/fileSearch');
const { writeIndex, readIndex, searchIndex } = require('../tools/fileIndex');

function makeTempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-file-'));
  fs.mkdirSync(path.join(root, 'Documents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Downloads'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Documents', 'config.json'), '{}');
  fs.writeFileSync(path.join(root, 'Downloads', 'invoice.pdf'), 'pdf');
  fs.writeFileSync(path.join(root, 'Downloads', 'setup.exe'), 'exe');
  fs.writeFileSync(path.join(root, 'node_modules', 'setup.exe'), 'skip');
  return root;
}

function testSearchAndIndex() {
  const root = makeTempTree();
  const docs = path.join(root, 'Documents');
  const downloads = path.join(root, 'Downloads');
  const indexPath = path.join(root, 'file-index.json');

  const configResults = searchDirectory(docs, 'config.json', { maxResults: 10, maxDepth: 2 });
  assert.strictEqual(configResults.length, 1);
  assert.strictEqual(configResults[0].name, 'config.json');
  assert.strictEqual(configResults[0].dangerous, false);

  const broadResults = searchFiles({ query: 'setup.exe', location: 'computer' }, {
    standardLocations: [{ id: 'downloads', path: downloads }],
    indexPath,
  });
  assert.strictEqual(broadResults.results[0].name, 'setup.exe');
  assert.strictEqual(broadResults.results[0].dangerous, true);

  writeIndex(indexPath, [{ id: 'downloads', path: downloads }], { now: '2026-06-18T00:00:00.000Z' });
  const index = readIndex(indexPath);
  assert.strictEqual(index.files.some((file) => file.name === 'setup.exe'), true);
  const indexed = searchIndex(indexPath, 'setup.exe');
  assert.strictEqual(indexed[0].name, 'setup.exe');
}
```

Call it from `run()`:

```js
function run() {
  testLocations();
  testSafety();
  testSearchAndIndex();
  console.log('[testFileCommands] helper tests passed');
}
```

- [x] **Step 2: Run tests and verify they fail**

Run: `node scripts/testFileCommands.js`

Expected: FAIL with `Cannot find module '../tools/fileSearch'`.

- [x] **Step 3: Implement `tools/fileIndex.js`**

Create `tools/fileIndex.js`:

```js
const fs = require('fs');
const path = require('path');
const { toFileCandidate } = require('./fileSafety');

const DEFAULT_INDEX_PATH = path.join(__dirname, '..', 'data', 'file-index.json');
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'Windows',
  'AppData',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  'Temp',
  'tmp',
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isExcludedDir(name) {
  return EXCLUDED_DIR_NAMES.has(name);
}

function walkFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const maxFiles = options.maxFiles ?? 20000;
  const files = [];

  function walk(dir, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        files.push(toFileCandidate(fullPath, fs.statSync(fullPath), options.source || 'index', 0));
      } catch {
        continue;
      }
    }
  }

  walk(root, 0);
  return files;
}

function writeIndex(indexPath = DEFAULT_INDEX_PATH, roots = [], options = {}) {
  const files = [];
  for (const root of roots) {
    if (!root || !root.path || !fs.existsSync(root.path)) continue;
    files.push(...walkFiles(root.path, { source: root.id || 'index', maxDepth: options.maxDepth, maxFiles: options.maxFiles }));
  }

  const data = {
    version: 1,
    updatedAt: options.now || new Date().toISOString(),
    roots,
    files,
  };

  ensureDir(path.dirname(indexPath));
  fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function readIndex(indexPath = DEFAULT_INDEX_PATH) {
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
}

function scoreIndexedFile(file, query) {
  const q = String(query || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (!q || !name) return 0;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  return 0;
}

function searchIndex(indexPath = DEFAULT_INDEX_PATH, query, options = {}) {
  const index = readIndex(indexPath);
  if (!index || !Array.isArray(index.files)) return [];

  return index.files
    .map((file) => ({ ...file, score: scoreIndexedFile(file, query), source: file.source || 'index' }))
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults ?? 20);
}

module.exports = {
  DEFAULT_INDEX_PATH,
  EXCLUDED_DIR_NAMES,
  isExcludedDir,
  walkFiles,
  writeIndex,
  readIndex,
  searchIndex,
};
```

- [x] **Step 4: Implement `tools/fileSearch.js`**

Create `tools/fileSearch.js`:

```js
const fs = require('fs');
const path = require('path');
const { getStandardLocations, isBroadLocation, resolveLocationPath } = require('./fileLocations');
const { toFileCandidate, normalizeExtension } = require('./fileSafety');
const { DEFAULT_INDEX_PATH, searchIndex } = require('./fileIndex');

function normalizeQuery(query) {
  return String(query || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function scoreFileName(fileName, query) {
  const name = normalizeQuery(fileName);
  const q = normalizeQuery(query);
  if (!name || !q) return 0;
  if (name === q) return 100;
  if (normalizeExtension(name) && q.includes('.') && name.endsWith(q)) return 90;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  return 0;
}

function sortResults(results, query) {
  return results
    .map((file) => ({ ...file, score: file.score || scoreFileName(file.name, query) }))
    .filter((file) => file.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
      const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
      return bTime - aTime;
    });
}

function searchDirectory(dir, query, options = {}) {
  const maxDepth = options.maxDepth ?? 6;
  const maxResults = options.maxResults ?? 20;
  const source = options.source || 'live';
  const results = [];

  function walk(currentDir, depth) {
    if (depth > maxDepth || results.length >= maxResults) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const score = scoreFileName(entry.name, query);
      if (score <= 0) continue;

      try {
        results.push(toFileCandidate(fullPath, fs.statSync(fullPath), source, score));
      } catch {
        continue;
      }
    }
  }

  if (dir && fs.existsSync(dir)) walk(dir, 0);
  return sortResults(results, query).slice(0, maxResults);
}

function dedupeResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const result of results) {
    const key = String(result.path || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function searchFiles(args = {}, options = {}) {
  const query = String(args.query || '').trim();
  const location = args.location || 'computer';
  const maxResults = options.maxResults ?? 20;
  const standardLocations = options.standardLocations || getStandardLocations(options.env || process.env);
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;

  if (!query) {
    return { ok: false, reason: 'missing_query', results: [] };
  }

  let results = [];

  if (isBroadLocation(location)) {
    results.push(...searchIndex(indexPath, query, { maxResults }));
    if (results.length < maxResults) {
      for (const entry of standardLocations) {
        results.push(...searchDirectory(entry.path, query, { source: entry.id, maxResults }));
      }
    }
  } else {
    const explicitPath = options.locationPath || resolveLocationPath(location, options.env || process.env);
    if (!explicitPath) return { ok: false, reason: 'unknown_location', results: [] };
    if (!fs.existsSync(explicitPath)) return { ok: false, reason: 'missing_location', results: [] };
    results.push(...searchDirectory(explicitPath, query, { source: location, maxResults }));
  }

  results = dedupeResults(sortResults(results, query)).slice(0, maxResults);
  return { ok: true, query, location, results };
}

module.exports = {
  normalizeQuery,
  scoreFileName,
  sortResults,
  searchDirectory,
  searchFiles,
};
```

- [x] **Step 5: Run search/index tests and commit**

Run: `node scripts/testFileCommands.js`

Expected: PASS with `[testFileCommands] helper tests passed`.

Commit:

```bash
git add tools/fileSearch.js tools/fileIndex.js scripts/testFileCommands.js
git commit -m "feat: add file search and index"
```

## Task 3: File Commander Tool

**Files:**
- Create: `tools/fileCommander.js`
- Modify: `scripts/testFileCommands.js`
- Modify: `main.js`

- [x] **Step 1: Extend tests for commander result shapes**

Add this block to `scripts/testFileCommands.js`:

```js
const fileCommander = require('../tools/fileCommander');

async function testFileCommander() {
  const root = makeTempTree();
  const downloads = path.join(root, 'Downloads');

  const findResult = await fileCommander.execute({
    action: 'find',
    query: 'invoice.pdf',
    location: 'downloads',
    _testOptions: {
      locationPath: downloads,
      standardLocations: [{ id: 'downloads', path: downloads }],
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
      shell: { openPath: async () => '', showItemInFolder: () => {} },
    },
  });
  assert.strictEqual(dangerous.needsConfirmation, true);
  assert.strictEqual(dangerous.commandToConfirm.tool, 'fileCommander');
}
```

Update `run()`:

```js
async function run() {
  testLocations();
  testSafety();
  testSearchAndIndex();
  await testFileCommander();
  console.log('[testFileCommands] helper tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [x] **Step 2: Run commander tests and verify they fail**

Run: `node scripts/testFileCommands.js`

Expected: FAIL with `Cannot find module '../tools/fileCommander'`.

- [x] **Step 3: Implement `tools/fileCommander.js`**

Create `tools/fileCommander.js`:

```js
const path = require('path');
const { shell: electronShell } = require('electron');
const { searchFiles } = require('./fileSearch');
const { isDangerousFile } = require('./fileSafety');

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function mapAction(action) {
  if (action === 'reveal' || action === 'show') return 'reveal';
  if (action === 'find' || action === 'search') return 'find';
  return 'open';
}

function resultContent(file) {
  const date = file.modifiedAt ? new Date(file.modifiedAt).toLocaleString('ru-RU') : '';
  return `${file.path}${file.size ? ` (${formatSize(file.size)})` : ''}${date ? ` · ${date}` : ''}`;
}

function makeCandidate(file, action) {
  return {
    ...file,
    action,
    title: file.name,
    content: resultContent(file),
    warning: action === 'open' && file.dangerous,
  };
}

function notFoundResult(query, location) {
  return {
    ok: false,
    type: 'file',
    title: 'Файл не найден',
    content: `Не нашёл "${query}" в выбранном месте. Можно поискать в стандартных папках или на компьютере.`,
    notFound: true,
    data: { query, location, results: [] },
  };
}

function selectionResult(query, location, action, results) {
  return {
    ok: false,
    type: 'file',
    title: 'Выберите файл',
    content: `Нашёл несколько вариантов для "${query}".`,
    needsSelection: true,
    candidates: results.map((file) => makeCandidate(file, action)),
    data: { query, location, action, results },
  };
}

function confirmationResult(file, action) {
  return {
    ok: false,
    type: 'file',
    title: 'Нужно подтверждение',
    content: 'Это исполняемый файл/скрипт. Его открытие может запустить команды. Запустить?',
    needsConfirmation: true,
    commandToConfirm: {
      tool: 'fileCommander',
      args: {
        action,
        query: file.name,
        location: 'direct',
        selectedFile: file,
      },
      description: file.path,
    },
  };
}

async function openFile(shell, file) {
  const error = await shell.openPath(file.path);
  if (error) {
    return { ok: false, type: 'file', title: 'Не удалось открыть файл', content: error, error };
  }
  return { ok: true, type: 'file', title: `Открываю: ${file.name}`, content: file.path, data: file };
}

function revealFile(shell, file) {
  shell.showItemInFolder(file.path);
  return { ok: true, type: 'file', title: `Показываю: ${file.name}`, content: file.path, data: file };
}

async function execute(args = {}, confirmed = false) {
  const action = mapAction(args.action);
  const query = String(args.query || '').trim();
  const options = args._testOptions || {};
  const shell = options.shell || electronShell;

  if (!query && !args.selectedFile) {
    return {
      ok: false,
      type: 'file',
      title: 'Не указан файл',
      content: 'Скажите или введите имя файла.',
      error: 'query is required',
    };
  }

  let selectedFile = args.selectedFile || null;
  let searchResult = null;

  if (!selectedFile) {
    searchResult = searchFiles({ query, location: args.location || 'computer' }, options);
    if (!searchResult.ok) {
      return {
        ok: false,
        type: 'file',
        title: searchResult.reason === 'missing_location' ? 'Папка не найдена' : 'Не удалось найти файл',
        content: 'Проверьте название папки или попробуйте поиск на компьютере.',
        error: searchResult.reason,
      };
    }

    if (searchResult.results.length === 0) return notFoundResult(query, args.location || 'computer');
    if (searchResult.results.length > 1) return selectionResult(query, args.location || 'computer', action, searchResult.results);
    selectedFile = searchResult.results[0];
  }

  if (action === 'find') {
    const results = searchResult ? searchResult.results : [selectedFile];
    return {
      ok: true,
      type: 'file',
      title: `Найдено файлов: ${results.length}`,
      content: results.map((file, index) => `${index + 1}. ${file.name}\n   ${file.path}`).join('\n'),
      data: { query: query || selectedFile.name, results },
    };
  }

  if (action === 'reveal') return revealFile(shell, selectedFile);

  if (isDangerousFile(selectedFile.name) && !confirmed && !args.confirmed) {
    return confirmationResult(selectedFile, action);
  }

  return await openFile(shell, selectedFile);
}

function getSchema() {
  return 'fileCommander: открыть/показать/найти файл. Args: { action: "open"|"reveal"|"find", query: string, location?: string, selectedFile?: object }.';
}

module.exports = {
  execute,
  getSchema,
  formatSize,
  mapAction,
};
```

- [x] **Step 4: Allow the tool in `main.js`**

Change:

```js
const ALLOWED_TOOLS = ['runProgram', 'powershell', 'searchFiles', 'sysinfo'];
```

to:

```js
const ALLOWED_TOOLS = ['runProgram', 'powershell', 'searchFiles', 'sysinfo', 'fileCommander'];
```

- [x] **Step 5: Run commander tests and commit**

Run: `node scripts/testFileCommands.js`

Expected: PASS with `[testFileCommands] helper tests passed`.

Commit:

```bash
git add tools/fileCommander.js scripts/testFileCommands.js main.js
git commit -m "feat: add file commander tool"
```

## Task 4: Text Command Parsing And Renderer Integration

**Files:**
- Modify: `tools/index.js`
- Modify: `renderer/renderer.js`
- Modify: `renderer/style.css`
- Modify: `scripts/testFileCommands.js`

- [x] **Step 1: Add parser tests for text file commands**

Add this block to `scripts/testFileCommands.js`:

```js
const { parseFileCommand } = require('../tools/fileCommandParser');

function testTextFileCommandParsing() {
  assert.deepStrictEqual(parseFileCommand('открой файл invoice.pdf в загрузках'), {
    action: 'open',
    query: 'invoice.pdf',
    location: 'downloads',
  });
  assert.deepStrictEqual(parseFileCommand('покажи config.json в документах'), {
    action: 'reveal',
    query: 'config.json',
    location: 'documents',
  });
  assert.deepStrictEqual(parseFileCommand('найди setup.exe на компьютере'), {
    action: 'find',
    query: 'setup.exe',
    location: 'computer',
  });
}
```

- [x] **Step 2: Implement a shared parser instead of renderer-only parsing**

Create `tools/fileCommandParser.js`:

```js
const { normalizeLocation } = require('./fileLocations');

function cleanText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"]/g, '')
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectAction(text) {
  if (/^(покажи|показать|show|reveal)\b/.test(text)) return 'reveal';
  if (/^(найди|найти|поиск|find|search)\b/.test(text)) return 'find';
  if (/^(открой|открыть|open)\b/.test(text)) return 'open';
  return '';
}

function stripAction(text) {
  return text
    .replace(/^(джарвис|jarvis)\s+/i, '')
    .replace(/^(открой|открыть|покажи|показать|найди|найти|поиск|open|show|reveal|find|search)\s+/i, '')
    .replace(/^файл\s+/i, '')
    .trim();
}

function parseFileCommand(rawText) {
  const text = cleanText(rawText);
  const action = detectAction(text);
  if (!action) return null;

  const location = normalizeLocation(text) || 'computer';
  let query = stripAction(text);

  const locationPhrases = [
    'на рабочем столе',
    'в загрузках',
    'в документах',
    'в изображениях',
    'в видео',
    'в музыке',
    'в домашней папке',
    'на компьютере',
    'на пк',
    'везде',
    'не помню где',
  ];

  for (const phrase of locationPhrases) {
    query = query.replace(phrase, ' ');
  }

  query = query.replace(/\b(в|на)\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (!query) return null;

  return { action, query, location };
}

function isFileCommand(rawText) {
  return !!parseFileCommand(rawText);
}

module.exports = {
  cleanText,
  parseFileCommand,
  isFileCommand,
};
```

Update the test import to:

```js
const { parseFileCommand } = require('../tools/fileCommandParser');
```

Call `testTextFileCommandParsing()` from `run()`.

- [x] **Step 3: Route text commands in `tools/index.js`**

At the top:

```js
const { parseFileCommand } = require('./fileCommandParser');
```

Before file search detection:

```js
const fileCommand = parseFileCommand(trimmed);
if (fileCommand) {
  return { tool: 'fileCommander', args: fileCommand };
}
```

Include file commander in `getToolSchemas()`:

```js
const fileCommander = require('./fileCommander');
```

and append `fileCommander.getSchema()`.

- [x] **Step 4: Route text commands in `renderer/renderer.js`**

Because the renderer cannot use CommonJS `require`, add a local `parseFileCommandForRenderer(rawText)` near `parseTool()` with the same behavior as `tools/fileCommandParser.js`. Keep it small and limited to the same action/location/query extraction used by the shared parser.

Change `parseTool(input)` before generic find detection:

```js
if (parseFileCommandForRenderer(trimmed)) return 'fileCommander';
```

Change `parseArgs(input, toolName)`:

```js
case 'fileCommander':
  return parseFileCommandForRenderer(trimmed) || { action: 'find', query: trimmed, location: 'computer' };
```

Extend labels/icons:

```js
file: 'Файл',
fileCommander: 'Файл',
```

and:

```js
file: '▣',
fileCommander: '▣',
```

Update `candidateLabel(candidate)` to handle file candidates:

```js
if (candidate.type === 'file') {
  const warning = candidate.warning ? '⚠ ' : '';
  const size = candidate.size ? ` · ${candidate.size} B` : '';
  return `${warning}${candidate.name} — ${candidate.directory || candidate.path}${size}`;
}
```

Update `launchSelectedCandidate()` so file candidates execute `fileCommander`:

```js
if (candidate.type === 'file') {
  const result = await window.jarvis.executeTool('fileCommander', {
    action: candidate.action || 'open',
    query: candidate.name,
    location: 'direct',
    selectedFile: candidate,
    confirmed: !!candidate.warning,
  });
  inputEl.value = '';
  await saveAndDisplay(result, candidate.path || candidate.name);
  return;
}
```

- [x] **Step 5: Keep styling aligned**

Add minimal CSS to `renderer/style.css`:

```css
.type-file,
.type-fileCommander {
  border-color: rgba(120, 180, 255, 0.34);
}

.candidate-button.warning {
  color: #ffd28a;
}
```

Add the warning class in `renderResults()`:

```js
if (candidate.warning) btn.classList.add('warning');
```

- [x] **Step 6: Run tests and commit**

Run: `node scripts/testFileCommands.js`

Expected: PASS with `[testFileCommands] helper tests passed`.

Commit:

```bash
git add tools/index.js tools/fileCommandParser.js renderer/renderer.js renderer/style.css scripts/testFileCommands.js
git commit -m "feat: route text file commands"
```

## Task 5: Voice Intent And Execution

**Files:**
- Modify: `voice/intentParser.js`
- Modify: `actions/executeIntent.js`
- Modify: `main.js`
- Modify: `scripts/testFileCommands.js`

- [x] **Step 1: Add voice parser tests**

Add this block to `scripts/testFileCommands.js`:

```js
const { parseIntent } = require('../voice/intentParser');

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
}
```

Call `testVoiceFileIntentParsing()` from `run()`.

- [x] **Step 2: Run tests and verify they fail**

Run: `node scripts/testFileCommands.js`

Expected: FAIL because `parseIntent()` does not return file actions yet.

- [x] **Step 3: Parse file intents in `voice/intentParser.js`**

Add near the imports:

```js
const { parseFileCommand } = require('../tools/fileCommandParser');
```

At the start of `parseIntent(rawText)`, after `const text = normalizeText(rawText);`:

```js
const fileCommand = parseFileCommand(rawText);
if (fileCommand) {
  const actionMap = {
    open: 'open_file',
    reveal: 'reveal_file',
    find: 'find_file',
  };
  return {
    ok: true,
    action: actionMap[fileCommand.action],
    query: fileCommand.query,
    location: fileCommand.location,
    confidence: 0.9,
    source: 'regex',
    rawText,
  };
}
```

- [x] **Step 4: Execute file intents in `actions/executeIntent.js`**

Before the allowed app-action check, add:

```js
if (['open_file', 'reveal_file', 'find_file'].includes(intent.action)) {
  if (typeof options.executeFileCommand !== 'function') {
    return {
      ok: false,
      message: 'Файловые команды недоступны.',
    };
  }

  const actionMap = {
    open_file: 'open',
    reveal_file: 'reveal',
    find_file: 'find',
  };

  const result = await options.executeFileCommand({
    action: actionMap[intent.action],
    query: intent.query,
    location: intent.location,
    source: 'voice',
  });

  if (result && result.needsSelection && typeof options.showMainWindow === 'function') {
    await options.showMainWindow();
  }

  return result;
}
```

- [x] **Step 5: Inject file command execution in `main.js`**

Add helper:

```js
async function handleFileCommand(args, confirmed = false) {
  const fileCommander = require('./tools/fileCommander');
  return await fileCommander.execute(args, confirmed);
}
```

In `new VoiceService({ intentOptions: { ... } })`, add:

```js
executeFileCommand: handleFileCommand,
showMainWindow,
```

- [x] **Step 6: Run voice command checks and commit**

Run:

```bash
node scripts/testFileCommands.js
node voice/testCommand.js "джарвис открой файл vscode.bat на рабочем столе"
```

Expected:

- first command PASS
- second command prints an intent with `action: 'open_file'`; execution may report not found if the file does not exist.

Commit:

```bash
git add voice/intentParser.js actions/executeIntent.js main.js scripts/testFileCommands.js
git commit -m "feat: parse voice file commands"
```

## Task 6: Confirmation And Candidate UX

**Files:**
- Modify: `renderer/renderer.js`
- Modify: `renderer/style.css`
- Modify: `tools/fileCommander.js`
- Modify: `scripts/testFileCommands.js`

- [x] **Step 1: Add tests for dangerous candidate behavior**

Add to `testFileCommander()`:

```js
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
```

- [x] **Step 2: Ensure selected dangerous candidates can launch from UI**

In `renderer/renderer.js`, ensure file candidate execution passes `confirmed: !!candidate.warning` exactly as in Task 4. Add warning class:

```js
if (candidate.warning) btn.classList.add('warning');
```

Do not set `confirmed` for non-warning candidates.

- [x] **Step 3: Keep single dangerous file confirmation intact**

In `tools/fileCommander.js`, keep this guard before `openFile()`:

```js
if (isDangerousFile(selectedFile.name) && !confirmed && !args.confirmed) {
  return confirmationResult(selectedFile, action);
}
```

This preserves the spec: one dangerous file asks; a warning-marked UI candidate can be explicit confirmation.

- [x] **Step 4: Improve confirmation display text for file commands**

In `renderer/renderer.js`, the existing confirmation branch should work for any tool. Verify it uses:

```js
state.confirmingCommand = result.commandToConfirm;
confirmText.textContent = result.content;
confirmDialog.classList.remove('hidden');
confirmYes.focus();
```

No separate file confirmation dialog is needed.

- [x] **Step 5: Run tests and commit**

Run: `node scripts/testFileCommands.js`

Expected: PASS with `[testFileCommands] helper tests passed`.

Commit:

```bash
git add renderer/renderer.js renderer/style.css tools/fileCommander.js scripts/testFileCommands.js
git commit -m "feat: add safe file candidate confirmation"
```

## Task 7: Verification And Manual Smoke Test

**Files:**
- Modify only if verification exposes issues.

- [x] **Step 1: Run deterministic Node checks**

Run:

```bash
node scripts/testFileCommands.js
node voice/testCommand.js "покажи config.json в документах"
node voice/testCommand.js "найди setup.exe на компьютере"
```

Expected:

- `scripts/testFileCommands.js` passes.
- voice commands print parsed file intents.
- execution may report not found depending on local files.

- [x] **Step 2: Run Vosk load test**

Run: `node scripts/testVoskLoad.js`

Expected: Vosk model loads or prints the existing project-specific missing-model guidance. If the model is absent, record that as an environmental limitation instead of changing voice code.

- [x] **Step 3: Start Jarvis for visual verification**

Run: `npm start`

Expected:

- Jarvis window opens.
- Typing `найди invoice.pdf в загрузках` routes to file command.
- Typing `покажи config.json в документах` shows either not found or opens Explorer if a file exists.
- Multiple results render in the current result list style.
- Dangerous candidates show a warning marker.

- [x] **Step 4: Stop Jarvis cleanly**

Use the tray menu or close the Electron process from the app. Do not leave background Electron processes running.

Verification on 2026-08-23 used deterministic temporary directories for file
search and mutation checks. The real Electron renderer was inspected, then
stopped cleanly; no user files were opened, moved, overwritten, or deleted.

- [x] **Step 5: Final git status**

Run: `git status --short`

Expected: clean working tree after the last implementation commit, or only intentional uncommitted verification notes if the user asked not to commit.
