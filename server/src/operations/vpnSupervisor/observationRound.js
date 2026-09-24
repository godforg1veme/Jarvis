const crypto = require('node:crypto');
const { REQUIRED_CHECKS } = require('./contracts');
const { parseVpnHealth } = require('../../vpn/vpnHealthSchema');

const CHECK_PATHS = Object.freeze({
  xray_config: Object.freeze(['xray', 'config']),
  xray_listener: Object.freeze(['xray', 'listener']),
  hysteria2_config: Object.freeze(['hysteria2', 'config']),
  hysteria2_listener: Object.freeze(['hysteria2', 'listener']),
  hysteria2_auth: Object.freeze(['hysteria2', 'auth']),
  host_dns: Object.freeze(['network', 'dns']),
  host_outbound: Object.freeze(['network', 'outbound']),
});

function sameIncident(original, current) {
  const before = original?.diagnosis?.primary;
  const after = current?.diagnosis?.primary;
  return Boolean(before && after
    && current.diagnosis.state === 'incident'
    && before.code === after.code
    && before.scope === after.scope
    && before.likelyCause === after.likelyCause
    && JSON.stringify(original.diagnosis) === JSON.stringify(current.diagnosis));
}

async function collectObservationRound({ client, checks, originalHealth, originalFacts, clock = () => new Date() }) {
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > REQUIRED_CHECKS.length
    || new Set(checks).size !== checks.length || checks.some((check) => !Object.hasOwn(CHECK_PATHS, check))
    || !Array.isArray(originalFacts) || originalFacts.length + checks.length > 30) {
    return Object.freeze({ state: 'invalid', facts: originalFacts });
  }
  const now = clock();
  let health;
  try {
    const response = await client.request({
      version: 1, requestId: crypto.randomUUID(), operation: 'vpn.health.snapshot',
      arguments: {}, sentAt: now.toISOString(),
    });
    if (response?.result?.state !== 'succeeded') throw new Error('snapshot unavailable');
    health = parseVpnHealth(response.result.data);
  } catch (_) {
    return Object.freeze({ state: 'unavailable', facts: originalFacts });
  }
  if (!sameIncident(originalHealth, health)) return Object.freeze({ state: 'stale', facts: originalFacts });
  const facts = originalFacts.map((fact) => ({ ...fact }));
  for (const check of checks) {
    const [section, field] = CHECK_PATHS[check];
    const status = health[section][field];
    facts.push({ id: `F${facts.length + 1}`, name: `check.${check}`, status });
  }
  return Object.freeze({ state: 'ready', facts: Object.freeze(facts.map((fact) => Object.freeze(fact))) });
}

module.exports = { CHECK_PATHS, collectObservationRound, sameIncident };
