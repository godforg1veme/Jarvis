const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'workflow.needs_attention', version: 1, inputKinds: ['workflow_issue'], evaluate(signal) {
  if (!['failed', 'outcome_unknown'].includes(signal.workflowStatus)) return null;
  return { title: 'Разобрать незавершённое действие', explanation: signal.workflowStatus === 'outcome_unknown' ? 'Результат действия неизвестен; повторный запуск исключён до проверки.' : 'Действие завершилось ошибкой и требует решения.', confidence: 1,
    riskClass: 'changing', actionName: 'workflow.continue', actionArguments: signal.actions?.continueWorkflow || {} };
} });
