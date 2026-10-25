// All lanes share browser capacity. Recheck fresh work between background passes,
// and bound a tick so a large user list does not freeze one scheduling snapshot.
class JobCollectionScheduler {
  constructor({ freshRepository, historyRepository, freshCollector, historyCollector, reconcileRepository, reconcileCollector,
    now = () => new Date(), shouldStop = () => false, maxUsersPerLane = 4, maxTickMs = 60000,
    onFailure = () => process.stderr.write('JOB_COLLECTION_USER_FAILED\n') }) {
    Object.assign(this, { freshRepository, historyRepository, freshCollector, historyCollector,
      reconcileRepository, reconcileCollector, now, shouldStop, maxUsersPerLane, maxTickMs, onFailure });
    this.backgroundLanes = reconcileRepository && reconcileCollector ? ['history', 'reconcile'] : ['history'];
    this.nextBackground = 0; this.backgroundOwed = false;
  }
  async tick() {
    const started = this.now().getTime();
    const visited = { fresh: new Set(), history: new Set(), reconcile: new Set() };
    const canRun = () => !this.shouldStop() && this.now().getTime() - started < this.maxTickMs;
    const runNext = async lane => {
      if (!canRun() || visited[lane].size >= this.maxUsersPerLane) return false;
      const repository = this[`${lane}Repository`], collector = this[`${lane}Collector`];
      const due = await repository.dueUsers({ now: this.now(), limit: this.maxUsersPerLane });
      const row = due.find(candidate => !visited[lane].has(candidate.user_id));
      if (!row || !canRun()) return false;
      visited[lane].add(row.user_id);
      try { await collector.runOnce({ userId: row.user_id, now: this.now() }); }
      catch { this.onFailure(); }
      return true;
    };
    const runBackground = async () => {
      for (let offset = 0; offset < this.backgroundLanes.length; offset++) {
        const index = (this.nextBackground + offset) % this.backgroundLanes.length;
        if (await runNext(this.backgroundLanes[index])) {
          this.nextBackground = (index + 1) % this.backgroundLanes.length;
          this.backgroundOwed = false;
          return true;
        }
      }
      return false;
    };
    // An unusually slow in-flight fresh request can consume the entire tick.
    // Give background work its owed turn next time instead of starving it.
    if (this.backgroundOwed && canRun()) await runBackground();
    for (let round = 0; round < this.maxUsersPerLane * this.backgroundLanes.length && canRun(); round++) {
      const fresh = await runNext('fresh');
      const background = await runBackground();
      if (fresh && !background && !canRun()) this.backgroundOwed = true;
      if (!fresh && !background) break;
    }
  }
}

module.exports = { JobCollectionScheduler };
