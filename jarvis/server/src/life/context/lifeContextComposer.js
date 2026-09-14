const { buildCommunicationGuidance } = require('./communicationGuidance');
const { rankLifeCandidates } = require('./lifeContextRanker');
const { getLifeModePolicy } = require('../modes/lifeModePolicy');

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function timeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('life context deadline exceeded')), milliseconds);
    }),
  ]);
}

function settledValue(result, fallback) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function call(operation) {
  return Promise.resolve().then(operation);
}

class LifeContextComposer {
  constructor(options = {}) {
    this.repository = options.repository;
    this.priorityRepository = options.priorityRepository || null;
    this.modeRepository = options.modeRepository || null;
    this.modeService = options.modeService || null;
    this.preferenceRepository = options.preferenceRepository || null;
    this.deviceRepository = options.deviceRepository || null;
    this.peopleRepository = options.peopleRepository || null;
    this.familyAccessService = options.familyAccessService || null;
    this.enabled = options.enabled !== false;
    this.deadlineMs = Math.min(Math.max(Number(options.deadlineMs) || 150, 25), 1000);
    this.maxItems = Math.min(Math.max(Number(options.maxItems) || 20, 1), 40);
    this.maxCharacters = Math.min(Math.max(Number(options.maxCharacters) || 6000, 256), 12000);
    this.now = options.now || (() => new Date());
  }

  async compose(input = {}) {
    if (!this.enabled) return { status: 'disabled', lifeContext: null, communicationGuidance: null };
    if (!this.repository || !input.userId) return { status: 'unavailable', lifeContext: null, communicationGuidance: null };
    try {
      return await timeout(this._compose(input), this.deadlineMs);
    } catch {
      return { status: 'unavailable', lifeContext: null, communicationGuidance: null };
    }
  }

