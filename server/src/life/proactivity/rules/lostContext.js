const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'context.lost', version: 1, inputKinds: ['context_lost'], evaluate(signal) {
  if (!signal.project?.id || !signal.hasContinuation || signal.deviceAvailable === false) return null;
  return { title: `Восстановить контекст «${signal.project.name}»`, explanation: 'Есть сохранённая точка продолжения, но рабочая сессия прервана.', confidence: 0.9,
    riskClass: 'changing', actionName: 'workspace.prepare', actionArguments: signal.actions?.prepareWorkspace || {}, projectId: signal.project.id, areaId: signal.project.area_id || null };
} });
