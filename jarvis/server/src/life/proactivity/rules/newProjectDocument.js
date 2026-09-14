const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'project.document_added', version: 1, inputKinds: ['project_document'], expiresInMs: 3 * 86400000, evaluate(signal) {
  if (!signal.project?.id || signal.project.status && signal.project.status !== 'active') return null;
  return { title: `Показать новые материалы «${signal.project.name}»`, explanation: 'Новый документ связан с активным проектом.', confidence: 0.96,
    riskClass: 'safe', actionName: 'project.show_documents', actionArguments: signal.actions?.showDocuments || {}, projectId: signal.project.id, areaId: signal.project.area_id || null };
} });
