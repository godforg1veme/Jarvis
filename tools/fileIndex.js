const fs = require('fs');
const path = require('path');
const { toFileCandidate } = require('./fileSafety');
const { getWritableDataPath } = require('../runtimeDataPath');

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
    files.push(...walkFiles(root.path, {
      source: root.id || 'index',
      maxDepth: options.maxDepth,
      maxFiles: options.maxFiles,
    }));
  }

  const data = {
    version: 1,
    updatedAt: options.now || new Date().toISOString(),
    roots,
    files,
  };

  const target = getWritableDataPath(indexPath);
  try {
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[fileIndex] Failed to write ${target}:`, err);
  }
  return data;
}

function readIndex(indexPath = DEFAULT_INDEX_PATH) {
  try {
    const target = getWritableDataPath(indexPath);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf8'));
    if (fs.existsSync(indexPath)) return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return null;
  } catch {
    return null;
  }
}

function scoreIndexedFile(file, query) {
  const q = String(query || '').toLowerCase();
  const name = String(file && file.name || '').toLowerCase();
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