  async _compose(input) {
    const userId = input.userId;
    const calls = [
      call(() => this.repository.listProjects({ userId, statuses: ['active', 'paused'] })),
      call(() => (typeof this.repository.listCommitments === 'function' ? this.repository.listCommitments({ userId, statuses: ['open'], limit: 30 }) : [])),
      call(() => (typeof this.repository.listProposals === 'function' ? this.repository.listProposals({ userId, statuses: ['open', 'executing', 'outcome_unknown'], limit: 20 }) : [])),
      call(() => (typeof this.repository.listTimeline === 'function' ? this.repository.listTimeline({ userId, limit: 25 }) : [])),
      call(() => (typeof this.repository.listAreas === 'function' ? this.repository.listAreas({ userId }) : [])),
      call(() => (this.priorityRepository ? this.priorityRepository.list({ userId }) : [])),
      call(() => (this.modeService ? this.modeService.get({ userId }) : (this.modeRepository ? this.modeRepository.get({ userId }) : null))),
      call(() => (this.preferenceRepository ? this.preferenceRepository.list({ userId }) : [])),
      call(() => (this.deviceRepository ? this.deviceRepository.listForUser(userId) : [])),
      call(() => (this.peopleRepository ? this.peopleRepository.listPeople({ userId, includeArchived: false, limit: 100 }) : [])),
      call(() => (this.peopleRepository ? this.peopleRepository.listProjectLinks({ userId, projectId: null, personId: null, limit: 100 }) : [])),
      call(() => (this.familyAccessService ? this.familyAccessService.listShared({ memberUserId: userId }) : [])),
    ];
    const results = await Promise.allSettled(calls);
    if (results[0].status === 'rejected') throw new Error('Life project projection unavailable');
    const projects = settledValue(results[0], []);
    const commitments = settledValue(results[1], []);
    const proposals = settledValue(results[2], []);
    const events = settledValue(results[3], []);
    const areas = settledValue(results[4], []);
    const priorities = settledValue(results[5], []);
    const mode = settledValue(results[6], null);
    const preferences = settledValue(results[7], []);
    const devices = settledValue(results[8], []);
    const people = settledValue(results[9], []);
    const personProjectLinks = settledValue(results[10], []);
    const sharedFamily = settledValue(results[11], []);
    const partial = results.some((result) => result.status === 'rejected');
    const priorityByProject = new Map(priorities.map((row) => [row.project_id, row]));
    const now = this.now();
    const selectedProject = projects.find((project) => {
      const state = priorityByProject.get(project.id);
      return project.status === 'active' && state?.pinned
        && (!state.hidden_until || new Date(state.hidden_until) <= now);
    }) || projects.find((project) => project.status === 'active') || null;
    const areaById = new Map(areas.map((area) => [area.id, area]));
    const selectedArea = selectedProject?.area_id ? areaById.get(selectedProject.area_id) || null : null;
    let documents = [];
    let documentsPartial = false;
    if (selectedProject && typeof this.repository.listProjectDocuments === 'function') {
      try {
        documents = await call(() => this.repository.listProjectDocuments({ userId, projectId: selectedProject.id, limit: 8 }));
      } catch {
        documentsPartial = true;
      }
    }
    const candidates = [];
    for (const project of projects.slice(0, 20)) {
      const priority = priorityByProject.get(project.id);
      candidates.push({
        kind: 'project', id: project.id, projectId: project.id, title: project.name,
        summary: project.summary, status: project.status, occurredAt: project.updated_at,
        confidence: Number(priority?.confidence ?? 1), trust: 'user', pinned: priority?.pinned === true,
        areaName: areaById.get(project.area_id)?.name || null,
      });
    }
    for (const commitment of commitments.slice(0, 30)) candidates.push({
      kind: 'commitment', id: commitment.id, projectId: commitment.project_id,
      title: commitment.title, projectName: commitment.project_name,
      areaName: commitment.area_name, dueAt: commitment.due_at,
      status: commitment.status, confidence: commitment.confidence, trust: 'inferred',
    });
    for (const proposal of proposals.slice(0, 20)) candidates.push({
      kind: 'proposal', id: proposal.id, projectId: proposal.project_id,
      title: proposal.title, summary: proposal.explanation, projectName: proposal.project_name,
      dueAt: proposal.expires_at, occurredAt: proposal.created_at,
      status: proposal.status, confidence: proposal.confidence ?? 1, trust: 'trusted',
    });
    for (const event of events.slice(0, 25)) {
      const projectLink = Array.isArray(event.links) ? event.links.find((link) => link.targetType === 'project') : null;
      candidates.push({
        kind: ['workflow.completed', 'workflow.failed', 'workflow.outcome_unknown'].includes(event.event_type) ? 'decision' : 'event',
        id: event.id, projectId: projectLink?.targetId || null, title: event.summary,
        summary: event.summary, occurredAt: event.occurred_at, confidence: event.confidence,
        trust: event.trust_level, privacy: event.privacy_class,
      });
    }
    for (const document of documents.slice(0, 8)) candidates.push({
      kind: 'document', projectId: selectedProject.id, title: document.original_name,
      summary: document.category || 'document', occurredAt: document.updated_at,
      confidence: 1, trust: 'trusted', projectName: selectedProject.name,
    });
    for (const device of devices.slice(0, 20)) candidates.push({
      kind: 'device', title: device.name, summary: device.status,
      status: device.status, occurredAt: device.last_seen_at, confidence: 1, trust: 'trusted',
    });
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const linksByPerson = new Map();
    for (const link of personProjectLinks) {
      if (!linksByPerson.has(link.person_id)) linksByPerson.set(link.person_id, []);
      linksByPerson.get(link.person_id).push(link);
    }
    for (const person of people.slice(0, 30)) {
      const projectLink = (linksByPerson.get(person.id) || []).find((link) => projectById.has(link.project_id));
      candidates.push({
        kind: 'person', id: person.id, projectId: projectLink?.project_id || null,
        title: person.display_name, summary: projectLink ? `Роль в проекте: ${projectLink.role}` : person.relationship_type,
        projectName: projectLink ? projectById.get(projectLink.project_id)?.name : null,
        occurredAt: person.updated_at, confidence: 1, trust: 'user', sourceCategory: 'people',
      });
    }
    for (const shared of sharedFamily.slice(0, 30)) candidates.push({
      kind: shared.resourceType === 'commitment' ? 'commitment' : 'event',
      title: shared.label, summary: shared.summary, dueAt: null,
      confidence: 1, trust: 'trusted', sourceCategory: 'family',
      family: true, authorizedGrant: true,
    });
    const continuationEvent = selectedProject ? events.find((event) => (
      Array.isArray(event.links) && event.links.some((link) => (
        link.targetType === 'project' && link.targetId === selectedProject.id
      ))
    )) : null;
    if (selectedProject && continuationEvent) candidates.push({
      kind: 'continuation', projectId: selectedProject.id, title: selectedProject.name,
      summary: continuationEvent.summary, occurredAt: continuationEvent.occurred_at,
      confidence: continuationEvent.confidence, trust: continuationEvent.trust_level,
    });
    const modePolicy = getLifeModePolicy(mode?.mode);
    const visibleCandidates = candidates.filter((candidate) => {
      if (candidate.kind !== 'proposal') return true;
      if (modePolicy.proposalVisibility === 'all') return true;
      if (modePolicy.proposalVisibility === 'urgent_and_current') return candidate.projectId === selectedProject?.id || candidate.critical === true;
      if (modePolicy.proposalVisibility === 'important') return candidate.critical === true || candidate.confidence >= 0.8;
      return candidate.critical === true;
    });
    const ranked = rankLifeCandidates({
      query: input.text, candidates: visibleCandidates, selectedProjectId: selectedProject?.id, modePolicy,
      now, maxItems: this.maxItems, maxCharacters: this.maxCharacters,
    });
    const hasProject = ranked.items.some((item) => item.kind === 'project' && item.title === selectedProject?.name);
    const recentEventTypes = events.slice(0, 10).map((event) => event.event_type);
    const status = partial || documentsPartial ? 'partial' : 'fresh';
    return {
      status,
      communicationGuidance: buildCommunicationGuidance({ mode, preferences, recentEventTypes }),
      lifeContext: {
        asOf: now.toISOString(),
        currentArea: hasProject && selectedArea ? { name: selectedArea.name, status: selectedArea.status || 'active' } : null,
        currentProject: hasProject && selectedProject ? { name: selectedProject.name, status: selectedProject.status } : null,
        items: ranked.items,
        sourceStatus: status,
      },
    };
  }
}

module.exports = { LifeContextComposer };
