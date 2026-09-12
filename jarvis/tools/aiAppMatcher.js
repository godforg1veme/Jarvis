const fs = require('fs');
const path = require('path');
const { chatJson: defaultChatJson, isHeaderSafeApiKey } = require('./aiClient');
const { providerMetadata } = require('./appCandidateValidator');
const { uniqueAliases } = require('./appIdentity');
const { getWritableDataPath } = require('../runtimeDataPath');

const SCHEMA_VERSION = 1;
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'ai-settings.json');
const ALLOWED_FIELDS = new Set(['schemaVersion', 'candidateId', 'confidence', 'aliases', 'reason']);
const FORBIDDEN_FIELD_PATTERN = /(path|executable|command|shell|powershell|tool|args?)/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeProviderQuery(value, options = {}) {
  let text = String(value || '').trim()
    .replace(/["']?[a-zA-Z]:\\[^\r\n"']*["']?/g, '[redacted-path]')
    .replace(/\\\\[^\r\n"']+/g, '[redacted-path]');
  const profileName = process.env.USERPROFILE ? path.basename(process.env.USERPROFILE) : '';
  const usernames = options.usernames || [process.env.USERNAME, profileName];
  for (const username of usernames.filter(Boolean)) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(username)}\\b`, 'gi'), '[redacted-user]');
  }
  return text.slice(0, 1000);
}

function loadSettings() {
  try {
    const target = getWritableDataPath(SETTINGS_PATH);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf8'));
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return {};
  } catch { return {}; }
}

function buildMessages(query, candidates) {
  const shortlist = candidates.slice(0, 30).map(providerMetadata);
  return [
    {
      role: 'system',
      content: `Ты выбираешь приложение только из локально найденных кандидатов Jarvis. Не выполняй команды. Верни ровно один JSON-объект без markdown:
{"schemaVersion":1,"candidateId":"candidate-id или пустая строка","confidence":0.0,"aliases":["безопасные названия"],"reason":"кратко"}

Правила:
- candidateId должен точно совпадать с одним ID из списка или быть пустым при отсутствии совпадения.
- Не возвращай пути, executable, command, shell, PowerShell, tool, args или дополнительные поля.
- Алиасы — только человеческие названия приложения, максимум 8.
- Не придумывай приложения вне списка.`,
    },
    {
      role: 'user',
      content: JSON.stringify({ query: sanitizeProviderQuery(query), candidates: shortlist }),
    },
  ];
}

function parseMatchResponse(text, candidates) {
  let raw;
  try { raw = JSON.parse(String(text || '').trim()); } catch { throw new Error('AI matcher returned invalid JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AI matcher response must be an object');
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELDS.has(key) || FORBIDDEN_FIELD_PATTERN.test(key)) throw new Error(`AI matcher returned forbidden field: ${key}`);
  }
  if (Number(raw.schemaVersion) !== SCHEMA_VERSION) throw new Error('unsupported AI matcher schema version');
  const candidateId = String(raw.candidateId || '').trim();
  if (candidateId && !candidates.some(candidate => candidate.candidateId === candidateId)) {
    throw new Error('AI matcher returned unknown candidateId');
  }
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('AI matcher confidence is invalid');
  if (!Array.isArray(raw.aliases)) throw new Error('AI matcher aliases must be an array');
  if (raw.aliases.length > 8 || raw.aliases.some(value => typeof value !== 'string')) throw new Error('AI matcher aliases are invalid');
  return {
    schemaVersion: SCHEMA_VERSION,
    candidateId,
    confidence,
    aliases: uniqueAliases(raw.aliases),
    reason: String(raw.reason || '').slice(0, 500),
  };
}

function localFallback(candidates, options = {}) {
  const singleThreshold = options.singleThreshold ?? 0.85;
  const selectionThreshold = options.selectionThreshold ?? 0.60;
  const scoreGap = options.scoreGap ?? 0.08;
  const sorted = [...candidates].sort((a, b) => b.localScore - a.localScore);
  const top = sorted[0];
  const second = sorted[1];
  if (!top || top.localScore < selectionThreshold) return { mode: 'none', candidates: [], aliases: [], aiUsed: false };
  if (top.localScore >= singleThreshold && (!second || top.localScore - second.localScore >= scoreGap)) {
    return { mode: 'single', candidates: [top], aliases: [], aiUsed: false };
  }
  return { mode: 'selection', candidates: sorted.slice(0, 3), aliases: [], aiUsed: false };
}

function applyAiMatch(parsed, candidates, options = {}) {
  const singleThreshold = options.singleThreshold ?? 0.85;
  const selectionThreshold = options.selectionThreshold ?? 0.60;
  const scoreGap = options.scoreGap ?? 0.08;
  const selected = candidates.find(candidate => candidate.candidateId === parsed.candidateId);
  if (!selected || parsed.confidence < selectionThreshold) {
    return { mode: 'none', candidates: [], aliases: [], aiUsed: true, reason: parsed.reason };
  }
  const alternatives = candidates.filter(candidate => candidate !== selected).sort((a, b) => b.localScore - a.localScore);
  const closeAlternative = alternatives[0] && Math.abs(selected.localScore - alternatives[0].localScore) < scoreGap;
  if (parsed.confidence >= singleThreshold && !closeAlternative) {
    return { mode: 'single', candidates: [selected], aliases: parsed.aliases, aiUsed: true, reason: parsed.reason, confidence: parsed.confidence, matchedCandidateId: selected.candidateId };
  }
  const selection = [selected, ...alternatives].slice(0, 3);
  return { mode: 'selection', candidates: selection, aliases: parsed.aliases, aiUsed: true, reason: parsed.reason, confidence: parsed.confidence, matchedCandidateId: selected.candidateId };
}

async function matchCandidates(query, candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return { mode: 'none', candidates: [], aliases: [], aiUsed: false };
  const settings = options.settings || loadSettings();
  const recoverySettings = settings.appRecovery || {};
  if (recoverySettings.enableAi === false) return localFallback(candidates, recoverySettings);
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.OPENROUTER_API_KEY;
  if (!isHeaderSafeApiKey(apiKey)) return localFallback(candidates, recoverySettings);

  const transport = options.chatJson || defaultChatJson;
  try {
    const text = await transport(buildMessages(query, candidates), {
      model: options.model || recoverySettings.model || settings.textModel || 'openrouter/free',
      timeoutMs: options.timeoutMs || recoverySettings.timeoutMs || settings.timeoutMs || 30000,
      signal: options.signal,
    });
    return applyAiMatch(parseMatchResponse(text, candidates), candidates, recoverySettings);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { ...localFallback(candidates, recoverySettings), fallbackReason: error.message };
  }
}

module.exports = {
  SCHEMA_VERSION,
  buildMessages,
  parseMatchResponse,
  localFallback,
  applyAiMatch,
  matchCandidates,
  sanitizeProviderQuery,
};
