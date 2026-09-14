const ALLOWED_RISKS = new Set(['safe', 'changing']);

function defineRule(definition) {
  if (!definition || !/^[a-z][a-z0-9_.-]{0,79}$/.test(definition.id || '')) throw new Error('invalid proactivity rule id');
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error('invalid proactivity rule version');
  if (typeof definition.evaluate !== 'function') throw new Error('proactivity rule requires evaluate');
  return Object.freeze({
    minimumConfidence: 0.7, lookbackMs: 24 * 60 * 60 * 1000,
    cooldownMs: 24 * 60 * 60 * 1000, expiresInMs: 24 * 60 * 60 * 1000,
    maxOpen: 1, ...definition,
  });
}

function boundedProposal(rule, value) {
  if (!value) return null;
  if (!ALLOWED_RISKS.has(value.riskClass)) throw new Error('invalid proposal risk');
  if (!String(value.title || '').trim() || !String(value.explanation || '').trim()) throw new Error('proposal copy is required');
  return {
    ...value,
    title: String(value.title).trim().slice(0, 300),
    explanation: String(value.explanation).trim().slice(0, 1000),
    sourceRule: rule.id, sourceRuleVersion: rule.version,
    confidence: Math.min(Math.max(Number(value.confidence) || 0, 0), 1),
    cooldownMs: rule.cooldownMs, expiresInMs: rule.expiresInMs, maxOpen: rule.maxOpen,
  };
}

function originFromSignal(signal) {
  const data = signal.event?.structured_data || {};
  const channel = data.originChannel === 'telegram' || signal.event?.source_channel === 'telegram' ? 'telegram' : 'desktop';
  return {
    originChannel: channel,
    originConversationId: data.conversationId || signal.originConversationId || null,
    originDeviceId: channel === 'desktop' ? signal.event?.source_device_id || data.deviceId || signal.originDeviceId || null : null,
  };
}

module.exports = { boundedProposal, defineRule, originFromSignal };
