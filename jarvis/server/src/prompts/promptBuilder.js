const { PERSONA_POLICY_ID, PERSONA_POLICY_TEXT } = require('./personaPolicy');

const ALLOWED_HISTORY_ROLES = new Set(['user', 'assistant']);

function normalizeHistory(history, limit = 30) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => message && ALLOWED_HISTORY_ROLES.has(message.role) && typeof message.content === 'string')
    .slice(-limit)
    .map((message) => ({ role: message.role, content: message.content }));
}

function buildRuntimePolicy(runtimeContext = {}) {
  const channel = String(runtimeContext.channel || 'unknown').slice(0, 50);
  const tools = Array.isArray(runtimeContext.toolsAvailable)
    ? runtimeContext.toolsAvailable.map(String).slice(0, 50)
    : [];
  const verifiedResults = Array.isArray(runtimeContext.verifiedToolResults)
    ? runtimeContext.verifiedToolResults.slice(0, 20)
    : [];

  return {
    channel,
    toolsAvailable: tools,
    hasVerifiedToolResults: verifiedResults.length > 0,
    instruction: tools.length === 0
      ? 'В этом запросе инструменты недоступны: можно только ответить текстом и нельзя заявлять о выполнении действий.'
      : 'Разрешены только перечисленные инструменты; успех действия подтверждается только фактическим результатом инструмента.',
  };
}

function buildCanonicalPrompt(input) {
  const currentRequest = String(input.currentRequest || '').trim();
  if (!currentRequest) throw new Error('currentRequest is required');
  return Object.freeze({
    policy: Object.freeze({ id: PERSONA_POLICY_ID, text: PERSONA_POLICY_TEXT }),
    runtime: Object.freeze(buildRuntimePolicy(input.runtimeContext)),
    history: Object.freeze(normalizeHistory(input.history)),
    currentRequest,
  });
}

module.exports = {
  ALLOWED_HISTORY_ROLES,
  buildCanonicalPrompt,
  buildRuntimePolicy,
  normalizeHistory,
};
