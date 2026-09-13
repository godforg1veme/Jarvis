const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function normalized(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

class LifeLinker {
  constructor(options = {}) {
    this.repository = options.repository;
    this.classify = typeof options.classify === 'function' ? options.classify : null;
  }

  async link(event) {
    if (!this.repository || !['message.received', 'voice.transcribed', 'document.ingested', 'vision.observed'].includes(event.event_type)) return null;
    const projects = await this.repository.listProjects({ userId: event.user_id, statuses: ['active', 'paused'] });
    const summary = normalized(event.summary);
    const exact = projects
      .filter((project) => normalized(project.name) && summary.includes(normalized(project.name)))
      .sort((a, b) => normalized(b.name).length - normalized(a.name).length)[0];
    if (exact) return this._persist(event, exact, 'trusted', 1);
    if (!this.classify || projects.length === 0) return null;

    let candidate = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        candidate = await this.classify({
          summary: String(event.summary || '').slice(0, 1000),
          projects: projects.slice(0, 50).map(({ id, name, summary: description }) => ({ id, name, description: String(description || '').slice(0, 500) })),
          corrective: attempt === 1,
        });
        if (candidate && UUID.test(String(candidate.projectId || '')) && Number(candidate.confidence) >= 0.6) break;
        candidate = null;
      } catch (_) {
        candidate = null;
      }
    }
    const project = candidate && projects.find((item) => item.id === candidate.projectId);
    return project ? this._persist(event, project, 'inferred', Math.min(Number(candidate.confidence), 0.95)) : null;
  }

  async _persist(event, project, origin, confidence) {
    const link = await this.repository.createLink({
      userId: event.user_id,
      eventId: event.id,
      targetType: 'project',
      targetId: project.id,
      relationType: 'project.context',
      origin,
      confidence,
    });
    if (link && project.area_id) {
      await this.repository.createLink({
        userId: event.user_id,
        eventId: event.id,
        targetType: 'area',
        targetId: project.area_id,
        relationType: 'area.context',
        origin,
        confidence,
      });
    }
    return { link, project };
  }
}

module.exports = { LifeLinker, normalized };
