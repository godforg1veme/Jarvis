const fs = require('fs');
const path = require('path');
const { getStandardLocations, isBroadLocation, resolveLocationPath } = require('./fileLocations');
const { toFileCandidate, normalizeExtension } = require('./fileSafety');
const { DEFAULT_INDEX_PATH, searchIndex, isExcludedDir } = require('./fileIndex');
const { searchEverything } = require('./everythingSearch');

function normalizeQuery(query) {
  return String(query || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function scoreFileName(fileName, query) {
  const name = normalizeQuery(fileName);
  const q = normalizeQuery(query);
  if (!name || !q) return 0;
  if (q.startsWith('*.') && name.endsWith(q.slice(1))) return 90;
  if (name === q) return 100;
  if (normalizeExtension(name) && q.includes('.') && name.endsWith(q)) return 90;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  return 0;
}

function sortResults(results, query) {
  const sourceRank = (source) => {
    if (['desktop', 'downloads', 'documents', 'pictures', 'videos', 'music'].includes(source)) return 2;
    if (source === 'home') return 1;
    return 0;
  };
  const pathDepth = (value) => String(value || '').split(/[\\/]+/).filter(Boolean).length;

  return results
    .map((file) => ({ ...file, score: file.score || scoreFileName(file.name, query) }))
    .filter((file) => file.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const aStandard = sourceRank(a.source);
      const bStandard = sourceRank(b.source);
      if (bStandard !== aStandard) return bStandard - aStandard;

      const depthDifference = pathDepth(a.path) - pathDepth(b.path);
      if (depthDifference !== 0) return depthDifference;

      const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
      const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
      return bTime - aTime;
    });
}

function getLocalDriveRoots(env = process.env) {
  if (process.platform !== 'win32') return ['/'];

  const roots = [];
  const candidates = [];
  if (env.SystemDrive) candidates.push(`${env.SystemDrive.replace(/\\+$/, '')}\\`);
  if (env.HOMEDRIVE) candidates.push(`${env.HOMEDRIVE.replace(/\\+$/, '')}\\`);

  for (let code = 67; code <= 90; code++) {
    candidates.push(`${String.fromCharCode(code)}:\\`);
  }

  for (const candidate of candidates) {
    const normalized = candidate.toUpperCase();
    if (roots.includes(normalized)) continue;
    try {
      if (fs.existsSync(normalized)) roots.push(normalized);
    } catch {
      continue;
    }
  }

  return roots;
}

function searchDirectory(dir, query, options = {}) {
  const maxDepth = options.maxDepth ?? 6;
  const maxResults = options.maxResults ?? 20;
  const source = options.source || 'live';
  const deadline = options.deadlineMs ? Date.now() + options.deadlineMs : 0;
  const results = [];

  function walk(currentDir, depth) {
    if (depth > maxDepth || results.length >= maxResults) return;
    if (deadline && Date.now() > deadline) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (deadline && Date.now() > deadline) break;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const score = scoreFileName(entry.name, query);
        if (score > 0 && options.targetType !== 'file') {
          try {
            results.push(toFileCandidate(fullPath, fs.statSync(fullPath), source, score));
          } catch {
            // Keep walking even if this directory cannot be stat'ed.
          }
        }
        if (!entry.name.startsWith('.') && !isExcludedDir(entry.name)) {
          walk(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile() || options.targetType === 'directory') continue;

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

function tagStandardSources(results, standardLocations) {
  return results.map((result) => {
    const resultPath = path.resolve(result.path).toLowerCase();
    const match = standardLocations.find((entry) => {
      const root = path.resolve(entry.path).toLowerCase();
      return resultPath === root || resultPath.startsWith(`${root}${path.sep}`);
    });
    return match ? { ...result, source: match.id, provider: 'everything' } : result;
  });
}

function filterTargetType(results, targetType) {
  if (targetType === 'file') return results.filter((result) => result.type === 'file');
  if (targetType === 'directory') return results.filter((result) => result.type === 'directory');
  return results;
}

async function searchFiles(args = {}, options = {}) {
  const query = String(args.query || '').trim();
  const location = args.location || 'computer';
  const targetType = args.targetType || 'any';
  const maxResults = options.maxResults ?? 20;
  const standardLocations = options.standardLocations || getStandardLocations(options.env || process.env);
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;

  if (!query) {
    return { ok: false, reason: 'missing_query', results: [] };
  }

  const explicitPath = isBroadLocation(location)
    ? ''
    : options.locationPath || resolveLocationPath(location, options.env || process.env);
  if (!isBroadLocation(location) && !explicitPath) {
    return { ok: false, reason: 'unknown_location', results: [] };
  }

  const everythingProvider = options.everythingProvider || searchEverything;
  let providerFailure = null;
  if (options.useEverything !== false) {
    const providerOptions = options.everythingOptions || options;
    const exactResult = await everythingProvider({
      query,
      targetType,
      exact: true,
      locationPath: explicitPath,
      maxResults: 1000,
    }, providerOptions);

    if (exactResult.ok && exactResult.results.length > 0) {
      const tagged = tagStandardSources(exactResult.results, standardLocations);
      let candidates = filterTargetType(tagged, targetType);
      if (explicitPath) {
        const directMatches = candidates.filter((candidate) => (
          path.resolve(path.dirname(candidate.path)).toLowerCase() === path.resolve(explicitPath).toLowerCase()
        ));
        if (directMatches.length > 0) candidates = directMatches;
      }
      const results = dedupeResults(sortResults(candidates, query)).slice(0, maxResults);
      return { ok: true, query, location, targetType, provider: 'everything', exact: true, results };
    }

    if (exactResult.ok) {
      const partialResult = await everythingProvider({
        query,
        targetType,
        exact: false,
        locationPath: explicitPath,
        maxResults: 1000,
      }, providerOptions);
      if (partialResult.ok) {
        const tagged = tagStandardSources(partialResult.results, standardLocations);
        const results = dedupeResults(sortResults(filterTargetType(tagged, targetType), query)).slice(0, maxResults);
        return { ok: true, query, location, targetType, provider: 'everything', exact: false, results };
      }
      providerFailure = partialResult.reason || 'everything_query_failed';
    } else {
      providerFailure = exactResult.reason || 'everything_query_failed';
    }
  }

  let results = [];

  if (isBroadLocation(location)) {
    results.push(...searchIndex(indexPath, query, { maxResults }));
    if (results.length < maxResults) {
      for (const entry of standardLocations) {
        results.push(...searchDirectory(entry.path, query, { source: entry.id, maxResults, targetType }));
      }
    }
    if (results.length < maxResults && options.enableDiskScan) {
      const remaining = maxResults - results.length;
      const roots = options.diskRoots || getLocalDriveRoots(options.env || process.env);
      for (const root of roots) {
        if (results.length >= maxResults) break;
        results.push(...searchDirectory(root, query, {
          source: 'disk',
          maxDepth: options.diskMaxDepth ?? 5,
          maxResults: remaining,
          deadlineMs: options.diskDeadlineMs ?? 3000,
          targetType,
        }));
      }
    }
  } else {
    if (!fs.existsSync(explicitPath)) return { ok: false, reason: 'missing_location', results: [] };
    results.push(...searchDirectory(explicitPath, query, { source: location, maxResults, targetType }));
  }

  results = filterTargetType(results, targetType);
  results = dedupeResults(sortResults(results, query)).slice(0, maxResults);
  const exactResults = results.filter((result) => result.score === 100);
  if (exactResults.length > 0) results = exactResults;
  return {
    ok: true,
    query,
    location,
    targetType,
    provider: 'fallback',
    degraded: options.useEverything !== false,
    providerFailure,
    results,
  };
}

module.exports = {
  normalizeQuery,
  scoreFileName,
  sortResults,
  searchDirectory,
  getLocalDriveRoots,
  filterTargetType,
  tagStandardSources,
  searchFiles,
};
