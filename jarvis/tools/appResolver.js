const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const USER_APPS_PATH = path.join(__dirname, '..', 'data', 'apps.user.json');
const DEFAULT_APPS_PATH = path.join(__dirname, '..', 'data', 'apps.default.json');
const INDEX_PATH = path.join(__dirname, '..', 'data', 'app-index.json');

// Source priority order requested for appResolver:
// apps.user > apps.default > start-menu > app-paths > uwp > registry > scan-roots > where
const SOURCE_PRIORITY = {
  'apps.user': 0,
  'apps.default': 1,
  'start-menu': 2,
  'app-paths': 3,
  uwp: 4,
  registry: 5,
  'scan-roots': 6,
  where: 7,
};

const GUI_SOURCES = new Set(['apps.user', 'apps.default', 'start-menu', 'app-paths', 'uwp', 'registry']);
const EXACT_OR_STARTS_WITH_MATCHES = new Set([
  'exactAlias',
  'exactName',
  'exactNormalizedAlias',
  'exactNormalizedName',
  'startsWithAlias',
  'startsWithName',
]);

// --- Helpers ---
function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSafeForWhere(name) {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

function sourcePriorityFor(source) {
  return SOURCE_PRIORITY[source] ?? 99;
}

function normalizeSource(source, fallback) {
  return source || fallback || 'unknown';
}

function candidateEndpointLabel(candidate) {
  if (candidate.path) return 'path';
  if (candidate.command) return 'command';
  if (candidate.aumid) return 'aumid';
  return 'path/command/aumid';
}

function candidateEndpoint(candidate) {
  return candidate.path || candidate.command || candidate.aumid || '-';
}

function formatCandidateInfo(candidate) {
  const aliases = Array.isArray(candidate.aliases) ? candidate.aliases.join(', ') : '';
  const endpoint = candidateEndpoint(candidate);
  return [
    `name: ${candidate.name || '-'}`,
    `aliases: ${aliases || '-'}`,
    `type: ${candidate.type || '-'}`,
    `${candidateEndpointLabel(candidate)}: ${endpoint}`,
    `source: ${candidate.source || '-'}`,
    `score: ${Number(candidate.score || 0).toFixed(3)}`,
    `reason: ${candidate.reason || '-'}`,
  ].join('\n');
}

function formatAppInfo(rawQuery, normalizedQuery, result) {
  const lines = [
    `original query: ${rawQuery}`,
    `normalized query: ${normalizedQuery}`,
  ];

  if (result.notFound) {
    lines.push('selected app: none');
    lines.push('candidates: none');
    return lines.join('\n');
  }

  if (result.app) {
    lines.push('selected app:');
    lines.push(formatCandidateInfo(result.app));
    lines.push('candidates: none');
  } else if (Array.isArray(result.candidates) && result.candidates.length > 0) {
    lines.push('candidates:');
    result.candidates.forEach((candidate, index) => {
      lines.push(`[${index + 1}]`);
      lines.push(formatCandidateInfo(candidate));
    });
  } else {
    lines.push('selected app: none');
    lines.push('candidates: none');
  }

  if (result.autoLaunchBlockedReason) {
    lines.push(`autoLaunch blocked: ${result.autoLaunchBlockedReason}`);
  }

  return lines.join('\n');
}

// --- Query normalization ---
const TRIGGER_WORDS = [
  /^\/run\s+/i,
  /\bоткрой\b/i,
  /\bоткрыть\b/i,
  /\bзапусти\b/i,
  /\bзапуск\b/i,
  /\brun\b/i,
  /\bopen\b/i,
];

function normalizeQuery(raw) {
  let q = raw.trim();
  for (const pattern of TRIGGER_WORDS) {
    q = q.replace(pattern, '');
  }
  return q.trim().replace(/\s+/g, ' ');
}

// --- Scoring ---
// Short queries (<5 chars) are intentionally conservative:
// exact name/alias and startsWith are allowed, but contains/partial matching is disabled.
// This prevents "cal" from matching "Tailscale" or "scalar".
function scoreApp(app, queryLower, queryNormalized) {
  const nameLower = (app.name || '').toLowerCase().trim();
  const nameNorm = normalize(nameLower);
  const aliases = (app.aliases || []).map(a => (a || '').toLowerCase().trim()).filter(Boolean);
  const aliasesNorm = aliases.map(a => normalize(a));
  const hasNormalizedQuery = queryNormalized.length > 0;
  const isShort = queryLower.length < 5;

  if (!queryLower) {
    return { score: 0, reason: 'empty query', matchType: 'none' };
  }

  // Exact alias match (always allowed, including short queries)
  // Check alias FIRST, because an explicit alias is more intentional than a coincidental name match.
  for (const alias of aliases) {
    if (alias === queryLower) {
      return { score: 1.0, reason: 'exact alias', matchType: 'exactAlias' };
    }
  }

  // Exact name match (always allowed, including short queries)
  if (nameLower === queryLower) {
    return { score: 0.99, reason: 'exact name', matchType: 'exactName' };
  }

  // startsWith name (allowed for short queries)
  if (nameLower.startsWith(queryLower)) {
    return { score: 0.86, reason: 'startsWith name', matchType: 'startsWithName' };
  }

  // startsWith alias (allowed for short queries)
  for (const alias of aliases) {
    if (alias.startsWith(queryLower)) {
      return { score: 0.86, reason: 'startsWith alias', matchType: 'startsWithAlias' };
    }
  }

  // Exact normalized match is useful for aliases/names with spaces:
  // "vs code" -> "vscode". Avoid empty normalized queries because Cyrillic-only
  // strings become empty after [^a-z0-9] normalization.
  if (hasNormalizedQuery && nameNorm === queryNormalized) {
    return { score: 0.94, reason: 'exact name', matchType: 'exactNormalizedName' };
  }

  if (hasNormalizedQuery) {
    for (const aliasNorm of aliasesNorm) {
      if (aliasNorm === queryNormalized) {
        return { score: 0.96, reason: 'exact alias', matchType: 'exactNormalizedAlias' };
      }
    }
  }

  // Partial/contains matching is disabled for short queries.
  if (isShort) {
    return { score: 0, reason: 'short query: contains/partial disabled', matchType: 'none' };
  }

  // Partial alias match (query is part of alias) — only for query.length >= 5
  for (const alias of aliases) {
    if (alias.includes(queryLower)) {
      return { score: 0.76, reason: 'contains alias', matchType: 'containsAlias' };
    }
  }

  // Partial name match (query is part of name) — only for query.length >= 5
  if (nameLower.includes(queryLower)) {
    return { score: 0.73, reason: 'contains name', matchType: 'containsName' };
  }

  // Normalized contains matches — only for query.length >= 5
  if (hasNormalizedQuery) {
    for (const aliasNorm of aliasesNorm) {
      if (aliasNorm.includes(queryNormalized)) {
        return { score: 0.75, reason: 'contains normalized alias', matchType: 'containsNormalizedAlias' };
      }
    }

    if (nameNorm.includes(queryNormalized)) {
      return { score: 0.71, reason: 'contains normalized name', matchType: 'containsNormalizedName' };
    }
  }

  return { score: 0, reason: 'no match', matchType: 'none' };
}

// --- Search in a JSON file ---
function searchInFile(filePath, queryLower, queryNormalized, sourceName) {
  const data = loadJSON(filePath, { apps: [] });
  const apps = data.apps || data || [];
  const results = [];

  for (const app of apps) {
    const source = normalizeSource(app.source, sourceName);
    const score = scoreApp(app, queryLower, queryNormalized);
    if (score.score > 0) {
      results.push({
        ...app,
        source,
        sourcePriority: sourcePriorityFor(source),
        score: score.score,
        reason: score.reason,
        matchType: score.matchType,
      });
    }
  }

  return results;
}

// --- where.exe fallback ---
// This is an exact command lookup: where.exe "cal" returns nothing,
// where.exe "calc" returns calc.exe. It is allowed for short queries, but never
// outranks GUI candidates from app-index/default/user/start-menu.
function whereFallback(query) {
  if (!isSafeForWhere(query)) return [];
  try {
    const output = execSync(`where "${query}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.trim().split('\n').map(line => line.trim()).filter(Boolean).map(matchedPath => ({
      name: matchedPath.split('\\').pop().split('.')[0],
      path: matchedPath,
      type: 'exe',
      source: 'where',
      matchType: 'whereExact',
    }));
  } catch {
    return [];
  }
}

// --- Deduplication and sorting ---
function formatCandidate(app) {
  return `${app.name || 'unknown'} [${app.source || 'unknown'}]`;
}

function compareCandidates(a, b) {
  // Primary: score (descending)
  if (a.score !== b.score) return b.score - a.score;
  // Secondary: sourcePriority (ascending - lower number = higher priority)
  if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
  // Tertiary: name for stable sorting
  return (a.name || '').localeCompare(b.name || '');
}

function dedupeCandidates(candidates) {
  const seen = new Map();
  const result = [];

  for (const app of candidates) {
    // Create dedup key based on type and endpoint
    const type = app.type || 'unknown';
    let key;
    if (app.path) key = `${type}|path|${app.path.toLowerCase()}`;
    else if (app.command) key = `${type}|command|${app.command.toLowerCase()}`;
    else if (app.aumid) key = `${type}|aumid|${app.aumid.toLowerCase()}`;
    else key = `${type}|name|${normalize(app.name)}`;

    // For exact matches (exactName/exactAlias/whereExact), also dedupe by normalized name
    // to prevent duplicates like "scalc" and "LibreOffice Calc" showing both for query "calc"
    const isExactMatch = ['exactName', 'exactAlias', 'exactNormalizedAlias', 'exactNormalizedName', 'whereExact'].includes(app.matchType);
    if (isExactMatch && !key.startsWith('command|') && !key.startsWith('uwp|')) {
      // For exact matches without command/aumid, use name-based dedupe
      const nameKey = `exactName|${normalize(app.name)}`;
      if (!seen.has(nameKey)) {
        seen.set(nameKey, app);
        result.push(app);
      }
    } else if (!seen.has(key)) {
      seen.set(key, app);
      result.push(app);
    }
  }

  return result;
}

// --- Debug log helper ---
function debug(...args) {
  console.log('[AppResolver]', ...args);
}

function isGuiCandidate(candidate) {
  return GUI_SOURCES.has(candidate.source);
}

function isExactOrStartsWith(candidate) {
  return EXACT_OR_STARTS_WITH_MATCHES.has(candidate.matchType);
}

function hasShortQueryGuiBlocker(candidates, top) {
  return candidates.some(candidate =>
    candidate !== top &&
    isGuiCandidate(candidate) &&
    isExactOrStartsWith(candidate) &&
    (candidate.score || 0) >= 0.75
  );
}

function hasGuiCandidateScoreAtLeast(candidates, top, threshold) {
  return candidates.some(candidate =>
    candidate !== top &&
    isGuiCandidate(candidate) &&
    (candidate.score || 0) >= threshold
  );
}

// --- Main resolve function ---
function resolve(rawQuery, options = {}) {
  const query = normalizeQuery(rawQuery);
  if (!query) {
    return { ok: false, notFound: true, message: 'Пустой запрос' };
  }

  const queryLower = query.toLowerCase();
  const queryNormalized = normalize(query);
  const isShort = queryLower.length < 5;

  debug('Original query:', rawQuery);
  debug('Normalized query:', query, '| short:', isShort);

  // 1. Search in user apps (priority 0)
  const userResults = searchInFile(USER_APPS_PATH, queryLower, queryNormalized, 'apps.user');
  debug('User candidates:', userResults.map(formatCandidate).join('; ') || 'none');

  // 2. Search in default apps (priority 1)
  const defaultResults = searchInFile(DEFAULT_APPS_PATH, queryLower, queryNormalized, 'apps.default');
  debug('Default candidates:', defaultResults.map(formatCandidate).join('; ') || 'none');

  // 3. Search in app-index.json (priority by source: start-menu/app-paths/uwp/registry/scan-roots/where)
  const indexData = loadJSON(INDEX_PATH, { apps: [] });
  const indexResults = (indexData.apps || []).map(app => {
    const score = scoreApp(app, queryLower, queryNormalized);
    const source = normalizeSource(app.source, 'unknown');
    const normalizedScore = source === 'where' && score.score > 0
      ? { score: 0.85, reason: 'where exact', matchType: 'whereExact' }
      : score;
    return normalizedScore.score > 0 ? {
      ...app,
      source,
      sourcePriority: sourcePriorityFor(source),
      score: normalizedScore.score,
      reason: normalizedScore.reason,
      matchType: normalizedScore.matchType,
    } : null;
  }).filter(Boolean);
  debug('Index candidates:', indexResults.map(formatCandidate).join('; ') || 'none');

  // 4. Exact command lookup through where.exe.
  // It is intentionally allowed for short queries, but only exact commands match.
  const whereResults = isShort && isSafeForWhere(query) ? whereFallback(query) : [];
  if (whereResults.length > 0) {
    debug('Where.exe candidates:', whereResults.map(formatCandidate).join('; '));
  } else if (isShort && isSafeForWhere(query)) {
    debug('Where.exe candidates: none');
  }

  // Combine all results
  let allCandidates = [...userResults, ...defaultResults, ...indexResults, ...whereResults];

  // 5. Debug before dedupe
  debug('Candidates before dedupe:', allCandidates.length, allCandidates.map(formatCandidate).join('; ') || 'none');

  // 6. Dedupe
  allCandidates = dedupeCandidates(allCandidates);

  // 7. Debug after dedupe
  debug('Candidates after dedupe:', allCandidates.length, allCandidates.map(formatCandidate).join('; ') || 'none');

  // 8. Sort by score, then by sourcePriority
  allCandidates.sort(compareCandidates);

  // 9. Determine result
  if (allCandidates.length === 0) {
    debug('Result: NOT FOUND');
    const notFoundInfo = {
      originalQuery: rawQuery,
      normalizedQuery: query,
      candidates: [],
      autoLaunch: false,
    };
    if (options.infoOnly) {
      return {
        ok: true,
        type: 'run',
        title: 'Информация о приложении',
        content: formatAppInfo(rawQuery, query, {
          notFound: true,
          ...notFoundInfo,
        }),
        data: notFoundInfo,
      };
    }
    return { ok: false, notFound: true, message: `Приложение "${query}" не найдено` };
  }

  const top = allCandidates[0];
  const second = allCandidates[1];
  const scoreGap = second ? (top.score - second.score) : 1;

  // Check if both top and second are exact match types
  const exactLaunchTypes = new Set(['exactName', 'exactAlias', 'exactNormalizedAlias', 'exactNormalizedName', 'whereExact']);
  const topIsExact = exactLaunchTypes.has(top.matchType);
  const secondIsExact = second && exactLaunchTypes.has(second.matchType);

  // For exact matches vs exact matches with same score, check if top has better priority.
  // This is a clear winner - Calculator (priority 1) beats calc.exe (priority 7).
  const topHasBetterPriority = second && (top.sourcePriority ?? 99) < (second.sourcePriority ?? 99);

  // Clear winner if no second, or significant score gap, or top has better priority (for exact matches)
  const hasClearWinner = !second ||
    scoreGap >= 0.08 ||
    (topIsExact && secondIsExact && topHasBetterPriority);

  const isAmbiguousShortStartsWith = isShort && top.matchType && top.matchType.startsWith('startsWith') && allCandidates.length > 1;

  const shortQueryGuiBlocker = isShort && hasShortQueryGuiBlocker(allCandidates, top);
  const whereGuiBlocker = top.source === 'where' && hasGuiCandidateScoreAtLeast(allCandidates, top, 0.75);
  const shortQueryNonGuiBlocker = isShort && shortQueryGuiBlocker && !isGuiCandidate(top);
  const guiBlockReason = (whereGuiBlocker || shortQueryNonGuiBlocker) ? 'blocked autoLaunch because GUI candidate exists' : null;
  const guiBlockers = allCandidates.filter(candidate =>
    candidate !== top &&
    isGuiCandidate(candidate) &&
    (((isShort && isExactOrStartsWith(candidate)) || (top.source === 'where')) && (candidate.score || 0) >= 0.75)
  );

  const autoLaunch = top.score >= 0.85 && hasClearWinner && !isAmbiguousShortStartsWith && !guiBlockReason;

  debug('Top:', formatCandidate(top));
  debug('Second:', second ? formatCandidate(second) : 'none');
  debug('GUI blockers:', guiBlockers.map(formatCandidate).join('; ') || 'none');
  debug('Score gap:', Number(scoreGap).toFixed(3), '| clear winner:', hasClearWinner);

  // If debug mode requested, return detailed information
  if (options.debug) {
    return {
      ok: true,
      debug: {
        originalQuery: rawQuery,
        normalizedQuery: query,
        expandedVariants: [], // This would be filled by caller if needed
        candidates: allCandidates.map(candidate => ({
          ...candidate,
          finalScore: options.queryVariantPriority !== undefined ? candidate.score - (options.queryVariantPriority * 0.03) : candidate.score
        })),
        topCandidate: top,
        secondCandidate: second,
        scoreGap: Number(scoreGap).toFixed(3),
        hasClearWinner,
        meetsThreshold: top.score >= 0.85,
        autoLaunch,
        autoLaunchBlockedReason: guiBlockReason || 
          (top.score < 0.85 ? 'top score < 0.85' : 
           !hasClearWinner ? 'no clear winner / ambiguous candidates' : 
           isAmbiguousShortStartsWith ? 'short query startsWith match with multiple candidates' : null)
      }
    };
  }

  const result = {
    ok: false,
    needsSelection: true,
    candidates: allCandidates.slice(0, 10),
    message: `Найдено ${allCandidates.length} приложений. Выберите:`,
  };

  if (guiBlockReason) {
    result.autoLaunchBlockedReason = guiBlockReason;
  }

  if (autoLaunch) {
    debug('AutoLaunch true:', top.name, '| reason:', top.reason, '| matchType:', top.matchType);
    if (options.infoOnly) {
      return {
        ok: true,
        type: 'run',
        title: 'Информация о приложении',
        content: formatAppInfo(rawQuery, query, {
          app: top,
          candidates: [],
          autoLaunch,
        }),
        data: {
          originalQuery: rawQuery,
          normalizedQuery: query,
          selectedApp: top,
          candidates: [],
          autoLaunch,
        },
      };
    }
    return {
      ok: true,
      app: top,
    };
  }

  const autoLaunchReasons = [];
  if (top.score < 0.85) autoLaunchReasons.push('top score < 0.85');
  if (!hasClearWinner) autoLaunchReasons.push('no clear winner / ambiguous candidates');
  if (isAmbiguousShortStartsWith) autoLaunchReasons.push('short query startsWith match with multiple candidates');
  if (guiBlockReason) autoLaunchReasons.push(guiBlockReason);

  debug('AutoLaunch false:', top.name, '| reasons:', autoLaunchReasons.join('; ') || 'score below threshold');
  debug('Result: NEEDS SELECTION, candidates:', allCandidates.map(formatCandidate).join('; '));

  if (options.infoOnly) {
    return {
      ok: true,
      type: 'run',
      title: 'Информация о приложении',
      content: formatAppInfo(rawQuery, query, {
        ...result,
        candidates: result.candidates,
        autoLaunch,
      }),
      data: {
        originalQuery: rawQuery,
        normalizedQuery: query,
        selectedApp: null,
        candidates: result.candidates,
        autoLaunch,
        autoLaunchBlockedReason: guiBlockReason,
      },
    };
  }

  return result;
}

module.exports = { resolve, normalizeQuery, scoreApp, SOURCE_PRIORITY };