function bounded(work, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('JOB_BROWSER_OPERATION_TIMEOUT'), { code: 'JOB_BROWSER_OPERATION_TIMEOUT' })), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

class BrowserHealth {
  constructor({ context, onFatal = () => {}, timeoutMs = 2000, intervalMs = 10000 }) {
    Object.assign(this, { context, onFatal, timeoutMs, intervalMs });
    this.failed = false; this.stopped = false; this.inFlight = null; this.timer = null;
    this.onClose = () => this.fail(); context.once('close', this.onClose);
  }
  fail() {
    if (this.stopped || this.failed) return;
    this.failed = true; this.onFatal();
  }
  check() {
    if (this.failed || this.stopped) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    this.inFlight = bounded(async () => {
      // A dedicated blank page cannot race HH navigation or execute HH scripts.
      const page = await this.context.newPage();
      try { return await page.evaluate(() => 1) === 1; }
      finally { await page.close(); }
    }, this.timeoutMs).catch(() => false).then(ok => {
      if (!ok) this.fail();
      return ok && !this.failed && !this.stopped;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  start() {
    if (!this.timer) { this.timer = setInterval(() => { void this.check(); }, this.intervalMs); this.timer.unref?.(); }
  }
  close() {
    this.stopped = true; clearInterval(this.timer); this.timer = null;
    this.context.off('close', this.onClose);
  }
}
module.exports = { BrowserHealth, bounded };
