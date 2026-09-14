function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function publicArea(row) {
  return { id: row.id, key: row.area_key || null, name: row.name, status: row.status, sortOrder: row.sort_order, revision: row.revision };
}

function publicProject(row) {
  return {
    id: row.id, areaId: row.area_id || null, name: row.name, summary: row.summary || '', status: row.status,
    targetAt: iso(row.target_at), revision: row.revision, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function publicEvent(row) {
  return {
    id: row.id, type: row.event_type, occurredAt: iso(row.occurred_at), recordedAt: iso(row.recorded_at),
    source: row.source_channel, summary: row.summary, confidence: Number(row.confidence),
    privacy: row.privacy_class, trust: row.trust_level,
    links: Array.isArray(row.links) ? row.links.map((link) => ({
      id: link.id, targetType: link.targetType, targetId: link.targetId,
      relation: link.relationType, origin: link.origin, confidence: Number(link.confidence),
    })) : [],
  };
}

function publicCommitment(row) {
  return {
    id: row.id, sourceEventId: row.source_event_id, areaId: row.area_id || null, projectId: row.project_id || null,
    personId: row.person_id || null, kind: row.kind || 'commitment',
    projectName: row.project_name || null, areaName: row.area_name || null, title: row.title, status: row.status,
    dueAt: iso(row.due_at), dueWindowEndAt: iso(row.due_window_end_at), recurrence: row.recurrence || null,
    confidence: Number(row.confidence), revision: row.revision,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function publicProposal(row) {
  return {
    id: row.id, areaId: row.area_id || null, projectId: row.project_id || null,
    personId: row.person_id || null, reminderId: row.reminder_id || null,
    projectName: row.project_name || null, commitmentId: row.commitment_id || null,
    commitmentTitle: row.commitment_title || null, title: row.title, explanation: row.explanation,
    status: row.status, risk: row.risk_class, action: row.action_name || null,
    sourceRule: row.source_rule || 'core_v1', sourceRuleVersion: row.source_rule_version || 1,
    confidence: Number(row.confidence ?? 1),
    origin: row.origin_channel, expiresAt: iso(row.expires_at), revision: row.revision,
    evidence: Array.isArray(row.evidence) ? row.evidence.slice(0, 32) : [],
  };
}

function lifeError(statusCode, code) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.publicCode = code;
  return error;
}

module.exports = { iso, lifeError, publicArea, publicCommitment, publicEvent, publicProject, publicProposal };
