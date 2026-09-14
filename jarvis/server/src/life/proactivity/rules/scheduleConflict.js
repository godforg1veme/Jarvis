const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'schedule.conflict', version: 1, inputKinds: ['schedule_conflict'], evaluate(signal) {
  if (!signal.commitment?.id || !signal.conflictEvidence) return null;
  return { title: `Уточнить время: ${signal.commitment.title}`, explanation: 'В расписании найдено подтверждённое пересечение времени.', confidence: signal.confidence || 0.9,
    riskClass: 'changing', actionName: 'life.commitment.reschedule', actionArguments: signal.actions?.rescheduleCommitment || {}, commitmentId: signal.commitment.id, projectId: signal.commitment.project_id || null };
} });
