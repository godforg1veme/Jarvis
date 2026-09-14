const {
  publicArea, publicCommitment, publicEvent, publicMode, publicProject, publicProposal,
} = require('./lifePublic');

function publicPriority(entry, selectionReason = null) {
  if (!entry) return null;
  return {
    ...publicProject(entry.project), score: entry.score, confidence: entry.confidence,
    pinned: entry.pinned === true, reasons: (entry.factors || []).slice(0, 8), selectionReason,
  };
}

class MissionControlService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.deviceRepository = options.deviceRepository || null;
    this.priorityRepository = options.priorityRepository || null;
    this.priorityEngine = options.priorityEngine || null;
    this.modeService = options.modeService || null;
    this.preferenceRepository = options.preferenceRepository || null;
    this.reminderRepository = options.reminderRepository || null;
    this.recoveryRepository = options.recoveryRepository || null;
    this.sourceRepository = options.sourceRepository || null;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  async get({ userId }) {
    await this.repository.ensureDefaultAreas({ userId });
    const attempts = await Promise.allSettled([
      this.repository.listAreas({ userId }),
      this.repository.listProjects({ userId, limit: 200 }),
      this.repository.listCommitments({ userId, statuses: ['open'], limit: 30 }),
      this.repository.listProposals({ userId, statuses: ['open', 'executing', 'outcome_unknown'], limit: 20 }),
      this.repository.listTimeline({ userId, limit: 30 }),
      this.deviceRepository ? this.deviceRepository.listForUser(userId) : [],
      this.priorityRepository ? this.priorityRepository.list({ userId }) : [],
      this.modeService ? this.modeService.get({ userId }) : null,
      this.preferenceRepository ? this.preferenceRepository.list({ userId }) : [],
      this.reminderRepository ? this.reminderRepository.list({ userId, limit: 30 }) : [],
      this.recoveryRepository ? this.recoveryRepository.list({ userId, limit: 20 }) : [],
      this.sourceRepository ? this.sourceRepository.list({ userId }) : [],
    ]);
    const value = (index, fallback) => attempts[index].status === 'fulfilled' ? attempts[index].value : fallback;
    const areas = value(0, []);
    const projects = value(1, []);
    const commitments = value(2, []);
    const proposals = value(3, []);
    const events = value(4, []);
    const devices = value(5, []);
    const states = value(6, []);
    const mode = value(7, null);
    const preferences = value(8, []);
    const reminders = value(9, []);
    const recoveryPlans = value(10, []);
    const sources = value(11, []);
    const partial = attempts.some((attempt) => attempt.status === 'rejected');
    let priority = null;
    if (this.priorityEngine) {
      try {
        priority = await this.priorityEngine.evaluate({
          userId, projects, areas, commitments, events, states, mode, preferences,
          resourceAvailable: devices.length ? devices.some((device) => device.status === 'online') : null,
        });
      } catch (_) {
        priority = null;
      }
    }
    if (!priority) {
      const fallback = this.priorityEngine && typeof this.priorityEngine.fallback === 'function'
        ? this.priorityEngine.fallback({ projects, states, now: this.now() })
        : this._fallback({ projects, states });
      priority = {
        selected: fallback.selected ? { project: fallback.selected, score: null, confidence: 0, factors: [], pinned: fallback.selectionReason === 'fallback_user_pin' } : null,
        ranked: [], selectionReason: fallback.selectionReason, asOf: this.now().toISOString(),
      };
    }
    const selectedProjectId = priority.selected?.project?.id || null;
    const nextCommitment = commitments.find((item) => item.project_id === selectedProjectId) || commitments[0] || null;
    const nextProposal = proposals.find((item) => item.project_id === selectedProjectId) || null;
    const asOf = priority.asOf || this.now().toISOString();
    return {
      asOf, generatedAt: asOf, status: partial ? 'partial' : 'fresh',
      currentMission: publicPriority(priority.selected, priority.selectionReason),
      rankedProjects: priority.ranked.map((entry) => publicPriority(entry)),
      areas: areas.map(publicArea), projects: projects.map(publicProject),
      commitments: commitments.map(publicCommitment),
      reminders: reminders.map((row) => ({ id: row.id, title: row.title, state: row.state, triggerAt: row.trigger_at ? new Date(row.trigger_at).toISOString() : null, revision: row.revision })),
      proposals: proposals.map(publicProposal), recentEvents: events.slice(0, 15).map(publicEvent),
      failures: events.filter((event) => ['workflow.failed', 'workflow.outcome_unknown'].includes(event.event_type)).slice(0, 10).map(publicEvent),
      devices: devices.slice(0, 20).map((device) => ({ id: device.id, name: device.name, status: device.status, lastSeenAt: device.last_seen_at || null })),
      nextStep: nextCommitment ? { kind: 'commitment', title: nextCommitment.title }
        : nextProposal ? { kind: 'proposal', title: nextProposal.title } : null,
      recovery: recoveryPlans.slice(0, 10).map((plan) => ({ id: plan.id, projectId: plan.project_id, summary: plan.summary, status: plan.status, revision: plan.revision })),
      mode: publicMode(mode),
      sources: sources.map((source) => ({ id: source.id, type: source.adapter_type, name: source.display_name, enabled: source.enabled, health: source.health_status, lastSyncAt: source.last_successful_sync_at || null })),
      privacy: { familyAccess: 'explicit_grants_only', localPathsExposed: false },
    };
  }

  _fallback({ projects, states }) {
    const now = this.now();
    const byProject = new Map(states.map((state) => [state.project_id, state]));
    const eligible = projects.filter((project) => project.status === 'active'
      && !(byProject.get(project.id)?.hidden_until && new Date(byProject.get(project.id).hidden_until) > now));
    const pinned = eligible.find((project) => byProject.get(project.id)?.pinned);
    const selected = pinned || eligible.sort((left, right) => new Date(right.updated_at || 0) - new Date(left.updated_at || 0))[0] || null;
    return { selected, selectionReason: pinned ? 'fallback_user_pin' : selected ? 'fallback_recent_activity' : 'no_eligible_project' };
  }

  pin(input) { return this._setIntent({ ...input, pinned: true, hiddenUntil: null, eventType: 'mission.pinned' }); }

  replace(input) { return this.pin(input); }

  hide(input) { return this._setIntent({ ...input, pinned: false, eventType: 'mission.hidden' }); }

  restore(input) { return this._setIntent({ ...input, pinned: false, hiddenUntil: null, eventType: 'mission.restored' }); }

  async _setIntent({ userId, projectId, revision = null, pinned, hiddenUntil, eventType, sourceDeviceId = null }) {
    const states = await this.priorityRepository.list({ userId });
    const current = states.find((state) => state.project_id === projectId) || null;
    if (current && revision == null) return null;
    const row = await this.priorityRepository.setIntent({
      userId, projectId, revision, pinned, hiddenUntil, userWeight: Number(current?.user_weight || 0),
    });
    if (row && this.gateway) await this.gateway.record({
      userId, eventType, occurredAt: this.now(), sourceChannel: 'life_os',
      sourceRef: `${eventType}:${row.project_id}:revision:${row.revision}`, sourceDeviceId,
      deduplicationKey: `${eventType}:${row.project_id}:revision:${row.revision}`,
      summary: pinned ? 'Миссия закреплена пользователем' : hiddenUntil ? 'Миссия временно скрыта' : 'Миссия восстановлена',
      structuredData: { projectId: row.project_id, revision: row.revision },
      trustLevel: 'user', privacyClass: 'personal',
    });
    return row;
  }
}

module.exports = { MissionControlService, publicPriority };
