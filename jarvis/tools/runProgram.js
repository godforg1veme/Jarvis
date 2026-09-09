const appResolver = require('./appResolver');
const launchApp = require('./launchApp');
const queryExpander = require('./queryExpander');
const aiIntentResolver = require('./aiIntentResolver');
const { evaluateLaunchPolicy } = require('./launchPolicy');
const { normalizeAlias } = require('./appIdentity');
const { isAbsoluteLocalPath } = require('./launchDescriptor');
const fs = require('fs');
const path = require('path');

function getWritablePath(filePath) {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged && typeof app.getPath === 'function') {
      const dataDir = path.resolve(__dirname, '..', 'data');
      const resolved = path.resolve(filePath);
      if (resolved.startsWith(dataDir)) {
        const rel = path.relative(dataDir, resolved);
        return path.join(app.getPath('userData'), 'data', rel);
      }
    }
  } catch {}
  return filePath;
}

const USER_APPS_PATH = path.join(__dirname, '..', 'data', 'apps.user.json');
const AI_SETTINGS_PATH = path.join(__dirname, '..', 'data', 'ai-settings.json');
const AI_THINKING_STATUS = 'AI: пытаюсь понять запрос...';
const RUN_PROGRAM_AI_CAPABILITIES = ['launch_app', 'search_app'];
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

function recoveryResponse(originalQuery, normalizedQuery = '') {
  return {
    ok: false,
    type: 'recovery',
    title: 'Ищу неизвестное приложение',
    content: `Локальный поиск не нашёл "${normalizedQuery || originalQuery}". Запускаю расширенный поиск.`,
    needsRecovery: true,
    query: originalQuery,
    normalizedQuery: normalizedQuery || originalQuery,
    inputChannel: 'text',
  };
}

function isExplicitLaunchRequest(value) {
  return /^(?:\/run\s+|(?:джарвис[\s,]+)?(?:открой|открыть|запусти|запустить|open|run|launch)(?:\s|$))/iu.test(String(value || '').trim());
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

  if (aiResult?.appQuery) {
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
      const aiResult = await aiIntentResolver.resolveCommandWithAi(originalInput, {
        mode: 'launcher-debug',
        capabilities: RUN_PROGRAM_AI_CAPABILITIES,
        allowDesktopAgent: true,
      });
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
    if (resolved.result.source === 'apps.learned' && resolved.result.launch) {
      const policy = evaluateLaunchPolicy(resolved.result.launch, {
        launch: resolved.result.launch,
        fingerprint: resolved.result.fingerprint,
      });
      if (policy.decision === 'confirmation_required') {
        return recoveryResponse(originalInput, resolved.result.name);
      }
      if (policy.decision === 'blocked') return notFoundResponse({ message: policy.reason }, originalInput);
    }
    return launchApp.launch(resolved.result);
  }

  if (resolved.type === 'selection') {
    return selectionResponse(resolved.result);
  }

  if (isExplicitLaunchRequest(originalInput)) {
    return recoveryResponse(originalInput);
  }

  if (shouldUseAiFallback()) {
    const aiStatuses = [AI_THINKING_STATUS];

    try {
      const aiResult = await aiIntentResolver.resolveCommandWithAi(originalInput, {
        mode: 'launcher',
        capabilities: RUN_PROGRAM_AI_CAPABILITIES,
        allowDesktopAgent: true,
      });

      if (aiResult.route === 'desktop_agent') {
        return addAiStatus({
          ok: false,
          type: 'agent',
          title: 'Desktop Agent',
          content: 'Команда требует многошагового плана. Передаю её Desktop Agent.',
          needsAgent: true,
          command: originalInput,
        }, [AI_THINKING_STATUS, 'AI определил: требуется Desktop Agent']);
      }

      const canUseAi = aiResult.route === 'direct' &&
        ['launch_app', 'search_app'].includes(aiResult.action) &&
        aiResult.confidence >= 0.75;

      if (canUseAi) {
        const aiStatusesWithUnderstood = [
          AI_THINKING_STATUS,
          `AI понял: ${aiResult.appQuery || originalInput}`,
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

          return addAiStatus(recoveryResponse(originalInput, aiResult.appQuery), aiStatusesWithUnderstood);
        }
      }

      return addAiStatus(notFoundResponse(resolved.result, originalInput), [
        ...aiStatuses,
        aiResult.route === 'unknown' ? `AI не уверен: ${aiResult.reason || 'confidence < 0.75'}` : `AI не нашёл candidates: confidence ${aiResult.confidence}`,
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
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias || !isAbsoluteLocalPath(expandedPath)) {
    return {
      ok: false,
      type: 'run',
      title: 'Ошибка',
      content: 'Алиас должен быть непустым, а путь — абсолютным локальным путём.',
    };
  }

  // Determine type
  let type = 'exe';
  if (expandedPath.toLowerCase().endsWith('.lnk')) {
    type = 'lnk';
  }

  const newApp = {
    name: alias,
    aliases: [normalizedAlias],
    type,
    path: expandedPath,
  };

  // Load existing user apps
  let userData;
  const userAppsTarget = getWritablePath(USER_APPS_PATH);
  try {
    if (fs.existsSync(userAppsTarget)) {
      userData = JSON.parse(fs.readFileSync(userAppsTarget, 'utf-8'));
    } else if (fs.existsSync(USER_APPS_PATH)) {
      userData = JSON.parse(fs.readFileSync(USER_APPS_PATH, 'utf-8'));
    } else {
      userData = { apps: [] };
    }
  } catch {
    userData = { apps: [] };
  }

  if (!userData.apps) userData.apps = [];

  // Check if already exists
  const existingIndex = userData.apps.findIndex(a =>
    normalizeAlias(a.name) === normalizedAlias ||
    (a.aliases || []).map(normalizeAlias).includes(normalizedAlias)
  );

  if (existingIndex >= 0) {
    userData.apps[existingIndex] = newApp;
  } else {
    userData.apps.push(newApp);
  }

  try {
    const dir = path.dirname(userAppsTarget);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(userAppsTarget, JSON.stringify(userData, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[runProgram] Failed to write ${userAppsTarget}:`, err);
  }

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

module.exports = {
  execute,
  addApp,
  getSchema,
  recoveryResponse,
  isExplicitLaunchRequest,
};
