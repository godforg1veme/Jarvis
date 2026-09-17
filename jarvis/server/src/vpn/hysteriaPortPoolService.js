const { normalizePortPool } = require('./vpnPortPoolRepository');

function publicPool(value, expectedNode) {
  const normalized = normalizePortPool({ ...value, revision: value?.revision ?? 1 }, expectedNode);
  if (!normalized) return null;
  return {
    nodeCode: normalized.nodeCode,
    generation: normalized.generation,
    ports: normalized.ports,
    hopIntervalSeconds: normalized.hopIntervalSeconds,
  };
}

class HysteriaPortPoolService {
  constructor({ repository, now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async activeForNode(nodeCode) {
    if (!['de', 'nl'].includes(nodeCode) || !this.repository?.findActive) return null;
    try {
      return publicPool(await this.repository.findActive(nodeCode), nodeCode);
    } catch (_) {
      return null;
    }
  }

  async activeForSubscription() {
    const [de, nl] = await Promise.all([this.activeForNode('de'), this.activeForNode('nl')]);
    return { de, nl };
  }
}

module.exports = { HysteriaPortPoolService, publicPool };
