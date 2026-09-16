const test = require('node:test');
const assert = require('node:assert/strict');
const { VpnSubscriptionRepository } = require('../src/vpn/vpnSubscriptionRepository');

test('VpnSubscriptionRepository creates and finds active subscription by hash', async () => {
  const rows = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO vpn_subscriptions')) {
        const record = {
          id: 'test-sub-1',
          user_id: params[0],
          label: params[1],
          token_hash: params[2],
          client_id_de: params[3],
          client_id_nl: params[4],
          created_by: params[5],
          created_at: new Date('2026-09-16T12:00:00Z'),
          revoked_at: null,
          last_accessed_at: null,
        };
        rows.push(record);
        return { rows: [record] };
      }
      if (sql.includes('SELECT') && sql.includes('token_hash = $1')) {
        const found = rows.find(r => r.token_hash === params[0] && !r.revoked_at);
        return { rows: found ? [found] : [] };
      }
      return { rows: [] };
    },
  };
  const repo = new VpnSubscriptionRepository({ pool });
  const created = await repo.create({
    userId: 'u1',
    label: 'iPhone',
    tokenHash: 'hash123',
    clientIdDe: 'c-de',
    clientIdNl: 'c-nl',
    createdBy: 'u1',
  });
  assert.equal(created.id, 'test-sub-1');
  assert.equal(created.userId, 'u1');
  assert.equal(created.user_id, 'u1');
  assert.equal(created.tokenHash, 'hash123');
  assert.equal(created.token_hash, 'hash123');
  assert.equal(created.clientIdDe, 'c-de');
  assert.equal(created.clientIdNl, 'c-nl');
  assert.equal(created.createdBy, 'u1');

  const active = await repo.findActiveByTokenHash('hash123');
  assert.ok(active);
  assert.equal(active.label, 'iPhone');
  assert.equal(active.id, 'test-sub-1');

  const missing = await repo.findActiveByTokenHash('unknown');
  assert.equal(missing, null);
});

test('findActiveByTokenHash ignores revoked subscriptions and missing tokens', async () => {
  const rows = [
    {
      id: 'sub-revoked',
      user_id: 'u1',
      label: 'Old Phone',
      token_hash: 'revoked_hash',
      client_id_de: 'c1',
      client_id_nl: 'c2',
      created_by: 'u1',
      created_at: new Date('2026-09-16T10:00:00Z'),
      revoked_at: new Date('2026-09-16T11:00:00Z'),
      last_accessed_at: null,
    },
  ];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('token_hash = $1') && sql.includes('revoked_at IS NULL')) {
        const found = rows.find(r => r.token_hash === params[0] && !r.revoked_at);
        return { rows: found ? [found] : [] };
      }
      return { rows: [] };
    },
  };

  const repo = new VpnSubscriptionRepository({ pool });
  assert.equal(await repo.findActiveByTokenHash('revoked_hash'), null);
  assert.equal(await repo.findActiveByTokenHash(''), null);
  assert.equal(await repo.findActiveByTokenHash(null), null);
});

test('listByUser returns user subscriptions in descending order', async () => {
  const queries = [];
  const records = [
    {
      id: 'sub-2',
      user_id: 'user-123',
      label: 'iPad',
      token_hash: 'hash-2',
      client_id_de: 'de-2',
      client_id_nl: 'nl-2',
      created_by: 'user-123',
      created_at: new Date('2026-09-16T14:00:00Z'),
      revoked_at: null,
      last_accessed_at: null,
    },
    {
      id: 'sub-1',
      user_id: 'user-123',
      label: 'iPhone',
      token_hash: 'hash-1',
      client_id_de: 'de-1',
      client_id_nl: 'nl-1',
      created_by: 'user-123',
      created_at: new Date('2026-09-16T10:00:00Z'),
      revoked_at: new Date('2026-09-16T12:00:00Z'),
      last_accessed_at: null,
    },
  ];

  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: records };
    },
  };

  const repo = new VpnSubscriptionRepository({ pool });
  const result = await repo.listByUser('user-123');
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'sub-2');
  assert.equal(result[1].id, 'sub-1');
  assert.match(queries[0].sql, /WHERE user_id = \$1/);
  assert.match(queries[0].sql, /ORDER BY created_at DESC/);
  assert.deepEqual(queries[0].params, ['user-123']);

  // Invalid userId returns empty array
  assert.deepEqual(await repo.listByUser(''), []);
  assert.deepEqual(await repo.listByUser(null), []);
});

