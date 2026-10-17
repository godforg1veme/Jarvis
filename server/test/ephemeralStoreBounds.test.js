const assert = require('node:assert/strict');
const test = require('node:test');
const { FixedWindowRateLimiter } = require('../src/http/rateLimiter');
const { VisionLeaseStore, REQUEST_TTL_MS } = require('../src/vision/visionLeaseStore');

const device = { id: 'device-a', user_id: 'owner-a' };
function fixture(options = {}) {
  let time = 1000;
  let id = 0;
  const store = new VisionLeaseStore({ now: () => time, id: () => `id-${++id}`, ...options });
  const create = (durationMs = 3600000) => store.create({ ownerId: device.user_id, deviceId: device.id,
    sources: [{ sourceId: 'camera-a', type: 'camera', active: true, available: true, protected: false }], durationMs });
  const request = (lease) => store.createRequest({ leaseId: lease.leaseId, device, sourceId: 'camera-a' });
  const frame = (lease, capture, sequence = 1) => ({ leaseId: lease.leaseId, device, metadata: {
    leaseId: lease.leaseId, captureRequestId: capture.captureRequestId, sourceId: 'camera-a', mode: 'focused', sequence,
  } });
  return { store, create, request, frame, advance: (ms) => { time += ms; } };
}

test('rate limiter incrementally releases unrelated expired keys and stays bounded', () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ now: () => now, maxEntries: 1000 });
  for (let i = 0; i < 1000; i += 1) limiter.check(`old-${i}`);
  now = 60001;
  for (let i = 0; i < 40; i += 1) limiter.check(`new-${i}`);
  assert.equal(limiter.entries.size, 40);
});

test('rate capacity fails closed without evicting live limit counters, then recovers', () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ now: () => now, maxEntries: 2 });
  limiter.check('first', { limit: 1 });
  limiter.check('second');
  assert.throws(() => limiter.check('third'), (e) => e.statusCode === 429);
  assert.throws(() => limiter.check('first', { limit: 1 }), (e) => e.statusCode === 429);
  assert.equal(limiter.entries.size, 2);
  now = 60000;
  assert.doesNotThrow(() => limiter.check('third'));
});

test('vision incrementally releases expired unrelated leases and stopped leases', () => {
  const f = fixture();
  for (let i = 0; i < 100; i += 1) f.create(30000);
  f.advance(30000);
  for (let i = 0; i < 10; i += 1) f.create();
  assert.equal(f.store.leases.size, 10);
  const stopped = f.create();
  assert.equal(f.store.stop({ leaseId: stopped.leaseId, device }).state, 'off');
  for (let i = 0; i < 10; i += 1) f.create();
  assert.equal(f.store.leases.has(stopped.leaseId), false);
});

test('vision capacity rejects new leases without replacing live records', () => {
  const f = fixture({ maxLeases: 2 });
  const first = f.create(); f.create();
  assert.throws(() => f.create(), (e) => e.statusCode === 503 && e.publicCode === 'VISION_LEASE_CAPACITY');
  assert.equal(f.store.leases.size, 2);
  assert.equal(f.store.getAuthorized(first.leaseId, device).id, first.leaseId);
  f.advance(3600000);
  assert.doesNotThrow(() => f.create());
});

test('expired requests and consumed replay records are released, stale IDs never execute', () => {
  const f = fixture(); const lease = f.create();
  const captures = Array.from({ length: 100 }, () => f.request(lease));
  f.store.acceptFrame(f.frame(lease, captures[0], 5));
  f.advance(REQUEST_TTL_MS);
  for (let i = 0; i < 10; i += 1) f.request(lease);
  assert.equal(f.store.getAuthorized(lease.leaseId, device).requests.size, 10);
  for (const capture of captures) {
    assert.throws(() => f.store.acceptFrame(f.frame(lease, capture, 6)), /VISION_CAPTURE_REQUEST_INVALID/);
  }
  const fresh = f.request(lease);
  assert.throws(() => f.store.acceptFrame(f.frame(lease, fresh, 5)), /VISION_SEQUENCE_REPLAY/);
  assert.doesNotThrow(() => f.store.acceptFrame(f.frame(lease, fresh, 6)));
});

