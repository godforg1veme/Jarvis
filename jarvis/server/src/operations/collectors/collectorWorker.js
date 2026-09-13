const crypto = require('node:crypto');
const { z } = require('zod');

const SERVICE_CATALOG = Object.freeze({
  'jarvis-server': Object.freeze({ displayName: 'Jarvis Server', serviceType: 'jarvis' }),
  postgres: Object.freeze({ displayName: 'PostgreSQL', serviceType: 'docker' }),
  cloudflared: Object.freeze({ displayName: 'Cloudflare Tunnel', serviceType: 'docker' }),
  xray: Object.freeze({ displayName: 'Xray VPN', serviceType: 'systemd' }),
  'telegram-parser': Object.freeze({ displayName: 'Telegram Parser', serviceType: 'parser' }),
});

const serviceSnapshotSchema = z.object({
  services: z.array(z.object({
    id: z.enum(Object.keys(SERVICE_CATALOG)),
    sourceType: z.enum(['systemd', 'docker']),
    sourceState: z.enum(['active', 'inactive', 'failed', 'unknown', 'unavailable']),
    healthState: z.enum(['healthy', 'degraded', 'unavailable', 'no_fresh_data', 'unknown']),
    detail: z.string().max(120),
  }).strict()).max(Object.keys(SERVICE_CATALOG).length),
}).strict();

const hostSnapshotSchema = z.object({
  loadavg: z.array(z.string().regex(/^\d+(?:\.\d+)?$/)).length(3),
  meminfo: z.array(z.string().max(100)).max(12),
  uptimeSeconds: z.number().int().nonnegative(),
  diskUsedPercent: z.number().min(0).max(100).optional(),
  inodeUsedPercent: z.number().min(0).max(100).optional(),
  cpuUsedPercent: z.number().min(0).max(100).optional(),
  swapUsedPercent: z.number().min(0).max(100).optional(),
  memoryTotalBytes: z.number().int().nonnegative().optional(),
  diskTotalBytes: z.number().int().nonnegative().optional(),
  diskFreeBytes: z.number().int().nonnegative().optional(),
  networkRxBytes: z.number().int().nonnegative().optional(),
  networkTxBytes: z.number().int().nonnegative().optional(),
}).strict();

const vpnStatusSchema = z.object({
  serviceState: z.enum(['active', 'unavailable']),
  configValid: z.boolean(),
  listenerReady: z.boolean(),
  clientCount: z.number().int().min(0).max(50),
}).strict();

function normalizeHostMetrics(data) {
  const snapshot = hostSnapshotSchema.parse(data);
  const memory = Object.fromEntries(snapshot.meminfo.map((line) => {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)/);
    return match ? [match[1], Number(match[2])] : ['', 0];
  }).filter(([key]) => key));
  const total = memory.MemTotal || 0;
  const available = memory.MemAvailable || memory.MemFree || 0;
  return {
    load_1: Number(snapshot.loadavg[0]), load_5: Number(snapshot.loadavg[1]), load_15: Number(snapshot.loadavg[2]),
    uptime_seconds: snapshot.uptimeSeconds,
    ...(total > 0 ? { memory_used_percent: Math.max(0, Math.min(100, ((total - available) / total) * 100)) } : {}),
    ...(snapshot.diskUsedPercent !== undefined ? { disk_used_percent: snapshot.diskUsedPercent } : {}),
    ...(snapshot.inodeUsedPercent !== undefined ? { inode_used_percent: snapshot.inodeUsedPercent } : {}),
    ...Object.fromEntries(Object.entries({ cpu_used_percent: snapshot.cpuUsedPercent, swap_used_percent: snapshot.swapUsedPercent,
      memory_total_bytes: snapshot.memoryTotalBytes, disk_total_bytes: snapshot.diskTotalBytes, disk_free_bytes: snapshot.diskFreeBytes,
      network_rx_bytes: snapshot.networkRxBytes, network_tx_bytes: snapshot.networkTxBytes }).filter(([, value]) => value !== undefined)),
  };
}

