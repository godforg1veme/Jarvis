const crypto = require('node:crypto');
const { z } = require('zod');

const CHECKS = ['vless_tcp_443', 'vless_tcp_8443', 'hysteria2_udp_443', 'hysteria2_udp_hop'];
const CODES = ['NOT_CONFIGURED', 'RUNNER_UNAVAILABLE', 'CHECK_UNAVAILABLE', 'EGRESS_UNAVAILABLE', 'PROXY_CONNECT_FAILURE', 'EXIT_MISMATCH', 'HTTP_FAILURE'];
const check = z.object({ status: z.enum(['healthy', 'failed', 'unknown']), failureCode: z.enum(CODES).nullable() }).strict();
const schema = z.object({
  version: z.literal(1),
  targetNode: z.enum(['de', 'nl']),
  sampledAt: z.string().datetime({ offset: true }),
  checks: z.object(Object.fromEntries(CHECKS.map((name) => [name, check]))).strict(),
}).strict();

function unknown(targetNode) {
  return { targetNode, sampledAt: null, checks: Object.fromEntries(CHECKS.map((name) => [name, { status: 'unknown', failureCode: 'RUNNER_UNAVAILABLE' }])) };
}

// Scheduled probes repeat every 15 minutes, with jitter and bounded execution.
// Direct owner-confirmed probe proofs retain the stricter five-minute default.
const SCHEDULED_MAX_AGE_MS = 20 * 60 * 1000;

function validate(value, targetNode, now = new Date(), maxAgeMs = 300000) {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.targetNode !== targetNode) return unknown(targetNode);
  const age = now.getTime() - Date.parse(parsed.data.sampledAt);
  if (!Number.isFinite(age) || age > maxAgeMs || age < -30000) return unknown(targetNode);
  for (const item of Object.values(parsed.data.checks)) {
    if ((item.status === 'healthy') !== (item.failureCode === null)) return unknown(targetNode);
  }
  return parsed.data;
}

class ExternalProbeMonitor {
  constructor({ clients, now = () => new Date() }) {
    this.clients = clients;
    this.now = now;
  }

  async snapshot(targetNode) {
    if (!['de', 'nl'].includes(targetNode)) throw new Error('VPN_NODE_INVALID');
    const runnerNode = targetNode === 'de' ? 'nl' : 'de';
    const client = this.clients?.[runnerNode];
    if (!client) return unknown(targetNode);
    try {
      const response = await client.request({ version: 1, requestId: crypto.randomUUID(),
        operation: 'vpn.external_probe.snapshot', arguments: { targetNode }, sentAt: this.now().toISOString() });
      if (response?.result?.state !== 'succeeded') return unknown(targetNode);
      return validate(response.result.data, targetNode, this.now(), SCHEDULED_MAX_AGE_MS);
    } catch (_) {
      return unknown(targetNode);
    }
  }
}

module.exports = { ExternalProbeMonitor, validateExternalProbe: validate, unknownExternalProbe: unknown };
