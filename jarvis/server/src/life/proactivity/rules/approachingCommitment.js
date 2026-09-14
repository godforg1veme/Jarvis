const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'commitment.approaching', version: 1, inputKinds: ['commitment'], evaluate(signal) {
  const remaining = new Date(signal.commitment?.due_at) - signal.now;
  if (!(remaining >= 0 && remaining <= 24 * 60 * 60 * 1000)) return null;
  return { title: `Подготовиться: ${signal.commitment.title}`, explanation: 'Срок договорённости наступит в ближайшие сутки.', confidence: 0.95,
    riskClass: 'changing', actionName: 'reminder.create', actionArguments: signal.actions?.createReminder || {}, commitmentId: signal.commitment.id,
    projectId: signal.commitment.project_id || null, areaId: signal.commitment.area_id || null };
} });
