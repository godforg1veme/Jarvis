const failure = () => Object.assign(new Error('JOB_BROWSER_PAGE_CLEANUP_FAILED'), { code: 'JOB_BROWSER_PAGE_CLEANUP_FAILED' });

function deadline(work, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(failure()), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

// Stop in-flight subresources before closing a managed page. Playwright 1.64
// otherwise retains failed route delegates in the persistent context.
async function closeGuardedPage(page, { timeoutMs = 2000, onUnhealthy = () => {} } = {}) {
  if (!page) return;
  let failed = false;
  try {
    if (!page.isClosed?.()) {
      if (typeof page.evaluate !== 'function') throw failure();
      await deadline(() => page.evaluate(() => window.stop()), timeoutMs);
    }
  } catch { failed = true; }
  try { await deadline(() => page.close(), timeoutMs); }
  catch { failed = true; }
  if (failed) {
    try { onUnhealthy(); } catch {}
    throw failure();
  }
}

module.exports = { closeGuardedPage };
