const { ProactivityEngine } = require('./proactivity/proactivityEngine');

class ProactivityWorker {
  constructor(options = {}) {
    this.repository = options.repository;
    this.eventRepository = options.eventRepository;
    this.reminderRepository = options.reminderRepository || null;
    this.commitmentRepository = options.commitmentRepository || null;
    this.projectionRepository = options.projectionRepository || options.repository;
    this.engine = options.engine || new ProactivityEngine({ ...options, repository: options.proactivityRepository || null });
    this.policyProvider = options.policyProvider || (async () => ({}));
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs) || 60000, 1000), 3600000);
    this.now = options.now || (() => new Date());
    this.logger = options.logger || null;
    this.timer = null;
    this.running = false;
  }

  async evaluateEvent(event, linked = null) {
    if (event.event_type === 'reminder.delivered' && !linked?.commitment && this.reminderRepository && this.commitmentRepository) {
      const reminderId = event.structured_data?.reminderId;
      const reminder = reminderId ? await this.reminderRepository.get({ userId: event.user_id, reminderId }) : null;
      const commitment = reminder?.commitment_id ? await this.commitmentRepository.get({ userId: event.user_id, commitmentId: reminder.commitment_id }) : null;
      const project = commitment?.project_id && this.projectionRepository?.getProject
        ? await this.projectionRepository.getProject({ userId: event.user_id, projectId: commitment.project_id }) : null;
      linked = { ...(linked || {}), commitment, project: linked?.project || project };
    }
    const signal = this.engine.signalFromEvent(event, linked);
    if (!signal) return [];
    return this.engine.evaluate(signal, await this.policyProvider({ userId: event.user_id }));
  }

  async tick() {
    if (this.running) return 0;
    this.running = true;
    let created = 0;
    try {
      await this.repository.expireProposals({ now: this.now() });
      const commitments = await this.repository.listDueCommitmentsForWorker({
        dueBefore: new Date(this.now().getTime() + 86400000), limit: 100,
      });
      for (const commitment of commitments) {
        const event = await this.eventRepository.getForUser({ userId: commitment.user_id, eventId: commitment.source_event_id });
        if (!event) continue;
        const rows = await this.engine.evaluate({ kind: 'commitment', event, commitment }, await this.policyProvider({ userId: commitment.user_id }));
        created += rows.length;
      }
      if (typeof this.repository.listDormantProjectsForWorker === 'function') {
        const inactiveBefore = new Date(this.now().getTime() - 7 * 86400000);
        const projects = await this.repository.listDormantProjectsForWorker({ inactiveBefore, limit: 50 });
        for (const project of projects) {
          const event = { id: project.latest_event_id, user_id: project.user_id,
            event_type: project.latest_event_type, source_channel: project.latest_source_channel,
            source_device_id: project.latest_source_device_id,
            structured_data: project.latest_structured_data || {}, confidence: 1 };
          const inactiveDays = Math.max(7, Math.floor((this.now() - new Date(project.latest_occurred_at || inactiveBefore)) / 86400000));
          const rows = await this.engine.evaluate({ kind: 'project_stalled', event, project, inactiveDays }, await this.policyProvider({ userId: project.user_id }));
          created += rows.length;
        }
      }
      return created;
    } catch (error) {
      if (this.logger) this.logger.warn({ errorCode: 'LIFE_PROACTIVITY_FAILED' }, 'Life OS proactivity tick failed');
      return created;
    } finally { this.running = false; }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { ProactivityWorker };
