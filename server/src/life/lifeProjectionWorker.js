const TRUSTED_LINK_FIELDS = Object.freeze({
  areaId: ['area', 'area.context'],
  projectId: ['project', 'project.context'],
  conversationId: ['conversation', 'conversation.source'],
  documentId: ['document', 'document.source'],
  deviceId: ['device', 'device.source'],
  workflowId: ['workflow', 'workflow.source'],
  commitmentId: ['commitment', 'commitment.source'],
  proposalId: ['proposal', 'proposal.source'],
  memoryId: ['memory', 'memory.source'],
});

function processingErrorCode(error) {
  if (error && typeof error.publicCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.publicCode)) {
    return error.publicCode;
  }
  return 'LIFE_PROJECTION_FAILED';
}

class LifeProjectionWorker {
  constructor(options = {}) {
    if (!options.eventRepository || !options.projectionRepository) {
      throw new Error('LifeProjectionWorker requires event and projection repositories');
    }
    this.eventRepository = options.eventRepository;
    this.projectionRepository = options.projectionRepository;
    this.enrich = typeof options.enrich === 'function' ? options.enrich : null;
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs) || 2000, 250), 60000);
    this.batchSize = Math.min(Math.max(Number(options.batchSize) || 20, 1), 100);
    this.logger = options.logger || null;
    this.timer = null;
    this.running = false;
  }

  async processEvent(event, claimToken) {
    try {
      const data = event.structured_data && typeof event.structured_data === 'object' ? event.structured_data : {};
      for (const [field, [targetType, relationType]] of Object.entries(TRUSTED_LINK_FIELDS)) {
        if (!data[field]) continue;
        await this.projectionRepository.createLink({
          userId: event.user_id,
          eventId: event.id,
          targetType,
          targetId: data[field],
          relationType,
          origin: 'trusted',
          confidence: 1,
        });
      }
      if (this.enrich) await this.enrich(event);
      await this.eventRepository.markProcessed({ userId: event.user_id, eventId: event.id, claimToken });
      return true;
    } catch (error) {
      await this.eventRepository.markFailed({
        userId: event.user_id,
        eventId: event.id,
        claimToken,
        errorCode: processingErrorCode(error),
      });
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn({ eventId: event.id, errorCode: processingErrorCode(error) }, 'Life OS projection failed');
      }
      return false;
    }
  }

  async tick() {
    if (this.running) return 0;
    this.running = true;
    try {
      const claim = await this.eventRepository.claimPending({ limit: this.batchSize });
      for (const event of claim.events) await this.processEvent(event, claim.claimToken);
      return claim.events.length;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn({ errorCode: processingErrorCode(error) }, 'Life OS worker tick failed');
        }
      });
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { LifeProjectionWorker, TRUSTED_LINK_FIELDS, processingErrorCode };
