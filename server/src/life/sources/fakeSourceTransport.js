class FakeSourceTransport {
  constructor(pages = {}) { this.pages = pages; }
  async discoverScopes() { return [{ id: 'fixture', label: 'Fixture data', live: false }]; }
  async fetchPage({ cursor = 'initial', limit = 50 }) { const page = this.pages[cursor] || { items: [], nextCursor: cursor, done: true }; return { items: page.items.slice(0, limit), nextCursor: page.nextCursor || cursor, done: page.done === true }; }
}
module.exports = { FakeSourceTransport };
