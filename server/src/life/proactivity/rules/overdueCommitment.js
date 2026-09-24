const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'commitment.overdue', version: 1, inputKinds: ['commitment'], cooldownMs: 12 * 60 * 60 * 1000, evaluate(signal) {
  if (!(signal.commitment?.due_at && new Date(signal.commitment.due_at) < signal.now)) return null;
  return { title: `Перенести срок: ${signal.commitment.title}`, explanation: 'Срок договорённости прошёл, а она остаётся открытой.', confidence: 0.98,
    riskClass: 'changing', actionName: 'life.commitment.reschedule', actionArguments: signal.actions?.rescheduleCommitment || {}, commitmentId: signal.commitment.id,
    projectId: signal.commitment.project_id || null, areaId: signal.commitment.area_id || null };
} });
