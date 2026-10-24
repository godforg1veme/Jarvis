class WebSearchService {
  constructor({ planner, client }) { this.planner = planner; this.client = client; }

  async prepare({ currentRequest, requireAccess = async () => {} }) {
    await requireAccess();
    const decision = await this.planner.plan({ currentRequest });
    await requireAccess();
    if (decision.mode === 'skip') return { status: 'skipped', sources: [] };
    if (decision.mode !== 'search') return { status: 'unavailable', sources: [] };
    const result = await this.client.search({ query: decision.query });
    await requireAccess();
    return { ...result, checkedAt: new Date().toISOString() };
  }

  close() { return this.client.close(); }
}

module.exports = { WebSearchService };
