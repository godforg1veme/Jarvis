const { recordSimpleEvent } = require('./lifeSourceEvents');

class LifeProjectService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway;
  }

  async bootstrap({ userId }) {
    await this.repository.ensureDefaultAreas({ userId });
    return {
      areas: await this.repository.listAreas({ userId }),
      projects: await this.repository.listProjects({ userId }),
    };
  }

  async create({ userId, input }) {
    const project = await this.repository.createProject({ userId, ...input });
    if (!project) return null;
    await recordSimpleEvent(this.gateway, {
      userId, eventType: 'project.created', sourceChannel: 'life_os',
      sourceRef: `project:${project.id}`, deduplicationKey: `project-created:${project.id}`,
      summary: `Создан проект «${project.name}»`,
      structuredData: { projectId: project.id, ...(project.area_id ? { areaId: project.area_id } : {}) },
    });
    return project;
  }

  async update({ userId, projectId, input }) {
    const project = await this.repository.updateProject({ userId, projectId, ...input });
    if (!project) return null;
    const archived = project.status === 'archived';
    await recordSimpleEvent(this.gateway, {
      userId, eventType: archived ? 'project.archived' : 'project.updated', sourceChannel: 'life_os',
      sourceRef: `project:${project.id}`,
      deduplicationKey: `project-${archived ? 'archived' : 'updated'}:${project.id}:${project.revision}`,
      summary: archived ? `Архивирован проект «${project.name}»` : `Обновлён проект «${project.name}»`,
      structuredData: { projectId: project.id, revision: project.revision, state: project.status,
        ...(project.area_id ? { areaId: project.area_id } : {}) },
    });
    return project;
  }
}

module.exports = { LifeProjectService };
