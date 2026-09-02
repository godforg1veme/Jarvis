const { PERSONA_POLICY_ID, PERSONA_POLICY_TEXT } = require('./personaPolicy');
const { hasProviderIdentity } = require('../assistant/outputPolicyValidator');
const { normalizeDevicePromptContext } = require('../devices/devicePromptContext');

const ALLOWED_HISTORY_ROLES = new Set(['user', 'assistant']);

function normalizeHistory(history, limit = 30) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => message && ALLOWED_HISTORY_ROLES.has(message.role) && typeof message.content === 'string')
    .filter((message) => message.role !== 'assistant' || !hasProviderIdentity(message.content))
    .slice(-limit)
    .map((message) => ({ role: message.role, content: message.content }));
}

function normalizeMemories(memories, limit = 30) {
  if (!Array.isArray(memories)) return [];
  return memories
    .filter((memory) => memory && typeof memory.content === 'string')
    .slice(0, limit)
    .map((memory) => ({
      kind: String(memory.kind || 'fact').slice(0, 30),
      content: memory.content.trim().slice(0, 1000),
    }))
    .filter((memory) => memory.content);
}

function normalizeDocuments(documents, limit = 8) {
  if (!Array.isArray(documents)) return [];
  return documents
    .filter((document) => document && typeof document.content === 'string')
    .slice(0, limit)
    .map((document, index) => ({
      source: /^S[1-9][0-9]*$/.test(String(document.source || '')) ? String(document.source) : `S${index + 1}`,
      originalName: String(document.originalName || 'Документ').replace(/[\r\n]/g, ' ').slice(0, 255),
      mediaType: String(document.mediaType || '').slice(0, 100),
      category: String(document.category || 'document').slice(0, 30),
      content: document.content.trim().slice(0, 6000),
      metadata: document.metadata && typeof document.metadata === 'object' ? document.metadata : {},
    }))
    .filter((document) => document.content);
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
    hasVerifiedDevices: runtimeContext.hasVerifiedDevices === true,
    instruction: tools.length === 0
      ? 'В этом запросе инструменты недоступны: можно только ответить текстом и нельзя заявлять о выполнении действий.'
      : 'Разрешены только перечисленные инструменты; успех действия подтверждается только фактическим результатом инструмента.',
  };
}

function buildCanonicalPrompt(input) {
  const currentRequest = String(input.currentRequest || '').trim();
  if (!currentRequest) throw new Error('currentRequest is required');
  const devices = normalizeDevicePromptContext(input.devices);
  return Object.freeze({
    policy: Object.freeze({ id: PERSONA_POLICY_ID, text: PERSONA_POLICY_TEXT }),
    runtime: Object.freeze(buildRuntimePolicy({ ...input.runtimeContext, hasVerifiedDevices: devices.length > 0 })),
    history: Object.freeze(normalizeHistory(input.history)),
    memories: Object.freeze(normalizeMemories(input.memories)),
    documents: Object.freeze(normalizeDocuments(input.documents)),
    devices: Object.freeze(devices),
    currentRequest,
  });
}

module.exports = {
  ALLOWED_HISTORY_ROLES,
  buildCanonicalPrompt,
  buildRuntimePolicy,
  normalizeDevicePromptContext,
  normalizeDocuments,
  normalizeMemories,
  normalizeHistory,
};
