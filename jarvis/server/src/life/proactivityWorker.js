class ProactivityWorker {
  constructor(options = {}) {
    this.repository = options.repository;
    this.eventRepository = options.eventRepository;
    this.proposalService = options.proposalService;
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs) || 60000, 1000), 3600000);
    this.now = options.now || (() => new Date());
    this.logger = options.logger || null;
    this.deliverProposal = typeof options.deliverProposal === 'function' ? options.deliverProposal : null;
    this.timer = null;
    this.running = false;
  }

  async evaluateEvent(event, linked = null) {
    if (!this.proposalService) return null;
    const project = linked && linked.project;
    if (event.event_type === 'document.ingested' && project) {
      return this._createFromEvent(event, {
        projectId: project.id, areaId: project.area_id || null,
        title: `Разобрать новый документ для «${project.name}»`,
        explanation: 'Документ только что проиндексирован и связан с активным проектом.',
        cooldownKey: `document:${event.id}:review`, expiresInMs: 3 * 24 * 60 * 60 * 1000,
      });
    }
    if (['workflow.completed', 'workflow.failed', 'workflow.outcome_unknown'].includes(event.event_type)) {
      return this._createFromEvent(event, {
        title: event.event_type === 'workflow.completed' ? 'Проверить результат завершённого действия' : 'Проверить незавершённый результат',
        explanation: `Основание: ${event.summary}`,
        cooldownKey: `workflow:${event.structured_data?.workflowId || event.id}:review`, expiresInMs: 24 * 60 * 60 * 1000,
      });
    }
    return null;
  }

  async _createFromEvent(event, details) {
    const data = event.structured_data || {};
    const originChannel = data.originChannel === 'telegram' || event.source_channel === 'telegram' ? 'telegram' : 'desktop';
    const originConversationId = data.conversationId || null;
    const originDeviceId = originChannel === 'desktop' ? (event.source_device_id || data.deviceId) : null;
    if ((originChannel === 'telegram' && !originConversationId) || (originChannel === 'desktop' && !originDeviceId)) return null;
    const proposal = await this.proposalService.create({
      userId: event.user_id, areaId: details.areaId || null, projectId: details.projectId || null,
      commitmentId: details.commitmentId || null, title: details.title, explanation: details.explanation,
      riskClass: 'safe', actionName: null, actionArguments: {}, originChannel,
      originConversationId, originDeviceId, cooldownKey: details.cooldownKey,
      expiresAt: new Date(this.now().getTime() + details.expiresInMs), evidenceEventIds: [event.id],
    });
    if (proposal && this.deliverProposal) await this.deliverProposal(proposal);
    return proposal;
  }

  async tick() {
    if (this.running) return 0;
    this.running = true;
    let created = 0;
    try {
      await this.repository.expireProposals({ now: this.now() });
      const commitments = await this.repository.listDueCommitmentsForWorker({
        dueBefore: new Date(this.now().getTime() + 24 * 60 * 60 * 1000), limit: 100,
      });
      for (const commitment of commitments) {
        if (!commitment.due_at || new Date(commitment.due_at) > new Date(this.now().getTime() + 24 * 60 * 60 * 1000)) continue;
        const event = await this.eventRepository.getForUser({ userId: commitment.user_id, eventId: commitment.source_event_id });
        if (!event) continue;
        const proposal = await this._createFromEvent(event, {
          areaId: commitment.area_id, projectId: commitment.project_id, commitmentId: commitment.id,
          title: new Date(commitment.due_at) < this.now() ? `Просрочено: ${commitment.title}` : `Скоро срок: ${commitment.title}`,
          explanation: 'Jarvis сохранил это обязательство из вашего сообщения и напоминает о приближающемся сроке.',
          cooldownKey: `commitment:${commitment.id}:${new Date(commitment.due_at).toISOString().slice(0, 10)}`,
          expiresInMs: 24 * 60 * 60 * 1000,
        });
        if (proposal) created += 1;
      }
      if (typeof this.repository.listDormantProjectsForWorker === 'function') {
        const dormant = await this.repository.listDormantProjectsForWorker({
          inactiveBefore: new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000), limit: 50,
        });
        for (const project of dormant) {
          const proposal = await this._createFromEvent({
            id: project.latest_event_id, user_id: project.user_id,
            event_type: project.latest_event_type, summary: project.latest_event_summary,
            source_channel: project.latest_source_channel, source_device_id: project.latest_source_device_id,
            structured_data: project.latest_structured_data || {},
          }, {
            areaId: project.area_id, projectId: project.id,
            title: `Вернуться к проекту «${project.name}»`,
            explanation: 'В активном проекте остался рабочий контекст, но новых значимых событий не было семь дней.',
            cooldownKey: `project:${project.id}:dormant:${new Date(this.now()).toISOString().slice(0, 10)}`,
            expiresInMs: 3 * 24 * 60 * 60 * 1000,
          });
          if (proposal) created += 1;
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
