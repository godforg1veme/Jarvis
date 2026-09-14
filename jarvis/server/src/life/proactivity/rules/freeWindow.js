const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'schedule.free_window', version: 1, inputKinds: ['free_window'], cooldownMs: 12 * 3600000, evaluate(signal) {
  if (!signal.window || signal.window.durationMinutes < 30 || !signal.commitment?.id) return null;
  return { title: `Запланировать: ${signal.commitment.title}`, explanation: `В расписании есть свободное окно на ${signal.window.durationMinutes} минут.`, confidence: signal.confidence || 0.82,
    riskClass: 'changing', actionName: 'reminder.create', actionArguments: signal.actions?.createReminder || {}, commitmentId: signal.commitment.id, projectId: signal.commitment.project_id || null };
} });
