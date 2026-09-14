const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'project.stalled', version: 1, inputKinds: ['project_stalled'], cooldownMs: 7 * 86400000, expiresInMs: 3 * 86400000, evaluate(signal) {
  if (!signal.project || signal.project.status !== 'active' || !signal.inactiveDays || signal.inactiveDays < 7) return null;
  return { title: `Вернуться к проекту «${signal.project.name}»`, explanation: `В активном проекте нет значимых событий ${signal.inactiveDays} дней.`, confidence: 0.88,
    riskClass: 'changing', actionName: 'workspace.prepare', actionArguments: signal.actions?.prepareWorkspace || {}, projectId: signal.project.id, areaId: signal.project.area_id || null };
} });
