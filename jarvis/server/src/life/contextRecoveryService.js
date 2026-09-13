const { publicCommitment, publicEvent, publicProject, publicProposal } = require('./lifePublic');

class ContextRecoveryService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.deviceRepository = options.deviceRepository || null;
  }

  async recover({ userId, projectId }) {
    const project = await this.repository.getProject({ userId, projectId });
    if (!project) return null;
    const [events, commitments, proposals, documents, devices] = await Promise.all([
      this.repository.listTimeline({ userId, projectId, limit: 25 }),
      this.repository.listCommitments({ userId, projectId, statuses: ['open'], limit: 20 }),
      this.repository.listProposals({ userId, projectId, statuses: ['open', 'executing', 'outcome_unknown'], limit: 10 }),
      typeof this.repository.listProjectDocuments === 'function' ? this.repository.listProjectDocuments({ userId, projectId, limit: 20 }) : [],
      this.deviceRepository ? this.deviceRepository.listForUser(userId) : [],
    ]);
    const publicEvents = events.map(publicEvent);
    return {
      project: publicProject(project),
      verifiedFacts: publicEvents.filter((event) => event.trust === 'trusted').slice(0, 12),
      userContext: publicEvents.filter((event) => event.trust === 'user').slice(0, 8),
      inferredLinks: publicEvents.filter((event) => event.trust === 'inferred' || event.links.some((link) => link.origin === 'inferred')).slice(0, 8),
      commitments: commitments.map(publicCommitment),
      proposals: proposals.map(publicProposal),
      documents: documents.map((document) => ({ id: document.id, name: document.original_name, mediaType: document.media_type,
        category: document.category, status: document.status, updatedAt: document.updated_at ? new Date(document.updated_at).toISOString() : null })),
      devices: devices.slice(0, 20).map((device) => ({ id: device.id, name: device.name, status: device.status, lastSeenAt: device.last_seen_at || null })),
      continuation: publicEvents[0] ? { eventId: publicEvents[0].id, summary: publicEvents[0].summary, occurredAt: publicEvents[0].occurredAt } : null,
      suggestedNextSteps: proposals.slice(0, 3).map((proposal) => ({ proposalId: proposal.id, title: proposal.title, explanation: proposal.explanation })),
    };
  }
}

module.exports = { ContextRecoveryService };
