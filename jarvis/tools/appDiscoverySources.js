const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const appIndexer = require('./appIndexer');
const { normalizeAlias } = require('./appIdentity');
const { discoverSteamApps, discoverEpicApps } = require('./gameAppDiscovery');

const SUPPORTED_EXTENSIONS = new Set(['.exe', '.lnk', '.bat', '.cmd', '.ps1']);
const QUICK_EXCLUDED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'build', 'dist', 'out']);

function isCancelled(signal) {
  return !!signal && signal.aborted === true;
}

function candidateFromPath(filePath, source) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    name: path.basename(filePath, ext),
    aliases: [path.basename(filePath, ext)],
    type: ext === '.lnk' ? 'lnk' : ['.bat', '.cmd', '.ps1'].includes(ext) ? 'script' : 'exe',
    path: filePath,
    source,
  };
}

function exactCommandCandidate(query, options = {}) {
  if (!/^[a-zA-Z0-9._-]+$/.test(query)) return [];
  const exec = options.execFileSync || execFileSync;
  try {
    const wherePath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
    const output = exec(wherePath, [query], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const first = String(output).split(/\r?\n/).map(value => value.trim()).find(Boolean);
    return first ? [candidateFromPath(first, 'where')] : [];
  } catch {
    return [];
  }
}

function indexCandidates(options = {}) {
  const index = options.index || appIndexer.getIndex();
  return Array.isArray(index.apps) ? index.apps.map(app => ({ ...app })) : [];
}

function queryGuidedRoots(query, options = {}) {
  const fsImpl = options.fs || fs;
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const signal = options.signal;
  const deadline = options.deadline || (Date.now() + 5000);
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 3000;
  const tokens = normalizeAlias(query).split(' ').filter(token => token.length >= 2);
  const expandEnv = value => String(value || '').replace(/%([^%]+)%/g, (_match, name) => process.env[name] || '');
  const queue = roots.map(expandEnv).filter(Boolean).map(root => ({ dir: root, depth: 0 }));
  const results = [];
  let visited = 0;

  while (queue.length > 0 && visited < maxEntries && Date.now() < deadline && !isCancelled(signal)) {
    const current = queue.shift();
    let entries = [];
    try { entries = fsImpl.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => {
      const aScore = tokens.some(token => normalizeAlias(a.name).includes(token)) ? 1 : 0;
      const bScore = tokens.some(token => normalizeAlias(b.name).includes(token)) ? 1 : 0;
      return bScore - aScore;
    });
    for (const entry of entries) {
      visited += 1;
      if (visited >= maxEntries || Date.now() >= deadline || isCancelled(signal)) break;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(candidateFromPath(fullPath, 'quick-roots'));
      } else if (entry.isDirectory() && current.depth < (options.maxDepth ?? 3) && !QUICK_EXCLUDED_DIRS.has(entry.name.toLowerCase())) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }
  return results;
}

async function discoverQuick(query, options = {}) {
  const settings = options.settings || {};
  const roots = options.roots || settings.scanRoots || [];
  const sourceCalls = [
    () => indexCandidates(options),
    () => exactCommandCandidate(query, options),
    () => discoverSteamApps(options),
    () => discoverEpicApps(options),
    () => queryGuidedRoots(query, { ...options, roots }),
  ];
  const candidates = [];
  const errors = [];
  for (const call of sourceCalls) {
    if (isCancelled(options.signal)) break;
    try { candidates.push(...await Promise.resolve(call())); } catch (error) { errors.push(error.message); }
  }
  return { candidates, errors };
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  QUICK_EXCLUDED_DIRS,
  candidateFromPath,
  exactCommandCandidate,
  indexCandidates,
  queryGuidedRoots,
  discoverQuick,
};
