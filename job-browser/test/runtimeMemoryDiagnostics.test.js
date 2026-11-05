const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryLine, startMemoryDiagnostics } = require('../src/runtimeMemoryDiagnostics');

test('memory diagnostics expose only aggregate numbers', () => {
  const browser = { context: { pages: () => [{}, {}], _connection: { _objects: new Map([
    ['a', { _type: 'Response' }], ['b', { _type: 'WebSocketRoute' }], ['c', { _type: 'Response' }],
  ]) } }, foregroundQueue: [{}], backgroundQueue: [{}], activeOperations: 1 };
  assert.equal(memoryLine({ memory: { heapUsed: 1048576, heapTotal: 2097152, rss: 3145728, external: 0 }, browsers: [browser] }),
    'JOB_BROWSER_MEMORY heap_used_mib=1 heap_total_mib=2 rss_mib=3 external_mib=0 pages=2 queued=2 active=1 playwright_objects=3 playwright_responses=2 playwright_websockets=1');
});

test('memory diagnostics interval is unrefed and can be stopped', () => {
  let callback, cleared, unrefed = false, lines = [];
  const timer = { unref: () => { unrefed = true; } };
  const stop = startMemoryDiagnostics({ browsers: () => [], write: line => lines.push(line),
    setIntervalFn: fn => { callback = fn; return timer; }, clearIntervalFn: value => { cleared = value; } });
  callback(); stop();
  assert.equal(unrefed, true);
  assert.equal(cleared, timer);
  assert.match(lines[0], /^JOB_BROWSER_MEMORY (?:[a-z_]+=[0-9]+ ?)+$/);
});