class CollectorWorker {
  constructor(options) {
    this.client = options.client;
    this.repository = options.repository;
    this.hostId = options.hostId;
    this.intervalMs = options.intervalMs;
    this.logger = options.logger;
    this.onSnapshot = options.onSnapshot || (() => {});
    this.onEvent = options.onEvent || (() => {});
    this.incidentEngine = options.incidentEngine || null;
    this.lastStates = new Map();
    this.timer = null;
    this.running = false;
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs); void this.runOnce(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  request(operation) {
    return this.client.request({ version: 1, requestId: crypto.randomUUID(), operation, arguments: {}, sentAt: new Date().toISOString() });
  }
  async recordUnavailableServices() {
    await Promise.all(Object.entries(SERVICE_CATALOG).map(async ([serviceKey, definition]) => {
      const saved = await this.repository.upsertService({ hostId: this.hostId, serviceKey, ...definition, sourceState: 'unavailable', healthState: 'unavailable' });
      const normalized = { ...definition, ...saved, serviceKey, sourceState: 'unavailable', healthState: 'unavailable' };
      if (this.incidentEngine) await this.incidentEngine.observe(normalized);
      await this.recordStateChange(normalized);
    }));
  }
  async collectServices() {
    const response = await this.request('services.snapshot');
    if (response.result.state !== 'succeeded' || !response.result.data) throw new Error('Host Agent services snapshot failed');
    const snapshot = serviceSnapshotSchema.parse(response.result.data);
    const observed = new Map(snapshot.services.map((service) => [service.id, service]));
    await Promise.all(Object.entries(SERVICE_CATALOG).map(([serviceKey, definition]) => {
      const service = observed.get(serviceKey);
      return this.repository.upsertService({
        hostId: this.hostId,
        serviceKey,
        ...definition,
        sourceState: service ? service.sourceState : 'unavailable',
        healthState: service ? service.healthState : 'unavailable',
      }).then(async (saved) => {
        const normalized = { ...definition, ...saved, serviceKey, sourceState: service ? service.sourceState : 'unavailable', healthState: service ? service.healthState : 'unavailable' };
        if (this.incidentEngine) await this.incidentEngine.observe(normalized);
        await this.recordStateChange(normalized);
        return saved;
      });
    }));
  }
  async recordStateChange(service) {
    if (typeof this.repository.recordEvent !== 'function') return;
    const state = `${service.sourceState}/${service.healthState}`;
    const previous = this.lastStates.get(service.serviceKey);
    this.lastStates.set(service.serviceKey, state);
    if (previous === state) return;
    const event = await this.repository.recordEvent({ hostId: this.hostId, serviceId: service.id, type: previous ? 'service.state_changed' : 'service.observed', payload: { serviceKey: service.serviceKey, previous: previous || null, state } });
    this.onEvent({ id: event.id, type: event.event_type, serviceKey: service.serviceKey, state });
  }
  async collectParser() {
    if (typeof this.repository.recordParserResult !== 'function') return;
    const response = await this.request('parser.snapshot');
    if (response.result.state !== 'succeeded' || !response.result.data) return;
    const snapshot = serviceSnapshotSchema.shape.services.element.parse(response.result.data);
    const summary = `${snapshot.sourceState}/${snapshot.healthState}: ${snapshot.detail}`.slice(0, 1000);
    const fingerprint = crypto.createHash('sha256').update(summary).digest();
    await this.repository.recordParserResult({ hostId: this.hostId, kind: 'service_state', summary, observedAt: new Date(), fingerprint });
  }
  async collectVpn() {
    if (typeof this.repository.serviceByKey !== 'function') return;
    const response = await this.request('vpn.status');
    if (response.result.state !== 'succeeded' || !response.result.data) throw new Error('VPN status unavailable');
    const status = vpnStatusSchema.parse(response.result.data);
    const healthy = status.serviceState === 'active' && status.configValid && status.listenerReady;
    const definition = SERVICE_CATALOG.xray;
    const saved = await this.repository.upsertService({
      hostId: this.hostId, serviceKey: 'xray', ...definition,
      sourceState: status.serviceState === 'active' ? 'active' : 'unavailable',
      healthState: healthy ? 'healthy' : status.serviceState === 'active' ? 'degraded' : 'unavailable',
    });
    const normalized = { ...definition, ...saved, serviceKey: 'xray', sourceState: status.serviceState, healthState: healthy ? 'healthy' : 'degraded' };
    if (this.incidentEngine) await this.incidentEngine.observe(normalized);
    await this.repository.recordMetricSamples({
      hostId: this.hostId, serviceId: saved.id, sampledAt: new Date(),
      metrics: { vpn_client_count: status.clientCount, vpn_config_valid: status.configValid ? 1 : 0, vpn_listener_ready: status.listenerReady ? 1 : 0 },
    });
  }
  async collectBackup() {
    if (typeof this.repository.recordBackupResult !== 'function') return;
    const response = await this.request('backup.status');
    if (response.result.state !== 'succeeded') throw new Error('Backup status unavailable');
    const snapshot = z.object({ available: z.boolean(), result: z.object({
      runId: z.string().regex(/^\d{8}T\d{6}Z$/), status: z.enum(['succeeded', 'failed']),
      startedAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }),
    }).strict().optional() }).strict().parse(response.result.data);
    if (snapshot.available && !snapshot.result) throw new Error('Missing backup result');
    if (snapshot.result) await this.repository.recordBackupResult({ hostId: this.hostId, ...snapshot.result });
  }
  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const response = await this.request('host.snapshot');
      const healthy = response.result.state === 'succeeded' && response.result.data;
      await this.repository.recordHostSnapshot({ hostId: this.hostId, state: healthy ? 'healthy' : 'unavailable' });
      if (healthy) {
        const metrics = normalizeHostMetrics(response.result.data);
        await this.repository.recordMetricSamples({ hostId: this.hostId, sampledAt: new Date(), metrics });
        if (this.incidentEngine) for (const [key, label, threshold] of [['disk_used_percent', 'Диск VPS', 90], ['inode_used_percent', 'Индексы файлов VPS', 90], ['memory_used_percent', 'Память VPS', 95], ['cpu_used_percent', 'Процессор VPS', 95]]) {
          if (metrics[key] === undefined) continue;
          const pressure = metrics[key] >= threshold;
          await this.incidentEngine.observe({ id: null, serviceKey: key, failureKind: `host_${key}`, displayName: label,
            summary: `${label}: занято ${Math.round(metrics[key])}%`, sourceState: 'active', healthState: pressure ? 'degraded' : 'healthy' });
        }
      }
    } catch (error) {
      await this.repository.recordHostSnapshot({ hostId: this.hostId, state: 'unavailable' }).catch(() => {});
      if (this.logger) this.logger.warn({ err: error }, 'operations host collection failed');
    }
    try {
      await this.collectServices();
    } catch (error) {
      await this.recordUnavailableServices().catch(() => {});
      if (this.logger) this.logger.warn({ err: error }, 'operations service collection failed');
    }
    try {
      await this.collectVpn();
    } catch (error) {
      if (this.logger) this.logger.warn({ err: error }, 'operations VPN collection failed');
    }
    try {
      await this.collectParser();
    } catch (error) {
      if (this.logger) this.logger.warn({ err: error }, 'operations parser collection failed');
    }
    try {
      await this.collectBackup();
    } catch (error) {
      if (this.logger) this.logger.warn({ err: error }, 'operations backup collection failed');
    } finally {
      this.running = false;
      this.onSnapshot({ observedAt: new Date().toISOString() });
    }
  }
}

module.exports = { CollectorWorker, SERVICE_CATALOG, hostSnapshotSchema, normalizeHostMetrics, serviceSnapshotSchema, vpnStatusSchema };
