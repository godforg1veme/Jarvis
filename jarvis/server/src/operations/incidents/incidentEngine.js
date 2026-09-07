const { incidentSummary } = require('./statusLanguage');

class IncidentEngine {
  constructor(options) {
    this.repository = options.repository;
    this.hostId = options.hostId;
    this.notifier = options.notifier || null;
    this.failureCounts = new Map();
  }

  async observe(service) {
    const healthy = service.healthState === 'healthy';
    if (healthy) {
      this.failureCounts.delete(service.serviceKey);
      await this.repository.resolveServiceIncidents({ hostId: this.hostId, serviceId: service.id, failureKind: service.failureKind || null });
      return;
    }
    const immediate = service.sourceState === 'failed';
    const count = (this.failureCounts.get(service.serviceKey) || 0) + 1;
    this.failureCounts.set(service.serviceKey, count);
    if (!immediate && count < 3) return;
    const kind = service.failureKind || (immediate ? 'service_failed' : service.healthState === 'no_fresh_data' ? 'no_fresh_data' : 'service_unhealthy');
    const incident = await this.repository.openOrUpdateIncident({
      hostId: this.hostId, serviceId: service.id, failureKind: kind,
      severity: immediate ? 'critical' : 'error', summary: service.summary || incidentSummary(service, kind),
      technicalDetail: `${service.sourceState}/${service.healthState}`,
    });
    if (incident && this.notifier) {
      const durable = typeof this.repository.claimIncidentNotification === 'function';
      const claimed = durable ? await this.repository.claimIncidentNotification(incident.id) : incident.opened;
      if (claimed) {
        const delivered = await this.notifier.notify(incident, service);
        if (durable && delivered === true) await this.repository.markIncidentNotified(incident.id);
      }
    }
  }
}

module.exports = { IncidentEngine };
