const { publicArea, publicCommitment, publicEvent, publicProject, publicProposal } = require('./lifePublic');

class MissionControlService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.deviceRepository = options.deviceRepository || null;
  }

  async get({ userId }) {
    await this.repository.ensureDefaultAreas({ userId });
    const [areas, projects, commitments, proposals, events, devices] = await Promise.all([
      this.repository.listAreas({ userId }),
      this.repository.listProjects({ userId }),
      this.repository.listCommitments({ userId, statuses: ['open'], limit: 30 }),
      this.repository.listProposals({ userId, statuses: ['open', 'executing', 'outcome_unknown'], limit: 20 }),
      this.repository.listTimeline({ userId, limit: 15 }),
      this.deviceRepository ? this.deviceRepository.listForUser(userId) : [],
    ]);
    const current = projects.find((project) => project.status === 'active') || null;
    return {
      generatedAt: new Date().toISOString(),
      currentMission: current ? publicProject(current) : null,
      areas: areas.map(publicArea), projects: projects.map(publicProject),
      commitments: commitments.map(publicCommitment), proposals: proposals.map(publicProposal),
      recentEvents: events.map(publicEvent),
      devices: devices.slice(0, 20).map((device) => ({ id: device.id, name: device.name, status: device.status, lastSeenAt: device.last_seen_at || null })),
    };
  }
}

module.exports = { MissionControlService };
