const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createLifeDeviceActions } = require('../src/miniApp/lifeDeviceActions');

const actor = { userId: randomUUID(), telegramId: '123456789' };
const session = { token: 'a'.repeat(64) };
const operationId = randomUUID();
const db = { async query() { return { rows: [], rowCount: 0 }; } };

test('disabled life services leave device actions usable', async () => {
  const deviceService = { repository: {}, list: async () => [] };
  const actions = createLifeDeviceActions({ deviceService });
  assert.ok(actions.devices);
  assert.equal(actions.life, null);
  assert.equal(createLifeDeviceActions({}).devices, null);
});

test('pair code remains encrypted in stored receipt and scoped to its session and pending code', async () => {
  const pairingId = randomUUID();
  let pending = true;
  const deviceService = {
    repository: { async getPairingCodeForUser({ userId, pairingId: requested }) {
      assert.equal(userId, actor.userId);
      assert.equal(requested, pairingId);
      return { id: pairingId, consumed_at: pending ? null : new Date(), expires_at: new Date(Date.now() + 60000) };
    } },
    async beginPairing({ userId, deviceName, db: suppliedDb }) {
      assert.equal(userId, actor.userId);
      assert.equal(deviceName, 'Home PC');
      assert.equal(suppliedDb, db);
      return { pairingId, code: 'PAIR-SECRET-CODE', expiresAt: new Date(Date.now() + 60000) };
    },
  };
  const { devices } = createLifeDeviceActions({ deviceService });
  const command = { operationId, kind: 'pair', targetId: null, revision: null, input: { name: 'Home PC' } };
  const stored = (await devices.execute({ db, actor, session, command })).result;
  assert.equal(JSON.stringify(stored).includes('PAIR-SECRET-CODE'), false);
  const { createHash, createDecipheriv } = require('node:crypto');
  // The session's database token_hash must not also be the encryption key.
  assert.throws(() => {
    const cipher = stored.codeCipher;
    const leakedHash = createHash('sha256').update(session.token).digest();
    const decipher = createDecipheriv('aes-256-gcm', leakedHash, Buffer.from(cipher.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(cipher.tag, 'base64'));
    decipher.update(Buffer.from(cipher.ciphertext, 'base64')); decipher.final();
  });
  assert.equal((await devices.publicResult(stored, { db, actor, session })).code, 'PAIR-SECRET-CODE');
  assert.deepEqual((await devices.publicResult(stored, { db, actor, session: { token: 'b'.repeat(64) } })).codeAvailable, false);
  pending = false;
  assert.equal((await devices.publicResult(stored, { db, actor, session })).codeAvailable, false);
});

test('device revoke checks stable name revision and owner-scoped target', async () => {
  const deviceId = randomUUID();
  let revoked = false;
  const deviceService = {
    repository: { async getForUser({ userId, deviceId: requested, db: suppliedDb }) {
      assert.equal(userId, actor.userId);
      assert.equal(requested, deviceId);
      assert.equal(suppliedDb, db);
      return { id: deviceId, name: 'Laptop', status: 'online' };
    } },
    async revoke({ userId, deviceId: requested, db: suppliedDb }) {
      assert.equal(userId, actor.userId);
      assert.equal(requested, deviceId);
      assert.equal(suppliedDb, db);
      revoked = true;
      return { id: deviceId, name: 'Laptop', status: 'revoked' };
    },
  };
  const { devices } = createLifeDeviceActions({ deviceService });
  const target = await devices.target({ db, actor, targetId: deviceId, kind: 'revoke' });
  await assert.rejects(() => devices.execute({ db, actor, session,
    command: { operationId, kind: 'revoke', targetId: deviceId, revision: '0'.repeat(64), input: {} } }),
  { code: 'revision_conflict' });
  assert.equal(revoked, false);
  const done = await devices.execute({ db, actor, session,
    command: { operationId, kind: 'revoke', targetId: deviceId, revision: target.revision, input: {} } });
  assert.equal(done.result.status, 'revoked');
  assert.equal(revoked, true);
});

test('reminder creation requires owned private Telegram conversation and records life_os origin', async () => {
  const conversationId = randomUUID();
  let found = false, created = false;
  const connection = { async query(sql, args) {
    if (sql.includes('FROM conversations c JOIN')) {
      assert.deepEqual(args, [actor.userId, actor.telegramId]);
      return { rows: found ? [{ id: conversationId }] : [], rowCount: found ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const reminderService = { async create(input) {
    created = true;
    assert.equal(input.db, connection);
    assert.deepEqual(input.origin, { channel: 'life_os', conversationId });
    assert.equal(input.input.requestId, operationId);
    assert.deepEqual(input.input.deliveryChannels, ['telegram']);
    assert.equal(input.input.triggerAt, '2026-10-28T07:00:00.000Z');
    return { id: randomUUID(), title: input.input.title, state: 'scheduled', trigger_at: input.input.triggerAt, revision: 1 };
  }, async _record() {} };
  const { life } = createLifeDeviceActions({ reminderService,
    reminderRepository: {}, commitmentRepository: {}, commitmentLifecycleService: {}, missionControlService: {} });
  const command = { operationId, kind: 'reminder.create', targetId: null, revision: null,
    input: { title: 'Call home', triggerAt: '2026-10-28T10:00:00+03:00' } };
  await assert.rejects(() => life.execute({ db: connection, actor, session, command }), { code: 'not_found' });
  assert.equal(created, false);
  found = true;
  const done = await life.execute({ db: connection, actor, session, command });
  assert.equal(done.result.type, 'reminder');
  assert.equal(created, true);
});

test('commitment transition uses owner, revision and the outer database transaction', async () => {
  const commitmentId = randomUUID();
  let updates = 0;
  const commitmentRepository = {
    async get({ userId, commitmentId: requested, db: suppliedDb }) {
      assert.equal(userId, actor.userId);
      assert.equal(requested, commitmentId);
      assert.equal(suppliedDb, db);
      return { id: commitmentId, title: 'Submit report', status: 'open', revision: 4 };
    },
    async transition(input) {
      updates++;
      assert.equal(input.db, db);
      assert.equal(input.status, 'completed');
      return { id: commitmentId, title: 'Submit report', status: 'completed', revision: 5 };
    },
  };
  const commitmentLifecycleService = {
    async transitionFromUserAction(input) { return commitmentRepository.transition(input); },
    async recordUserTransition() {},
  };
  const { life } = createLifeDeviceActions({ reminderService: {}, reminderRepository: {}, commitmentRepository,
    commitmentLifecycleService, missionControlService: {} });
  await assert.rejects(() => life.execute({ db, actor, command: { operationId, kind: 'commitment.complete', targetId: commitmentId, revision: 3, input: {} } }),
  { code: 'revision_conflict' });
  assert.equal(updates, 0);
  const done = await life.execute({ db, actor, command: { operationId, kind: 'commitment.complete', targetId: commitmentId, revision: 4, input: {} } });
  assert.equal(done.result.status, 'completed');
  assert.equal(updates, 1);
});
