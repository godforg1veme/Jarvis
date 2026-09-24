class SourceRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) { if (this.adapters.has(adapter.type)) throw new Error('source adapter already registered'); this.adapters.set(adapter.type, adapter); return this; }
  require(type) { const adapter = this.adapters.get(type); if (!adapter) throw new Error('source adapter unavailable'); return adapter; }
  list() { return [...this.adapters.values()]; }
}
module.exports = { SourceRegistry };
