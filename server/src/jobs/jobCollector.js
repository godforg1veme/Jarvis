const { evaluateVacancy } = require('./jobFilters');
const { jobError } = require('./jobSchemas');
const { createHash } = require('node:crypto');

class JobCollector {
  constructor({ searchRepository, deliveryRepository, hhClient, currencyRates = null,
    manualAccessUrl = '', now = () => new Date(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxRequests = 500, shouldStop = () => false }) {
    this.search = searchRepository; this.delivery = deliveryRepository; this.hh = hhClient;
    this.currencyRates = currencyRates; this.now = now; this.wait = wait; this.maxRequests = maxRequests;
    this.shouldStop = shouldStop; this.manualAccessUrl = manualAccessUrl;
  }
  async runOnce({ userId, now = this.now(), force = false }) {
    const job = await this.search.claimSearch({ userId, now, force });
    if (!job) return { outcome: 'not_due', matched: 0 };
    const settings = job.settings;
    let requests = 0, matched = 0;
    const seen = new Set();
    const rateSnapshot = this.currencyRates ? await this.currencyRates.get({ date: now }).catch(() => null) : null;
    const lower = new Date(job.checkpoint ? new Date(job.checkpoint).getTime() - 60 * 60 * 1000
      : now.getTime() - settings.historyDays * 86400000);
    const progress = job.progress || { until: now.toISOString(), lower: lower.toISOString(),
      windows: settings.queries.map((query) => ({ query, from: lower.toISOString(), to: now.toISOString(), page: 0, offset: 0 })) };
    const nextCheckAt = new Date(now.getTime() + settings.intervalMs);
    const request = async (fn) => {
      if (this.shouldStop()) throw jobError('JOB_COLLECTION_STOPPED');
      if (++requests > this.maxRequests) throw jobError('JOB_COLLECTION_LIMIT');
      if (!await this.search.renewSearch({ userId, leaseId: job.lease_id, revision: job.revision, now: this.now() })) throw jobError('JOB_COLLECTION_CHANGED');
      await this.wait(250);
      return fn();
    };
    const saveProgress = () => this.search.saveProgress({ userId, leaseId: job.lease_id, progress });
    try {
      const hh = typeof this.hh.forUser === 'function' ? this.hh.forUser(userId) : this.hh;
      const capabilities = hh.capabilities || { dateWindows: true, maxPages: 20 };
      if (!Number.isInteger(capabilities.maxPages) || capabilities.maxPages < 1 || capabilities.maxPages > 1000) throw jobError('JOB_HH_INVALID_RESPONSE');
      await saveProgress();
      while (progress.windows.length) {
        const window = progress.windows[0];
        const page = await request(() => hh.search({ query: window.query, publishedFrom: window.from, publishedTo: window.to, page: window.page }));
        if (!Array.isArray(page.items) || !Number.isInteger(page.pages) || !Number.isFinite(page.found) || page.found < 0) throw jobError('JOB_HH_INVALID_RESPONSE');
        if (page.found > 2000 && capabilities.dateWindows === true) {
          const from = new Date(window.from), to = new Date(window.to);
          if (to - from <= 10 * 60 * 1000) throw jobError('JOB_COLLECTION_WINDOW_SATURATED');
          const mid = new Date(Math.floor((from.getTime() + to.getTime()) / 2 / 300000) * 300000).toISOString();
          progress.windows.splice(0, 1, { query: window.query, from: mid, to: window.to, page: 0, offset: 0 },
            { query: window.query, from: window.from, to: mid, page: 0, offset: 0 });
          await saveProgress(); continue;
        }
        if (page.pages < 0 || page.pages > capabilities.maxPages) throw jobError('JOB_HH_INVALID_RESPONSE');
        for (let index = window.offset; index < page.items.length; index++) {
          const item = page.items[index];
          const id = String(item.id);
          if (!/^\d{1,20}$/.test(id)) throw jobError('JOB_HH_INVALID_RESPONSE');
          if (seen.has(id)) { window.offset = index + 1; await saveProgress(); continue; }
          const snapshot = await request(() => hh.getVacancy({ externalId: id }));
          seen.add(id);
          if (!snapshot.archived && new Date(snapshot.publishedAt) >= new Date(progress.lower)
            && new Date(snapshot.publishedAt) <= new Date(progress.until)) {
            const decision = evaluateVacancy({ vacancy: snapshot, settings, rateSnapshot });
            if (decision.include) {
              const stored = await this.search.upsertVacancy({ externalId: id, snapshot });
              await this.search.recordMatch({ userId, vacancyId: stored.id, filterRevision: job.revision, annotations: decision.annotations });
              await this.delivery.enqueue({ userId, vacancyId: stored.id }); matched++;
            }
          }
          window.offset = index + 1; await saveProgress();
        }
        if (window.page + 1 < page.pages) { window.page++; window.offset = 0; }
        else progress.windows.shift();
        await saveProgress();
      }
      await this.search.finishSearch({ userId, leaseId: job.lease_id, checkpoint: progress.until, nextCheckAt });
      return { outcome: 'complete', matched, requests };
    } catch (error) {
      const code = /^JOB_[A-Z_]+$/.test(error.code || '') ? error.code : 'JOB_COLLECTION_FAILED';
      const waiting = code === 'JOB_HH_CAPTCHA_WAITING' && Number.isInteger(error.retryAfterMs)
        && error.retryAfterMs >= 1000 && error.retryAfterMs <= 120000;
      const manual = code === 'JOB_HH_MANUAL_ACTIVE' || (code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' && Boolean(this.manualAccessUrl));
      await this.search.finishSearch({ userId, leaseId: job.lease_id, checkpoint: null,
        nextCheckAt: manual ? new Date(this.now().getTime() + 10000) : waiting ? new Date(this.now().getTime() + error.retryAfterMs)
          : new Date(now.getTime() + Math.max(settings.intervalMs, error.retryAfterMs || 0)), failureCode: code });
      if (code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED') {
        const incidentId = /^[a-f0-9-]{36}$/.test(error.recoveryId || '') ? error.recoveryId
          : createHash('sha256').update(JSON.stringify([userId, progress.until, 'HH_CAPTCHA'])).digest('hex');
        await this.delivery.enqueueAttention({ userId, incidentId });
      }
      return { outcome: code, matched, requests };
    }
  }
}

module.exports = { JobCollector };
