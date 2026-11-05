// Closed, aggregate counters only. Never log profile, request, or page contents.
function memoryLine({ memory = process.memoryUsage(), browsers = [] } = {}) {
  const mib = value => Math.max(0, Math.round(value / 1048576));
  let pages = 0, queued = 0, active = 0;
  const objects = browsers[0]?.context?._connection?._objects;
  const playwrightObjects = objects instanceof Map ? objects.size : 0;
  let playwrightResponses = 0, playwrightWebSockets = 0;
  if (objects instanceof Map) for (const object of objects.values()) {
    if (object?._type === 'Response') playwrightResponses++;
    if (object?._type === 'WebSocketRoute') playwrightWebSockets++;
  }
  for (const browser of browsers) {
    pages += browser.context?.pages?.().length || 0;
    queued += (browser.foregroundQueue?.length || 0) + (browser.backgroundQueue?.length || 0);
    active += browser.activeOperations || 0;
  }
  return `JOB_BROWSER_MEMORY heap_used_mib=${mib(memory.heapUsed)} heap_total_mib=${mib(memory.heapTotal)} rss_mib=${mib(memory.rss)} external_mib=${mib(memory.external)} pages=${pages} queued=${queued} active=${active} playwright_objects=${playwrightObjects} playwright_responses=${playwrightResponses} playwright_websockets=${playwrightWebSockets}`;
}

function startMemoryDiagnostics({ browsers, write = line => process.stderr.write(`${line}\n`), intervalMs = 300000,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  const report = () => { try { write(memoryLine({ browsers: browsers() })); } catch {} };
  const timer = setIntervalFn(report, intervalMs);
  timer.unref?.();
  report();
  return () => clearIntervalFn(timer);
}

module.exports = { memoryLine, startMemoryDiagnostics };
