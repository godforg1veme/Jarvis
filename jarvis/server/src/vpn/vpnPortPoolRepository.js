const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PORT_MIN = 20000;
const PORT_MAX = 50000;

function normalizePortPool(value, expectedNode = null) {
  if (!value || typeof value !== 'object') return null;
  const nodeCode = value.nodeCode ?? value.node_code;
  const generation = value.generation;
  const ports = value.ports;
  const hopIntervalSeconds = value.hopIntervalSeconds ?? value.hop_interval_seconds;
  const revision = value.revision;
  if (!['de', 'nl'].includes(nodeCode) || (expectedNode && nodeCode !== expectedNode)
    || typeof generation !== 'string' || !UUID.test(generation)
    || !Array.isArray(ports) || ports.length < 4 || ports.length > 12
    || !Number.isInteger(hopIntervalSeconds) || hopIntervalSeconds < 5 || hopIntervalSeconds > 45
    || !Number.isInteger(revision) || revision < 1) return null;
  if (ports.some((port) => !Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX)
    || ports.some((port, index) => index > 0 && port <= ports[index - 1])) return null;
  return {
    nodeCode,
    generation: generation.toLowerCase(),
    ports: [...ports],
    hopIntervalSeconds,
    revision,
  };
}

class VpnPortPoolRepository {
  constructor(options = {}) {
    const pool = options?.pool || options;
    if (!pool || typeof pool.query !== 'function') throw new Error('VpnPortPoolRepository requires a database pool with a query method');
    this.pool = pool;
  }

  async findActive(nodeCode) {
    if (!['de', 'nl'].includes(nodeCode)) return null;
    const result = await this.pool.query(`
      SELECT node_code, generation, ports, hop_interval_seconds, revision
      FROM vpn_hysteria_port_pools WHERE node_code = $1 LIMIT 1
    `, [nodeCode]);
    return normalizePortPool(result.rows?.[0] || null, nodeCode);
  }

  async replaceActive({ nodeCode, expectedRevision, generation, ports, hopIntervalSeconds, changedBy }) {
    const proposed = normalizePortPool({ nodeCode, generation, ports, hopIntervalSeconds, revision: expectedRevision }, nodeCode);
    if (!proposed || !Number.isInteger(expectedRevision) || expectedRevision < 1
      || typeof changedBy !== 'string' || !changedBy.trim() || changedBy.trim().length > 120) {
      throw new Error('VPN_PORT_POOL_INVALID');
    }
    const result = await this.pool.query(`
      UPDATE vpn_hysteria_port_pools
      SET generation = $1, ports = $2, hop_interval_seconds = $3,
          revision = revision + 1, changed_at = NOW(), changed_by = $4
      WHERE node_code = $5 AND revision = $6
      RETURNING node_code, generation, ports, hop_interval_seconds, revision
    `, [proposed.generation, proposed.ports, proposed.hopIntervalSeconds, changedBy.trim(), nodeCode, expectedRevision]);
    return normalizePortPool(result.rows?.[0] || null, nodeCode);
  }
}

module.exports = { VpnPortPoolRepository, normalizePortPool, PORT_MIN, PORT_MAX };
