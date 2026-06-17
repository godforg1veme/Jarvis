const appResolver = require('./appResolver');
const launchApp = require('./launchApp');
const queryExpander = require('./queryExpander');
const aiIntentResolver = require('./aiIntentResolver');
const fs = require('fs');
const path = require('path');

const USER_APPS_PATH = path.join(__dirname, '..', 'data', 'apps.user.json');
const AI_SETTINGS_PATH = path.join(__dirname, '..', 'data', 'ai-settings.json');
const AI_THINKING_STATUS = 'AI: пытаюсь понять запрос...';

/**
 * Execute app launch: resolve query → launch app
 */
function formatCandidates(result) {
  return (result.candidates || []).map(c => ({
    name: c.name,
    aliases: c.aliases || [],
    type: c.type,
    path: c.path,
    aumid: c.aumid,
    command: c.command,
    icon: c.icon,
    score: c.score,
    reason: c.reason,
    matchType: c.matchType,
    source: c.source,
    sourcePriority: c.sourcePriority,
  }));
}

function notFoundResponse(result, query) {
  const message = result?.message || `Приложение "${query}" не найдено`;

  return {
    ok: false,
    type: 'run',
    title: 'Приложение не найдено',
    content: `${message}\n\nПодсказка: используйте /addapp <имя> "<путь>" для добавления приложения.`,
    notFound: true,
    candidates: undefined,
  };
}

function selectionResponse(result) {
  return {
    ok: false,
    type: 'run',
    title: 'Выберите приложение',
    content: result.message,
    needsSelection: true,
    candidates: formatCandidates(result),
  };
}

