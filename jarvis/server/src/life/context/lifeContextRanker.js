const DEFAULT_CATEGORY_CAPS = Object.freeze({
  project: 2,
  commitment: 5,
  proposal: 3,
  event: 5,
  decision: 3,
  document: 3,
  device: 3,
  continuation: 1,
  person: 3,
});

const CONTINUATION_PATTERN = /\b(?:continue|resume|return|work)\b|продолж|верн|возобнов|поработ/iu;
const PLANNING_PATTERN = /\b(?:plan|project|task|deadline|next)\b|план|проект|задач|срок|что\s+дальше/iu;
const STOP_WORDS = new Set([
  'как', 'что', 'где', 'когда', 'чтобы', 'можно', 'мне', 'мой', 'моя', 'мои', 'про',
  'the', 'how', 'what', 'where', 'when', 'with', 'from', 'this', 'that', 'about',
]);

function tokens(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function finiteDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function overlapScore(queryTokens, candidate) {
  if (!queryTokens.length) return 0;
  const searchable = new Set(tokens([
    candidate.title, candidate.summary, candidate.projectName, candidate.areaName,
  ].filter(Boolean).join(' ')));
  const matches = queryTokens.filter((token) => searchable.has(token)).length;
  return matches / queryTokens.length;
}

function urgencyScore(candidate, now) {
  const due = finiteDate(candidate.dueAt);
  if (!due) return 0;
  const hours = (due.getTime() - now.getTime()) / 3600000;
  if (hours < 0) return 0.5;
  if (hours <= 36) return 0.45;
  if (hours <= 72) return 0.28;
  if (hours <= 168) return 0.12;
  return 0;
}

function recencyScore(candidate, now) {
  const occurred = finiteDate(candidate.occurredAt);
  if (!occurred) return 0;
  const hours = Math.max(0, (now.getTime() - occurred.getTime()) / 3600000);
  if (hours <= 24) return 0.15;
  if (hours <= 168) return 0.1;
  if (hours <= 720) return 0.04;
  return 0;
}

function publicCandidate(candidate) {
  const item = {
    kind: String(candidate.kind || 'event').slice(0, 40),
    title: String(candidate.title || '').trim().slice(0, 300),
    summary: String(candidate.summary || '').trim().slice(0, 1000),
    projectName: String(candidate.projectName || '').trim().slice(0, 160) || null,
    areaName: String(candidate.areaName || '').trim().slice(0, 100) || null,
    occurredAt: finiteDate(candidate.occurredAt)?.toISOString() || null,
    dueAt: finiteDate(candidate.dueAt)?.toISOString() || null,
    status: String(candidate.status || '').slice(0, 40) || null,
    confidence: Math.min(Math.max(Number(candidate.confidence) || 0, 0), 1),
    trust: ['trusted', 'user', 'inferred'].includes(candidate.trust) ? candidate.trust : 'inferred',
  };
  if (!item.title) delete item.title;
  if (!item.summary) delete item.summary;
  return item;
}

function rankLifeCandidates(options = {}) {
  const now = finiteDate(options.now) || new Date();
  const query = String(options.query || '').slice(0, 10000);
  const queryTokens = tokens(query);
  const continuationIntent = CONTINUATION_PATTERN.test(query);
  const planningIntent = PLANNING_PATTERN.test(query);
  const selectedProjectId = options.selectedProjectId || null;
  const candidates = Array.isArray(options.candidates) ? options.candidates.slice(0, 200) : [];
  const modePolicy = options.modePolicy && typeof options.modePolicy === 'object' ? options.modePolicy : null;
  const allowedSources = modePolicy?.allowedSourceCategories ? new Set(modePolicy.allowedSourceCategories) : null;
  const categoryWeights = modePolicy?.categoryWeights || {};
  const scored = [];

  for (let position = 0; position < candidates.length; position += 1) {
    const candidate = candidates[position];
    if (!candidate || typeof candidate !== 'object' || candidate.privacy === 'sensitive') continue;
    if (candidate.family === true && candidate.authorizedGrant !== true) continue;
    if (allowedSources && candidate.sourceCategory && !allowedSources.has(candidate.sourceCategory)) continue;
    const overlap = overlapScore(queryTokens, candidate);
    const urgency = urgencyScore(candidate, now);
    const selected = Boolean(selectedProjectId && candidate.projectId === selectedProjectId);
    const pinned = candidate.pinned === true;
    const eligible = overlap > 0
      || urgency >= 0.45
      || ((continuationIntent || planningIntent) && (selected || pinned))
      || candidate.critical === true;
    if (!eligible) continue;
    const confidence = Math.min(Math.max(Number(candidate.confidence) || 0, 0), 1);
    const trust = candidate.trust === 'user' || candidate.trust === 'trusted' ? 0.05 : 0;
    const baseScore = (overlap * 0.6) + urgency + recencyScore(candidate, now)
      + (confidence * 0.1) + trust + (selected ? 0.2 : 0) + (pinned ? 0.5 : 0)
      + (candidate.critical === true ? 1 : 0);
    const categoryWeight = Math.min(Math.max(Number(categoryWeights[candidate.kind]) || 1, 0.25), 2);
    const score = baseScore * categoryWeight;
    scored.push({ candidate, score, position });
  }

  scored.sort((left, right) => right.score - left.score
    || String(left.candidate.kind).localeCompare(String(right.candidate.kind))
    || String(left.candidate.title || '').localeCompare(String(right.candidate.title || ''))
    || left.position - right.position);

  const maxItems = Math.min(Math.max(Number(options.maxItems) || 20, 1), 40);
  const maxCharacters = Math.min(Math.max(Number(options.maxCharacters) || 6000, 256), 12000);
  const caps = { ...DEFAULT_CATEGORY_CAPS, ...(options.categoryCaps || {}) };
  const counts = new Map();
  const items = [];
  let totalCharacters = 0;
  for (const entry of scored) {
    if (items.length >= maxItems) break;
    const kind = String(entry.candidate.kind || 'event');
    const count = counts.get(kind) || 0;
    if (count >= Math.min(Math.max(Number(caps[kind]) || 1, 1), 10)) continue;
    const item = publicCandidate(entry.candidate);
    const size = JSON.stringify(item).length;
    if (totalCharacters + size > maxCharacters) continue;
    items.push(item);
    totalCharacters += size;
    counts.set(kind, count + 1);
  }
  return { items, totalCharacters };
}

module.exports = { DEFAULT_CATEGORY_CAPS, rankLifeCandidates, tokens };
