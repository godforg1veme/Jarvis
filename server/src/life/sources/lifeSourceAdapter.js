class LifeSourceAdapter {
  constructor({ type, schemaVersion = 1, parser, transport }) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(type || '') || !parser?.parse || !transport?.fetchPage) throw new Error('invalid Life source adapter');
    this.type = type; this.schemaVersion = schemaVersion; this.parser = parser; this.transport = transport;
  }
  discoverScopes(input) { return this.transport.discoverScopes ? this.transport.discoverScopes(input) : []; }
  fetchPage(input) { return this.transport.fetchPage(input); }
  parse(item) { return this.parser.parse(item); }
}
module.exports = { LifeSourceAdapter };
