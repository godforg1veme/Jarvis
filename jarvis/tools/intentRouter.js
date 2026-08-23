const { parseIntent: defaultParseIntent } = require('../voice/intentParser');
const { apps: defaultApps } = require('../actions/appRegistry');
const { resolveCommandWithAi: defaultResolveCommandWithAi } = require('./aiIntentResolver');

const VOICE_CAPABILITIES = [
  'launch_app',
  'close_app',
  'open_file',
  'reveal_file',
  'find_file',
  'translate_selected',
];

function normalizeAppName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function resolveKnownAppId(query, apps = defaultApps) {
  const normalized = normalizeAppName(query);
  if (!normalized) return '';
  const matches = Object.values(apps || {}).filter((app) => {
    const names = [app.id, app.displayName, ...(Array.isArray(app.aliases) ? app.aliases : [])];
    return names.some((name) => normalizeAppName(name) === normalized);
  });
  return matches.length === 1 ? matches[0].id : '';
}

function failedIntent(rawText, reason, source = 'openrouter') {
  return {
    ok: false,
    reason: String(reason || 'Команда не распознана уверенно.'),
    source,
    rawText,
  };
}

function mapAiResultToIntent(aiResult, rawText, options = {}) {
  if (!aiResult || aiResult.route === 'unknown') {
    return failedIntent(rawText, aiResult && aiResult.reason);
  }
  if (aiResult.route === 'desktop_agent') {
    return {
      ok: true,
      action: 'desktop_agent',
      command: rawText,
      confidence: aiResult.confidence,
      source: 'openrouter',
      rawText,
    };
  }
  if (aiResult.route !== 'direct') return failedIntent(rawText, 'AI вернул неизвестный маршрут.');

  if (aiResult.action === 'launch_app' || aiResult.action === 'close_app') {
    const appId = resolveKnownAppId(aiResult.appQuery, options.apps || defaultApps);
    if (!appId) return failedIntent(rawText, 'AI предложил неизвестное или неоднозначное приложение.');
    return {
      ok: true,
      action: aiResult.action,
      appId,
      confidence: aiResult.confidence,
      source: 'openrouter',
      rawText,
    };
  }

  if (['open_file', 'reveal_file', 'find_file'].includes(aiResult.action)) {
    return {
      ok: true,
      action: aiResult.action,
      query: aiResult.query,
      location: aiResult.location,
      confidence: aiResult.confidence,
      source: 'openrouter',
      rawText,
    };
  }

  if (aiResult.action === 'translate_selected') {
    return {
      ok: true,
      action: 'translate_selected',
      confidence: aiResult.confidence,
      source: 'openrouter',
      rawText,
    };
  }

  return failedIntent(rawText, 'AI вернул неподдерживаемое действие.');
}

async function routeIntent(rawText, options = {}) {
  const text = String(rawText || '').trim();
  if (!text) return failedIntent(rawText, 'Пустая команда.', 'local');

  const parseIntent = options.parseIntent || defaultParseIntent;
  const localIntent = parseIntent(text);
  if (localIntent && localIntent.ok) return localIntent;

  const resolveCommandWithAi = options.resolveCommandWithAi || defaultResolveCommandWithAi;
  try {
    const aiResult = await resolveCommandWithAi(text, {
      ...(options.aiOptions || {}),
      mode: options.mode || 'voice',
      capabilities: options.capabilities || VOICE_CAPABILITIES,
      allowDesktopAgent: options.allowDesktopAgent !== false,
    });
    return mapAiResultToIntent(aiResult, text, options);
  } catch (error) {
    return failedIntent(text, error.message || 'AI fallback недоступен.');
  }
}

module.exports = {
  VOICE_CAPABILITIES,
  routeIntent,
  mapAiResultToIntent,
  resolveKnownAppId,
  normalizeAppName,
};
