const assert = require('node:assert');
const {
  ACTIVE_IDLE_MS,
  HARD_LEASE_MS,
  SHORT_LEASE_MS,
  VisionPrivacyController,
} = require('../vision/visionPrivacyController');

let now = Date.parse('2026-09-09T12:00:00.000Z');
const opened = [];
const closed = [];
const states = [];
const controller = new VisionPrivacyController({
  now: () => now,
  createId: () => 'lease-test-1',
  openSources: async (value) => { opened.push(value); },
  closeSources: async (value) => { closed.push(value); },
  onState: (value) => { states.push(value.state); },
});
const camera = { sourceId: 'camera-1', type: 'camera', available: true };
const workspace = { sourceId: 'workspace-1', type: 'screen_workspace', available: true };

assert.rejects(() => controller.startLocal({ ownerId: 'owner-1', sources: [camera] }), /explicit local visual intent/);

(async () => {
  const active = await controller.startLocal({
    ownerId: 'owner-1',
    kind: 'active',
    explicitIntent: true,
    sources: [camera, workspace],
  });
  assert.strictEqual(active.state, 'active');
  assert.strictEqual(active.idleExpiresAt, new Date(now + ACTIVE_IDLE_MS).toISOString());
  assert.strictEqual(active.hardExpiresAt, new Date(now + HARD_LEASE_MS).toISOString());
  assert.strictEqual(opened.length, 1);
  assert.deepStrictEqual(active.sourceIds, ['camera-1', 'workspace-1']);
  assert.rejects(() => controller.startLocal({
    ownerId: 'owner-1', kind: 'short', explicitIntent: true, sources: [camera],
  }), /already active/);
  assert.throws(() => controller.use({ ownerId: 'owner-2' }), /owner mismatch/);

  const beforeRemote = controller.getState().idleExpiresAt;
  now += 60 * 1000;
  controller.use({ ownerId: 'owner-1', origin: 'remote' });
  assert.strictEqual(controller.getState().idleExpiresAt, beforeRemote);
  controller.use({ ownerId: 'owner-1', origin: 'local' });
  assert.strictEqual(controller.getState().idleExpiresAt, new Date(now + ACTIVE_IDLE_MS).toISOString());

  await controller.interrupt('wss_disconnect');
  assert.strictEqual(controller.getState().state, 'off');
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(closed[0].reason, 'wss_disconnect');
  assert.deepStrictEqual(states.slice(0, 2), ['starting', 'active']);

  const short = await controller.startLocal({
    ownerId: 'owner-1', kind: 'short', explicitIntent: true, sources: [camera],
  });
  assert.strictEqual(short.idleExpiresAt, new Date(now + SHORT_LEASE_MS).toISOString());
  now += SHORT_LEASE_MS + 1;
  await controller.checkExpiry();
  assert.strictEqual(controller.getState().state, 'off');
  assert.strictEqual(closed.at(-1).reason, 'idle_expiry');

  const failing = new VisionPrivacyController({
    createId: () => 'lease-failing',
    openSources: async () => { throw new Error('camera busy'); },
    closeSources: async (value) => { closed.push(value); },
  });
  await assert.rejects(() => failing.startLocal({
    ownerId: 'owner-1', explicitIntent: true, sources: [camera],
  }), /camera busy/);
  assert.strictEqual(failing.getState().state, 'off');

  const multiCamera = new VisionPrivacyController({ createId: () => 'lease-multi' });
  await assert.rejects(() => multiCamera.startLocal({
    ownerId: 'owner-1', explicitIntent: true,
    sources: [camera, { sourceId: 'camera-2', type: 'camera', available: true }],
  }), /only one camera/);

  console.log('[testVisionPrivacyController] vision privacy controller tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

