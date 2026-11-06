const failure = () => Object.assign(new Error('JOB_BROWSER_PAGE_CLEANUP_FAILED'), { code: 'JOB_BROWSER_PAGE_CLEANUP_FAILED' });

function deadline(work, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(failure()), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

// Leave the document while request guards are still active. Merely stopping
// loaders leaves page timers alive during the interception teardown at close.
async function closeGuardedPage(page, { timeoutMs = 2000, onUnhealthy = () => {} } = {}) {
  if (!page) return;
  const fail = () => { try { onUnhealthy(); } catch {} throw failure(); };
  try {
    if (!page.isClosed?.()) {
      if (typeof page.goto !== 'function') throw failure();
      await deadline(() => page.goto('about:blank', { waitUntil: 'load', timeout: timeoutMs }), timeoutMs);
    }
  } catch { fail(); }
  try { await deadline(() => page.close(), timeoutMs); }
  catch { if (page.isClosed?.() !== true) fail(); }
}

module.exports = { closeGuardedPage };