function loadAiSettings() {
  try {
    return JSON.parse(fs.readFileSync(AI_SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function shouldUseAiFallback() {
  const settings = loadAiSettings();
  return settings.enableAiIntent !== false && settings.useAiOnlyOnFallback !== false;
}

function addAiStatus(result, statuses) {
  if (!result) return result;

  const statusText = statuses.filter(Boolean).join('\n');
  if (!statusText) return result;

  const existingContent = String(result.content || '');
  if (!existingContent.startsWith(statusText)) {
    result.content = `${statusText}\n\n${existingContent}`.trim();
  }
  result.aiUsed = true;

  return result;
}

function isDangerousAiQuery(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('powershell') || normalized === 'cmd' || normalized.includes('cmd.exe')) return true;
  if (normalized.includes('command') || normalized.endsWith('.exe')) return true;
  if (normalized.includes('\\') || normalized.includes('/')) return true;
  if (normalized === 'steam') return true;

  return false;
}

function aiVariantsFromIntent(aiResult) {
  const queries = [];

  if (Array.isArray(aiResult?.expandedQueries)) {
    queries.push(...aiResult.expandedQueries);
  }

  if (queries.length === 0 && aiResult?.appQuery) {
    queries.push(aiResult.appQuery);
  }

  return queries
    .map(query => String(query || '').trim())
    .filter(query => query && !isDangerousAiQuery(query))
    .map(query => ({ query, source: 'ai', priority: 3 }));
}

function candidateDedupeKey(candidate) {
  const endpoint = String(candidate.path || candidate.command || candidate.aumid || candidate.name || '').toLowerCase();
  return `${candidate.type || 'unknown'}|${endpoint}|${candidate.source || 'unknown'}`;
}

function dedupeCandidatesWithMetadata(candidates) {
  const seen = new Map();

  for (const candidate of candidates) {
    const key = candidateDedupeKey(candidate);
    const existing = seen.get(key);

    if (!existing || candidate.finalScore > existing.finalScore) {
      seen.set(key, candidate);
    }
  }

  return Array.from(seen.values());
}

function noLaunchResponse(app) {
  return {
    ok: true,
    type: 'run',
    title: `Будет запущен: ${app.name || 'unknown'}`,
    content: JSON.stringify(app, null, 2),
    data: app,
  };
}

function resolveForInfo(variants) {
  let lastNotFound = null;

  for (const variant of variants) {
    const queryString = typeof variant === 'string' ? variant : variant.query;
    const result = appResolver.resolve(queryString, { infoOnly: true });

    if (result.ok && result.data?.selectedApp) {
      return result;
    }

    lastNotFound = result;
  }

  return lastNotFound;
}

function resolveForLaunch(variants) {
  // Collect all candidates from all variants
  const allCandidatesWithMetadata = [];

  for (const variantObj of variants) {
    const queryString = typeof variantObj === 'string' ? variantObj : variantObj.query;
    const queryVariant = typeof variantObj === 'string' ? variantObj : variantObj.query;
    const queryVariantPriority = typeof variantObj === 'string' ? 0 : variantObj.priority;

    // Resolve this variant
    const result = appResolver.resolve(queryString);

    if (result.ok && result.app) {
      // Successful resolution with app
      allCandidatesWithMetadata.push({
        ...result.app,
        queryVariant,
        queryVariantPriority,
        resolverScore: result.app.score,
        finalScore: result.app.score - (queryVariantPriority * 0.03)
      });
    } else if (result.needsSelection && result.candidates) {
      // Multiple candidates - add all of them
      for (const candidate of result.candidates) {
        allCandidatesWithMetadata.push({
          ...candidate,
          queryVariant,
          queryVariantPriority,
          resolverScore: candidate.score,
          finalScore: candidate.score - (queryVariantPriority * 0.03)
        });
      }
    }
    // Note: notFound results are ignored for launch selection
  }

  // If no candidates found, return not found
  if (allCandidatesWithMetadata.length === 0) {
    return { type: 'notFound', result: { notFound: true, message: `Приложение не найдено` } };
  }

  // Sort by finalScore descending
  allCandidatesWithMetadata.sort((a, b) => b.finalScore - a.finalScore);

  // Deduplicate repeated matches from different query variants.
  const uniqueCandidates = dedupeCandidatesWithMetadata(allCandidatesWithMetadata);
  const topCandidate = uniqueCandidates[0];
  const secondCandidate = uniqueCandidates[1];

  // Check if we should auto-launch
  const scoreGap = secondCandidate ? (topCandidate.finalScore - secondCandidate.finalScore) : 1;
  const hasClearWinner = !secondCandidate || scoreGap >= 0.08;
  const meetsThreshold = topCandidate.finalScore >= 0.85;

  if (meetsThreshold && hasClearWinner) {
    // Launch the top candidate
    return { type: 'app', result: topCandidate };
  } else {
      // Return selection needed
      const selectionResult = {
        ok: false,
        needsSelection: true,
        candidates: uniqueCandidates.slice(0, 10),
        message: `Найдено ${uniqueCandidates.length} приложений. Выберите:`,
      };
      
      if (!meetsThreshold) {
        selectionResult.autoLaunchBlockedReason = 'top score < 0.85';
      } else if (!hasClearWinner) {
        selectionResult.autoLaunchBlockedReason = 'no clear winner / ambiguous candidates';
      }
      
      return { type: 'selection', result: selectionResult };
  }
}

async function execute(args, confirmed) {
  const originalInput = (args.app || '').trim();

  if (!originalInput) {
    return {
      ok: false,
      type: 'run',
      title: 'Запуск программы',
      content: 'Укажите имя программы для запуска.',
      error: 'app is required',
    };
  }

  const variants = queryExpander.expandQuery(originalInput);

  // Handle debugresolve command
  if (args._debugresolve) {
    // For debug, we want to see detailed info for the original query
    // We don't use infoOnly here because we want the debug structure
    const debugResult = appResolver.resolve(originalInput, { debug: true });
    
    if (debugResult.ok) {
      // Format the debug information for display
      const debugInfo = debugResult.debug;
      
      let content = `=== DEBUG RESOLVE ===\n`;
      content += `original query: ${debugInfo.originalQuery}\n`;
      content += `normalized query: ${debugInfo.normalizedQuery}\n\n`;
      
      content += `expanded variants:\n`;
      // We don't have expanded variants in debug result yet, but we can compute them
      const expanded = queryExpander.expandQuery(originalInput);
      for (const variant of expanded) {
        const queryStr = typeof variant === 'string' ? variant : variant.query;
        const source = typeof variant === 'string' ? 'original' : variant.source;
        const priority = typeof variant === 'string' ? 0 : variant.priority;
        content += `  - "${queryStr}" (source: ${source}, priority: ${priority})\n`;
      }
      content += `\n`;
      
      content += `candidates:\n`;
      for (const candidate of debugInfo.candidates) {
        content += `  - ${candidate.name} [${candidate.source}] score: ${candidate.score.toFixed(3)} reason: ${candidate.reason}`;
        if (candidate.finalScore !== undefined) {
          content += ` finalScore: ${candidate.finalScore.toFixed(3)}`;
        }
        content += `\n`;
      }
      content += `\n`;
      
      content += `top candidate: ${debugInfo.topCandidate?.name || 'none'} [${debugInfo.topCandidate?.source || 'unknown'}]\n`;
      content += `second candidate: ${debugInfo.secondCandidate?.name || 'none'} [${debugInfo.secondCandidate?.source || 'unknown'}]\n`;
      content += `score gap: ${debugInfo.scoreGap}\n`;
      content += `clear winner: ${debugInfo.hasClearWinner}\n`;
      content += `meets threshold (>=0.85): ${debugInfo.meetsThreshold}\n`;
      content += `auto launch: ${debugInfo.autoLaunch}\n`;
      if (debugInfo.autoLaunchBlockedReason) {
        content += `auto launch blocked: ${debugInfo.autoLaunchBlockedReason}\n`;
      }
      
      return {
        ok: true,
        type: 'run',
        title: 'Отладка разрешения приложения',
        content: content,
      };
    } else {
      return notFoundResponse(debugResult, originalInput);
    }
  }

  // /aidebug should only show AI intent JSON, never launch anything.
  if (args._aidebug) {
    try {
      const aiResult = await aiIntentResolver.resolveIntentWithAi(originalInput);
      return {
        ok: true,
        type: 'ai',
        title: 'AI intent JSON',
        content: JSON.stringify(aiResult, null, 2),
        data: aiResult,
      };
    } catch (err) {
      return {
        ok: false,
        type: 'ai',
        title: 'AI intent error',
        content: err.message,
        error: err.message,
      };
    }
  }

  // /appinfo should only inspect resolver decisions, never launch anything.
  if (args._appinfo) {
    return resolveForInfo(variants);
  }

  const resolved = resolveForLaunch(variants);

  if (resolved.type === 'app') {
    if (args._noLaunch) {
      return noLaunchResponse(resolved.result);
    }
    return launchApp.launch(resolved.result);
  }

  if (resolved.type === 'selection') {
    return selectionResponse(resolved.result);
  }

  if (shouldUseAiFallback()) {
    const aiStatuses = [AI_THINKING_STATUS];

    try {
      const aiResult = await aiIntentResolver.resolveIntentWithAi(originalInput);
      const canUseAi = ['open_app', 'search_app'].includes(aiResult.intent) && aiResult.confidence >= 0.6;

      if (canUseAi) {
        const aiStatusesWithUnderstood = [
          AI_THINKING_STATUS,
          `AI понял: ${aiResult.appQuery || aiResult.expandedQueries?.[0] || aiResult.original || originalInput}`,
        ];
        const aiVariants = aiVariantsFromIntent(aiResult);

        if (aiVariants.length > 0) {
          const aiResolved = resolveForLaunch(aiVariants);

          if (aiResolved.type === 'app') {
            if (args._noLaunch) {
              return addAiStatus(noLaunchResponse(aiResolved.result), aiStatusesWithUnderstood);
            }
            return addAiStatus(await launchApp.launch(aiResolved.result), aiStatusesWithUnderstood);
          }

          if (aiResolved.type === 'selection') {
            return addAiStatus(selectionResponse(aiResolved.result), aiStatusesWithUnderstood);
          }
        }
      }

      return addAiStatus(notFoundResponse(resolved.result, originalInput), [
        ...aiStatuses,
        aiResult.intent === 'unknown' ? `AI не уверен: ${aiResult.reason || 'confidence < 0.6'}` : `AI не нашёл candidates: confidence ${aiResult.confidence}`,
      ]);
    } catch (err) {
      return addAiStatus(notFoundResponse(resolved.result, originalInput), [
        ...aiStatuses,
        err.message,
      ]);
    }
  }

  return notFoundResponse(resolved.result, typeof variants[0] === 'string' ? variants[0] : variants[0].query);
}

/**
 * Add a user-defined app
 */
function addApp(args) {
  const { alias, appPath } = args;
  if (!alias || !appPath) {
    return {
      ok: false,
      type: 'run',
      title: 'Ошибка',
      content: 'Использование: /addapp <alias> "<путь>"',
    };
  }

  const expandedPath = appPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');

  // Determine type
  let type = 'exe';
  if (expandedPath.toLowerCase().endsWith('.lnk')) {
    type = 'lnk';
  }

  const newApp = {
    name: alias,
    aliases: [alias.toLowerCase().replace(/[^a-z0-9]/g, '')],
    type,
    path: expandedPath,
  };

  // Load existing user apps
  let userData;
  try {
    userData = JSON.parse(fs.readFileSync(USER_APPS_PATH, 'utf-8'));
  } catch {
    userData = { apps: [] };
  }

  if (!userData.apps) userData.apps = [];

  // Check if already exists
  const existingIndex = userData.apps.findIndex(a =>
    a.name.toLowerCase() === alias.toLowerCase() ||
    (a.aliases || []).includes(alias.toLowerCase().replace(/[^a-z0-9]/g, ''))
  );

  if (existingIndex >= 0) {
    userData.apps[existingIndex] = newApp;
  } else {
    userData.apps.push(newApp);
  }

  fs.writeFileSync(USER_APPS_PATH, JSON.stringify(userData, null, 2), 'utf-8');

  return {
    ok: true,
    type: 'run',
    title: `Приложение добавлено: ${alias}`,
    content: `${alias} → ${expandedPath}`,
    data: newApp,
  };
}

function getSchema() {
  return 'run: запуск приложения. Args: { app: string }. Пример: /run notepad\naidebug: AI intent JSON без запуска. Args: { app: string, _aidebug: true }. Пример: /aidebug браузер от мозиллы\nappinfo: информация о выборе appResolver. Args: { app: string, _appinfo: true }. Пример: /appinfo code\naddapp: добавить приложение. Args: { alias, path }. Пример: /addapp myapp "C:\\path\\to\\app.exe"';
}

/**
 * Learning mode: remember alias → app mapping from user selection
 */
function learnApp(alias, app) {
  if (!alias || !app || !app.name) {
    return { ok: false, message: 'Missing alias or app data' };
  }

  const normalizedAlias = alias.toLowerCase().trim();
  const userEntry = {
    name: app.name,
    aliases: [normalizedAlias.replace(/[^a-z0-9]/g, '')],
    type: app.type || 'exe',
    path: app.path || '',
    aumid: app.aumid || '',
    learnedFrom: 'learning-mode',
  };

  let userData;
  try {
    userData = JSON.parse(fs.readFileSync(USER_APPS_PATH, 'utf-8'));
  } catch {
    userData = { apps: [] };
  }

  if (!userData.apps) userData.apps = [];

  // Check if this alias already exists
  const existingIndex = userData.apps.findIndex(a =>
    (a.aliases || []).includes(normalizedAlias)
  );

  if (existingIndex >= 0) {
    // Update existing entry
    userData.apps[existingIndex] = { ...userData.apps[existingIndex], ...userEntry };
  } else {
    userData.apps.push(userEntry);
  }

  fs.writeFileSync(USER_APPS_PATH, JSON.stringify(userData, null, 2), 'utf-8');

  return { ok: true, message: `Запомнил: ${normalizedAlias} → ${app.name}` };
}

module.exports = { execute, addApp, learnApp, getSchema };