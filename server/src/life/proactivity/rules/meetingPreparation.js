const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'meeting.prepare', version: 1, inputKinds: ['meeting'], cooldownMs: 6 * 3600000, evaluate(signal) {
  const remaining = new Date(signal.meeting?.startsAt) - signal.now;
  if (!(signal.meeting && remaining >= 0 && remaining <= 2 * 3600000)) return null;
  return { title: `Подготовиться к встрече: ${signal.meeting.title}`, explanation: 'Встреча начинается в ближайшие два часа; доступны связанные материалы.', confidence: 0.93,
    riskClass: 'changing', actionName: 'workspace.prepare', actionArguments: signal.actions?.prepareWorkspace || {}, projectId: signal.project?.id || null, personId: signal.person?.id || null };
} });