test('touchLastAccessed updates last_accessed_at', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };

  const repo = new VpnSubscriptionRepository({ pool });
  await repo.touchLastAccessed('sub-123');

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE vpn_subscriptions/);
  assert.match(queries[0].sql, /SET last_accessed_at = NOW\(\)/);
  assert.match(queries[0].sql, /WHERE id = \$1/);
  assert.deepEqual(queries[0].params, ['sub-123']);

  await assert.rejects(
    () => repo.touchLastAccessed(''),
    /Subscription id is required/
  );
});

test('revoke sets revoked_at atomically and respects user scoping', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      // Simulate successful revoke if matching
      if (params[0] === 'active-sub' && params[1] === 'owner-1') {
        return { rowCount: 1, rows: [{ id: 'active-sub' }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const repo = new VpnSubscriptionRepository({ pool });

  // Successful revocation with user scoping
  const revoked = await repo.revoke({ id: 'active-sub', userId: 'owner-1' });
  assert.equal(revoked, true);
  assert.match(queries[0].sql, /SET revoked_at = NOW\(\)/);
  assert.match(queries[0].sql, /WHERE id = \$1 AND user_id = \$2 AND revoked_at IS NULL/);
  assert.deepEqual(queries[0].params, ['active-sub', 'owner-1']);

  // Failed revocation (wrong user or already revoked)
  const failed = await repo.revoke({ id: 'active-sub', userId: 'wrong-user' });
  assert.equal(failed, false);

  // Revocation without userId scoping (e.g. system admin)
  const revokedAdmin = await repo.revoke({ id: 'active-sub' });
  assert.equal(revokedAdmin, false); // rowCount 0 in mock for 1 param
  assert.match(queries[2].sql, /WHERE id = \$1 AND revoked_at IS NULL/);
  assert.deepEqual(queries[2].params, ['active-sub']);

  await assert.rejects(
    () => repo.revoke({ id: '' }),
    /Subscription id is required/
  );
});

test('findById returns subscription by id or null if missing', async () => {
  const pool = {
    query: async (sql, params) => {
      if (params[0] === 'sub-found') {
        return {
          rows: [{
            id: 'sub-found',
            user_id: 'u1',
            label: 'Desktop',
            token_hash: 'hash-xyz',
            client_id_de: null,
            client_id_nl: null,
            created_by: 'u1',
            created_at: new Date('2026-09-16T12:00:00Z'),
            revoked_at: null,
            last_accessed_at: null,
          }],
        };
      }
      return { rows: [] };
    },
  };

  const repo = new VpnSubscriptionRepository(pool);
  const record = await repo.findById('sub-found');
  assert.equal(record.id, 'sub-found');
  assert.equal(record.label, 'Desktop');
  assert.equal(record.tokenHash, 'hash-xyz');

  assert.equal(await repo.findById('non-existent'), null);
  assert.equal(await repo.findById(''), null);
  assert.equal(await repo.findById(null), null);
});

test('create validates required parameters and escapes sensitive inputs', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const repo = new VpnSubscriptionRepository(pool);

  await assert.rejects(() => repo.create({ label: 'x', tokenHash: 'h', createdBy: 'u' }), /userId must be a non-empty string/);
  await assert.rejects(() => repo.create({ userId: 'u', tokenHash: 'h', createdBy: 'u' }), /label must be a non-empty string/);
  await assert.rejects(() => repo.create({ userId: 'u', label: 'l', createdBy: 'u' }), /tokenHash must be a non-empty string/);
  await assert.rejects(() => repo.create({ userId: 'u', label: 'l', tokenHash: 'h' }), /createdBy must be a non-empty string/);
});

test('constructor validates database pool', () => {
  assert.throws(() => new VpnSubscriptionRepository(), /requires a database pool/);
  assert.throws(() => new VpnSubscriptionRepository({}), /requires a database pool/);
  assert.doesNotThrow(() => new VpnSubscriptionRepository({ query: () => {} }));
  assert.doesNotThrow(() => new VpnSubscriptionRepository({ pool: { query: () => {} } }));
});
