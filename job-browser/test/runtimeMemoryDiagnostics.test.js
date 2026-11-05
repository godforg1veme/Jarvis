const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryLine, startMemoryDiagnostics } = require('../src/runtimeMemoryDiagnostics');

test('memory diagnostics expose only aggregate numbers', () => {
  const browser = { context: { pages: () => [{}, {}], _connection: { _objects: new Map([
    ['a', { _type: 'Response' }], ['b', { _type: 'WebSocketRoute' }], ['c', { _type: 'Response' }],
  ]) } }, foregroundQueue: [{}], backgroundQueue: [{}], activeOperations: 1 };
  assert.equal(memoryLine({ memory: { heapUsed: 1048576, heapTotal: 2097152, rss: 3145728, external: 0 }, browsers: [browser],
    heapSpaces: [{ space_name: 'large_object_space', space_used_size: 4194304 }, { space_name: 'code_space', space_used_size: 1048576 }],
    heapStats: { number_of_native_contexts: 3, number_of_detached_contexts: 0, total_global_handles_size: 2097152 } }),
    'JOB_BROWSER_MEMORY heap_used_mib=1 heap_total_mib=2 rss_mib=3 external_mib=0 large_object_mib=4 code_space_mib=1 native_contexts=3 detached_contexts=0 global_handles_mib=2 pages=2 queued=2 active=1 playwright_objects=3 playwright_responses=2 playwright_websockets=1 server_available=0 server_fetch_responses=-1 server_fetch_log=-1 server_dispatchers=-1 server_active_calls=-1');
});

test('memory diagnostics interval is unrefed and can be stopped', () => {
  let callback, cleared, unrefed = false, lines = [];
  const timer = { unref: () => { unrefed = true; } };
  const stop = startMemoryDiagnostics({ browsers: () => [], write: line => lines.push(line),
    setIntervalFn: fn => { callback = fn; return timer; }, clearIntervalFn: value => { cleared = value; } });
  callback(); stop();
  assert.equal(unrefed, true);
  assert.equal(cleared, timer);
  assert.match(lines[0], /^JOB_BROWSER_MEMORY (?:[a-z_]+=-?[0-9]+ ?)+$/);
});

test('server counters expose only sizes for every context and connection', () => {
  const owner = { fetchRequest: { fetchResponses: new Map([['private', {}]]), fetchLog: new Map([['private', []]]) } };
  const member = { fetchRequest: { fetchResponses: new Map([['other', {}]]), fetchLog: new Map() } };
  const dispatcher = { _dispatcherByGuid: new Map([['private', {}], ['other', {}]]),
    _activeProgressControllers: new Map([['private', {}]]) };
  const connection = { _objects: new Map(), toImpl: value => value === connection ? dispatcher : value === ownerBrowser.context ? owner : member };
  const ownerBrowser = { context: { pages: () => [], _connection: connection }, activeOperations: 0 };
  const memberBrowser = { context: { pages: () => [], _connection: connection }, activeOperations: 0 };
  const line = memoryLine({ memory: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0 }, browsers: [ownerBrowser, memberBrowser] });
  assert.match(line, /server_available=1 server_fetch_responses=2 server_fetch_log=1 server_dispatchers=2 server_active_calls=1$/);
  assert.equal(line.includes('private'), false);
  assert.equal(line.includes('other'), false);
});
