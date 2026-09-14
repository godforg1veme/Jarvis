const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'task.repeatedly_forgotten', version: 1, inputKinds: ['forgotten_task'], cooldownMs: 7 * 86400000, evaluate(signal) {
  if (!signal.taskTitle || Number(signal.missedCount) < 3) return null;
  return { title: `Зафиксировать задачу: ${signal.taskTitle}`, explanation: `Задача пропущена ${signal.missedCount} раза; можно выделить её отдельно.`, confidence: 0.9,
    riskClass: 'changing', actionName: 'life.task.create', actionArguments: signal.actions?.createTask || {}, projectId: signal.project?.id || null };
} });
