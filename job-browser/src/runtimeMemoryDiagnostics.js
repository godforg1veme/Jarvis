// Closed, aggregate counters only. Never log profile, request, or page contents.
const v8 = require('node:v8');

function memoryLine({ memory = process.memoryUsage(), browsers = [],
  heapSpaces = v8.getHeapSpaceStatistics(), heapStats = v8.getHeapStatistics() } = {}) {
  const mib = value => Math.max(0, Math.round(value / 1048576));
  const size = value => Number.isSafeInteger(value) && value >= 0 ? mib(value) : -1;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : -1;
  const space = name => size(heapSpaces?.find(item => item.space_name === name)?.space_used_size);
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
  let serverAvailable = 0, serverFetchResponses = -1, serverFetchLog = -1, serverRoutesInFlight = -1;
  let serverDispatchers = -1, serverActiveCalls = -1;
  try {
    const connection = browsers[0]?.context?._connection;
    const dispatcher = connection?.toImpl?.(connection);
    if (dispatcher?._dispatcherByGuid instanceof Map && dispatcher?._activeProgressControllers instanceof Map) {
      serverDispatchers = dispatcher._dispatcherByGuid.size;
      serverActiveCalls = dispatcher._activeProgressControllers.size;
      const contexts = browsers.map(browser => connection.toImpl(browser.context));
      if (contexts.every(context => context?.fetchRequest?.fetchResponses instanceof Map
        && context.fetchRequest.fetchLog instanceof Map && context._routesInFlight instanceof Set)) {
        serverFetchResponses = contexts.reduce((total, context) => total + context.fetchRequest.fetchResponses.size, 0);
        serverFetchLog = contexts.reduce((total, context) => total + context.fetchRequest.fetchLog.size, 0);
        serverRoutesInFlight = contexts.reduce((total, context) => total + context._routesInFlight.size, 0);
        serverAvailable = 1;
      }
    }
  } catch {}
  return `JOB_BROWSER_MEMORY heap_used_mib=${mib(memory.heapUsed)} heap_total_mib=${mib(memory.heapTotal)} rss_mib=${mib(memory.rss)} external_mib=${mib(memory.external)} large_object_mib=${space('large_object_space')} code_space_mib=${space('code_space')} native_contexts=${count(heapStats?.number_of_native_contexts)} detached_contexts=${count(heapStats?.number_of_detached_contexts)} global_handles_mib=${size(heapStats?.total_global_handles_size)} pages=${pages} queued=${queued} active=${active} playwright_objects=${playwrightObjects} playwright_responses=${playwrightResponses} playwright_websockets=${playwrightWebSockets} server_available=${serverAvailable} server_fetch_responses=${serverFetchResponses} server_fetch_log=${serverFetchLog} server_routes_inflight=${serverRoutesInFlight} server_dispatchers=${serverDispatchers} server_active_calls=${serverActiveCalls}`;
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
