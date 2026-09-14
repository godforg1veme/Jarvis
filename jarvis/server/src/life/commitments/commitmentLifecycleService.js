const { normalizeCommitmentText } = require('./textNormalizer');

function titleTokens(value) {
  return new Set(normalizeCommitmentText(value).toLocaleLowerCase('ru-RU').split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 4));
}

function overlap(left, right) {
  const a = titleTokens(left); const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.min(a.size, b.size);
}

class CommitmentLifecycleService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway || null;
  }

  async apply({ userId, event, detected, linked = null }) {
    if (!detected || detected.action === 'create') return null;
    const explicitId = event.structured_data?.commitmentId
      || (event.links || []).find((link) => link.targetType === 'commitment')?.targetId || null;
    let commitment = explicitId ? await this.repository.get({ userId, commitmentId: explicitId }) : null;
    if (explicitId && !commitment) return { status: 'needs_clarification', commitment: null };
    if (!commitment) {
      const candidates = await this.repository.listRecent({
        userId, projectId: linked?.project?.id || null, personId: linked?.person?.id || null, limit: 30,
      });
      const ranked = candidates.map((candidate) => ({ candidate, score: overlap(event.summary, candidate.title) }))
        .filter((item) => item.score >= 0.4).sort((a, b) => b.score - a.score || String(a.candidate.id).localeCompare(String(b.candidate.id)));
      if (ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score)) commitment = ranked[0].candidate;
    }
    if (!commitment) return { status: 'needs_clarification', commitment: null };
    if (detected.action === 'reschedule' && !detected.dueAt) {
      return { status: 'needs_clarification', commitment: null };
    }
    const status = detected.action === 'complete' ? 'completed' : detected.action === 'cancel' ? 'dismissed' : 'open';
    const updated = await this.repository.transition({
      userId, commitmentId: commitment.id, revision: commitment.revision, status,
      dueAt: ['reschedule', 'correct'].includes(detected.action) ? detected.dueAt : null,
      dueWindowEndAt: ['reschedule', 'correct'].includes(detected.action) ? detected.dueWindowEndAt : null,
      recurrence: detected.action === 'correct' ? detected.recurrence : null,
      title: detected.action === 'correct' ? detected.title : null,
    });
    if (!updated) return { status: 'conflict', commitment: null };
    if (this.gateway) await this.gateway.record({
      userId, eventType: status === 'completed' ? 'commitment.completed' : 'commitment.updated',
      occurredAt: event.occurred_at || new Date(), sourceChannel: 'life_os',
      sourceRef: `commitment:${updated.id}:revision:${updated.revision}`,
      deduplicationKey: `commitment:${updated.id}:revision:${updated.revision}`,
      summary: status === 'completed' ? 'Обязательство выполнено' : 'Обязательство обновлено',
      structuredData: { commitmentId: updated.id, sourceEventId: event.id, action: detected.action },
      trustLevel: 'user', privacyClass: 'personal', correlationId: event.correlation_id || event.id,
    });
    return { status: 'updated', commitment: updated };
  }

  async completeFromVerifiedAction({ userId, commitmentId, revision, workflowId }) {
    if (!workflowId) return null;
    if (!await this.repository.isWorkflowLinked({ userId, commitmentId, workflowId })) return null;
    return this.repository.transition({ userId, commitmentId, revision, status: 'completed' });
  }
}

module.exports = { CommitmentLifecycleService, overlap };