test('request capacity retains unexpired consumed IDs and scope checks', () => {
  const f = fixture({ maxRequestsPerLease: 2 }); const lease = f.create();
  const capture = f.request(lease); f.request(lease);
  f.store.acceptFrame(f.frame(lease, capture));
  assert.throws(() => f.request(lease), (e) => e.statusCode === 503 && e.publicCode === 'VISION_REQUEST_CAPACITY');
  assert.throws(() => f.store.acceptFrame(f.frame(lease, capture)), /VISION_CAPTURE_REPLAY/);
  assert.throws(() => f.store.getAuthorized(lease.leaseId, { ...device, id: 'foreign' }), /VISION_DEVICE_MISMATCH/);
  assert.throws(() => f.store.getAuthorized(lease.leaseId, { ...device, user_id: 'foreign' }), /VISION_OWNER_MISMATCH/);
  f.advance(REQUEST_TTL_MS);
  assert.doesNotThrow(() => f.request(lease));
});

test('direct expired access keeps 410; reclaimed expired IDs fail closed with 404/409', () => {
  const f = fixture(); const lease = f.create(30000); const capture = f.request(lease);
  f.advance(30000);
  assert.throws(() => f.store.getAuthorized(lease.leaseId, device), (e) => e.statusCode === 410);
  f.create();
  assert.throws(() => f.store.getAuthorized(lease.leaseId, device), (e) => e.statusCode === 404);
  assert.throws(() => f.store.acceptFrame(f.frame(lease, capture)), (e) => e.statusCode === 404);
});

test('fixed work budget sweeps old records behind live keys without eviction', () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ now: () => now, maxEntries: 200 });
  for (let i = 0; i < 100; i += 1) limiter.check(`live-${i}`, { windowMs: 3600000 });
  for (let i = 0; i < 100; i += 1) limiter.check(`expired-${i}`, { windowMs: 1000 });
  now = 2000;
  let visits = 0;
  const entries = limiter.entries.entries.bind(limiter.entries);
  limiter.entries.entries = () => {
    const iterator = entries();
    return { next() { visits += 1; return iterator.next(); } };
  };
  limiter.sweepCursor = limiter.entries.entries();
  for (let i = 0; i < 10; i += 1) {
    const previous = visits;
    limiter.check('live-0', { limit: 100 });
    assert.ok(visits - previous <= 65, 'at most 64 records plus iterator reset');
  }
  assert.equal(limiter.entries.size, 100);
  assert.ok([...limiter.entries.keys()].every((key) => key.startsWith('live-')));
});

test('long-running device churn and request churn stay within configured bounds', () => {
  const f = fixture({ maxLeases: 4, maxRequestsPerLease: 4 });
  for (let cycle = 0; cycle < 200; cycle += 1) {
    const lease = f.create(3600000);
    for (let turn = 0; turn < 4; turn += 1) {
      const capture = f.request(lease);
      f.store.acceptFrame(f.frame(lease, capture, turn + 1));
      f.advance(REQUEST_TTL_MS);
      assert.ok(f.store.getAuthorized(lease.leaseId, device).requests.size <= 4);
    }
    f.store.stop({ leaseId: lease.leaseId, device });
    assert.ok(f.store.leases.size <= 4);
  }
});

test('expired pending capture remains rejected and its 410 error is preserved before reclamation', () => {
  const f = fixture(); const lease = f.create(); const capture = f.request(lease);
  f.advance(REQUEST_TTL_MS);
  assert.throws(() => f.store.acceptFrame(f.frame(lease, capture)), (e) => e.statusCode === 410 && e.publicCode === 'VISION_CAPTURE_REQUEST_EXPIRED');
  f.request(lease);
  assert.throws(() => f.store.acceptFrame(f.frame(lease, capture)), /VISION_CAPTURE_REQUEST_INVALID/);
});

test('capacity configuration cannot disable memory bounds', () => {
  for (const capacity of [0, -1, Infinity, NaN, 1.5, '2']) {
    assert.throws(() => new FixedWindowRateLimiter({ maxEntries: capacity }), TypeError);
    assert.throws(() => new VisionLeaseStore({ maxLeases: capacity }), TypeError);
    assert.throws(() => new VisionLeaseStore({ maxRequestsPerLease: capacity }), TypeError);
  }
});

test('store gauges expose only bounded aggregate sizes for diagnostics', () => {
  const limiter = new FixedWindowRateLimiter({ maxEntries: 3 });
  limiter.check('private-key');
  assert.deepEqual(limiter.getStats(), { entries: 1, maxEntries: 3 });
  const f = fixture({ maxLeases: 3, maxRequestsPerLease: 4 }); const lease = f.create();
  f.request(lease);
  assert.deepEqual(f.store.getStats(), { leases: 1, requests: 1, maxLeases: 3, maxRequestsPerLease: 4 });
  f.store.stop({ leaseId: lease.leaseId, device });
  assert.equal(f.store.getStats().requests, 0);
});
