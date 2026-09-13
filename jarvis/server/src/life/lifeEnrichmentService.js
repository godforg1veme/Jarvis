const { recordSimpleEvent } = require('./lifeSourceEvents');

class LifeEnrichmentService {
  constructor(options = {}) {
    this.linker = options.linker;
    this.commitmentDetector = options.commitmentDetector;
    this.repository = options.repository;
    this.gateway = options.gateway;
  }

  async enrich(event) {
    const linked = this.linker ? await this.linker.link(event) : null;
    const detected = this.commitmentDetector ? await this.commitmentDetector.detect(event) : null;
    if (!detected || !this.repository) return { linked, commitment: null };
    const commitment = await this.repository.createCommitment({
      userId: event.user_id,
      sourceEventId: event.id,
      areaId: linked?.project?.area_id || null,
      projectId: linked?.project?.id || null,
      title: detected.title,
      dueAt: detected.dueAt,
      confidence: detected.confidence,
    });
    if (commitment) {
      await recordSimpleEvent(this.gateway, {
        userId: event.user_id,
        eventType: 'commitment.detected',
        sourceChannel: 'life_os',
        sourceRef: `commitment:${commitment.id}`,
        deduplicationKey: `commitment-detected:${commitment.id}`,
        summary: `Зафиксировано обязательство: ${commitment.title}`,
        structuredData: {
          commitmentId: commitment.id,
          ...(commitment.project_id ? { projectId: commitment.project_id } : {}),
          ...(commitment.area_id ? { areaId: commitment.area_id } : {}),
          sourceEventId: event.id,
        },
        confidence: commitment.confidence,
        trustLevel: 'inferred',
        correlationId: event.correlation_id || event.id,
      });
    }
    return { linked, commitment };
  }
}

module.exports = { LifeEnrichmentService };
