const crypto = require('node:crypto');
const { sanitizeEvidence } = require('./evidenceSanitizer');

const SERVICES_BY_SCOPE = Object.freeze({
  xray: Object.freeze(['xray']),
  hysteria2: Object.freeze(['hysteria2']),
  host: Object.freeze(['xray', 'hysteria2']),
  multi: Object.freeze(['xray', 'hysteria2']),
});

class VpnEvidenceCollector {
  constructor({ client, clock = () => new Date() }) { this.client = client; this.clock = clock; }

  async collect(scope) {
    const now = this.clock();
    const after = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const before = now.toISOString();
    const raw = [];
    let unavailable = false;
    for (const serviceId of SERVICES_BY_SCOPE[scope] || SERVICES_BY_SCOPE.multi) {
      try {
        const response = await this.client.request({
          version: 1,
          requestId: crypto.randomUUID(),
          operation: 'service.logs.read',
          arguments: { serviceId, after, before, maxLines: 100 },
          sentAt: now.toISOString(),
        });
        if (response.result.state !== 'succeeded') { unavailable = true; continue; }
        const output = String(response.result.data?.output || '');
        for (const line of output.split(/\r?\n/).slice(-100)) {
          if (line.trim()) raw.push({ source: serviceId, observedAt: now.toISOString(), message: line });
        }
      } catch (_) { unavailable = true; }
    }
    const sanitized = sanitizeEvidence(raw);
    return Object.freeze({ ...sanitized, truncated: sanitized.truncated || unavailable, sourcesUnavailable: unavailable });
  }
}

module.exports = { SERVICES_BY_SCOPE, VpnEvidenceCollector };
