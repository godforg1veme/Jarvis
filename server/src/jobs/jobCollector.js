const { evaluateVacancy } = require('./jobFilters');
const { jobError } = require('./jobSchemas');
const { createHash } = require('node:crypto');
const { splitWindow } = require('./jobCollectionWindows');

class JobCollector {
  constructor({ searchRepository, deliveryRepository, hhClient, currencyRates = null,
    captchaEnabled = false, now = () => new Date(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxRequests = 40, shouldStop = () => false }) {
    this.search = searchRepository; this.delivery = deliveryRepository; this.hh = hhClient;
    this.currencyRates = currencyRates; this.now = now; this.wait = wait; this.maxRequests = maxRequests;
    this.shouldStop = shouldStop; this.captchaEnabled = captchaEnabled;
  }
  async runOnce({ userId, now = this.now(), force = false }) {
    const job = await this.search.claimSearch({ userId, now, force });
    if (!job) return { outcome: 'not_due', matched: 0 };
    const settings = job.settings;
    if (!Array.isArray(settings?.queries) || settings.queries.length === 0) {
      await this.search.finishSearch({ userId, leaseId: job.lease_id, checkpoint: null,
        nextCheckAt: new Date(now.getTime() + (settings?.intervalMs || 1800000)), failureCode: 'JOB_SEARCH_QUERIES_REQUIRED' });
      return { outcome: 'JOB_SEARCH_QUERIES_REQUIRED', matched: 0, requests: 0 };
    }
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
      if (requests >= this.maxRequests) throw jobError('JOB_COLLECTION_LIMIT');
      if (!await this.search.renewSearch({ userId, leaseId: job.lease_id, revision: job.revision, now: this.now() })) throw jobError('JOB_COLLECTION_CHANGED');
      requests++;
      await this.wait(250);
      return fn();
    };
    const saveProgress = () => this.search.saveProgress({ userId, leaseId: job.lease_id, progress });
    let collectionNoticeAttempted = false;
    const notifyCollection = async (code) => {
      if (collectionNoticeAttempted || typeof this.delivery.enqueueCollectionAttention !== 'function') return;
      collectionNoticeAttempted = true;
      try { await this.delivery.enqueueCollectionAttention({ userId, runUntil: progress.until, code }); }
      catch { process.stderr.write('JOB_COLLECTION_NOTICE_FAILED\n'); }
    };
    try {
      const hh = typeof this.hh.forUser === 'function' ? this.hh.forUser(userId) : this.hh;
      const capabilities = hh.capabilities || { dateWindows: true, maxPages: 20 };
      if (!Number.isInteger(capabilities.maxPages) || capabilities.maxPages < 1 || capabilities.maxPages > 1000) throw jobError('JOB_HH_INVALID_RESPONSE');
      if (capabilities.dateWindowGranularity === 'moscow_day' && progress.windowFormat !== 'hh_calendar_v1') {
        // Legacy cursors refer to search_period, which did not apply the upper
        // bound. Reuse the original range, but never offsets from that listing.
        progress.windows = progress.windows.map(window => ({ ...window, page: 0, offset: 0 }));
        progress.windowFormat = 'hh_calendar_v1';
      }
      await saveProgress();
      let remaining = progress.windows.length;
      let deferredCode = null;
      while (remaining > 0) {
        const window = progress.windows[0];
        try {
          const page = await request(() => hh.search({ query: window.query, publishedFrom: window.from, publishedTo: window.to, page: window.page }));
          if (!Array.isArray(page.items) || !Number.isInteger(page.pages) || !Number.isFinite(page.found) || page.found < 0) throw jobError('JOB_HH_INVALID_RESPONSE');
          if (page.found > 2000 && capabilities.dateWindows === true) {
            const children = splitWindow(window, capabilities.dateWindowGranularity);
            if (!children) throw jobError('JOB_COLLECTION_WINDOW_SATURATED');
            progress.windows.splice(0, 1, ...children);
            remaining++;
            await saveProgress(); continue;
          }
          if (page.pages < 0 || page.pages > capabilities.maxPages) throw jobError('JOB_HH_INVALID_RESPONSE');
          for (let index = window.offset; index < page.items.length; index++) {
            const item = page.items[index];
            const id = String(item.id);
            if (!/^\d{1,20}$/.test(id)) throw jobError('JOB_HH_INVALID_RESPONSE');
            if (seen.has(id)) { window.offset = index + 1; await saveProgress(); continue; }
            let snapshot;
            try { snapshot = await request(() => hh.getVacancy({ externalId: id })); }
            catch (error) {
              if (error.code !== 'JOB_HH_NOT_FOUND') throw error;
              seen.add(id); window.offset = index + 1; await saveProgress(); continue;
            }
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
          else { progress.windows.shift(); remaining--; }
          await saveProgress();
        } catch (error) {
          if (!['JOB_COLLECTION_WINDOW_SATURATED', 'JOB_HH_DOM_CHANGED', 'JOB_COLLECTION_WINDOW_EXPIRED'].includes(error.code)) throw error;
          deferredCode ||= error.code;
          progress.windows.push(progress.windows.shift());
          remaining--;
          await saveProgress();
          await notifyCollection(error.code);
        }
      }
      if (deferredCode) throw jobError(deferredCode);
      await this.search.finishSearch({ userId, leaseId: job.lease_id, checkpoint: progress.until, nextCheckAt });
      return { outcome: 'complete', matched, requests };
    } catch (error) {
      const code = /^JOB_[A-Z_]+$/.test(error.code || '') ? error.code : 'JOB_COLLECTION_FAILED';
      const waiting = code === 'JOB_HH_CAPTCHA_WAITING' && Number.isInteger(error.retryAfterMs)
        && error.retryAfterMs >= 1000 && error.retryAfterMs <= 120000;
      const manual = code === 'JOB_HH_MANUAL_ACTIVE' || (code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' && this.captchaEnabled);
      const budget = code === 'JOB_COLLECTION_LIMIT';
      if (budget && progress.windows.length > 1) progress.windows.push(progress.windows.shift());
      if (budget) await saveProgress();
      await this.search.finishSearch({ userId, leaseId: job.lease_id, checkpoint: null,
        nextCheckAt: budget || manual ? new Date(this.now().getTime() + 10000) : waiting ? new Date(this.now().getTime() + error.retryAfterMs)
          : new Date(now.getTime() + Math.max(settings.intervalMs, error.retryAfterMs || 0)), failureCode: budget ? null : code });
      if (code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED') {
        const incidentId = /^[a-f0-9-]{36}$/.test(error.recoveryId || '') ? error.recoveryId
          : createHash('sha256').update(JSON.stringify([userId, progress.until, 'HH_CAPTCHA'])).digest('hex');
        await this.delivery.enqueueAttention({ userId, incidentId });
      }
      if (!budget && !['JOB_HH_CAPTCHA_MANUAL_REQUIRED', 'JOB_HH_CAPTCHA_WAITING', 'JOB_HH_MANUAL_ACTIVE',
        'JOB_HH_RATE_LIMIT', 'JOB_HH_ACCESS_DENIED', 'JOB_COLLECTION_CHANGED', 'JOB_COLLECTION_STOPPED'].includes(code)) {
        await notifyCollection(code);
      }
      return { outcome: code, matched, requests };
    }
  }
}

module.exports = { JobCollector };
