const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { Pool } = require('pg');
const { runMigrations } = require('../src/db/migrate');
const { SectionReader } = require('../src/miniApp/sectionReader');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');
const url = process.env.JARVIS_MINI_TEST_DATABASE_URL;

test('Mini App paging uses real migrated PostgreSQL, exact timestamps and owner scope', { skip: !url }, async (t) => {
  const schema = `mini_pages_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
  try {
    await runMigrations(pool);
    const ids = (await pool.query("INSERT INTO users(display_name,role) VALUES('Paging owner','owner'),('Other user','member') RETURNING id")).rows;
    const userId = ids[0].id; const foreignId = ids[1].id;
    const conversationId = (await pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'pwa','mini') RETURNING id", [userId])).rows[0].id;
    const otherConversation = (await pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','123') RETURNING id", [userId])).rows[0].id;
    for (const [owner, count] of [[userId, 65], [foreignId, 5]]) {
      await pool.query(`INSERT INTO memories(user_id,kind,content,created_at)
        SELECT $1,'fact','Memory '||i,'2026-10-01 10:00:00.123456+00'::timestamptz FROM generate_series(1,$2) i`, [owner, count]);
      await pool.query(`INSERT INTO documents(user_id,original_name,media_type,storage_key,byte_size,sha256,status,created_at)
        SELECT $1,'Document '||i,'text/plain',gen_random_uuid()::text,10,$3,'ready',
        '2026-10-01 10:00:00.123456+00'::timestamptz FROM generate_series(1,$2) i`, [owner, count, randomBytes(32)]);
      for (let i = 0; i < count; i++) await pool.query(`INSERT INTO devices(user_id,name,token_hash,created_at)
        VALUES($1,$2,$3,'2026-10-01 10:00:00.123456+00')`, [owner, `Device ${i}`, randomBytes(32)]);
      const events = await pool.query(`INSERT INTO life_events(user_id,event_type,occurred_at,source_channel,source_ref,deduplication_key,summary)
        SELECT $1,'commitment.detected',now(),'life_os',i::text,i::text,'Fixture' FROM generate_series(1,$2) i RETURNING id`, [owner, count]);
      for (const event of events.rows) await pool.query(`INSERT INTO life_commitments(user_id,source_event_id,title,confidence,created_at)
        VALUES($1,$2,'Commitment',1,'2026-10-01 10:00:00.123456+00')`, [owner, event.id]);
    }
    await pool.query("INSERT INTO memories(user_id,kind,content,active) VALUES($1,'fact','Inactive',false)", [userId]);
    await pool.query(`INSERT INTO documents(user_id,original_name,media_type,storage_key,byte_size,sha256,status)
      VALUES($1,'Deleted','text/plain',gen_random_uuid()::text,10,$2,'deleted')`, [userId, randomBytes(32)]);
    await pool.query("INSERT INTO devices(user_id,name,token_hash,status) VALUES($1,'Revoked',$2,'revoked')", [userId, randomBytes(32)]);
    await pool.query(`INSERT INTO messages(user_id,conversation_id,role,content,created_at)
      SELECT $1,$2,'user','Message '||i,'2026-10-01 10:00:00.123456+00'::timestamptz FROM generate_series(1,65) i`, [userId, conversationId]);
    await pool.query("INSERT INTO messages(user_id,conversation_id,role,content) VALUES($1,$2,'assistant','Other channel')", [userId, otherConversation]);
    let now = Date.now(); const reader = new SectionReader({ pool, now: () => now });

    await t.test('all four sections traverse 65 records without duplicates or private fields', async () => {
      for (const section of ['memory', 'documents', 'devices', 'life']) {
        let cursor = null; const rows = []; const lengths = [];
        do {
          const page = await reader.read({ userId, section, cursor });
          lengths.push(page.items.length); rows.push(...page.items); cursor = page.paging.nextCursor;
        } while (cursor);
        assert.deepEqual(lengths, [30, 30, 5]);
        assert.equal(new Set(rows.map((row) => row.id)).size, 65);
        for (const row of rows) {
          assert.ok(Object.keys(row).every((key) => ['id', 'title', 'detail', ...(section === 'memory' ? ['expectedDigest'] : []), ...(section === 'life' ? ['resourceType'] : [])].includes(key)));
          if (section === 'memory') assert.equal(row.expectedDigest, createHash('sha256').update(row.title, 'utf8').digest('hex'));
        }
        const ownerRows = (await pool.query(`SELECT id FROM ${section === 'memory' ? 'memories' : section === 'life' ? 'life_commitments' : section} WHERE user_id=$1`, [userId])).rows;
        const ownerIds = new Set(ownerRows.map((row) => row.id));
        assert.ok(rows.every((row) => ownerIds.has(row.id)), 'no foreign records');
      }
    });

    await t.test('cursor cannot cross user, section, conversation, expiry or syntax boundaries', async () => {
      const cursor = (await reader.read({ userId, section: 'memory' })).paging.nextCursor;
      for (const input of [{ userId: foreignId, section: 'memory', cursor }, { userId, section: 'documents', cursor },
        { userId, section: 'memory', cursor: 'forged' }]) await assert.rejects(reader.read(input), { code: 'invalid_request' });
      now += 600001;
      await assert.rejects(reader.read({ userId, section: 'memory', cursor }), { code: 'invalid_request' });
    });

    await t.test('history traverses only Mini App conversation in chronological page order', async () => {
      const page = await reader.read({ userId, section: 'assistant', conversationId });
      assert.equal(page.messages.length, 30);
      assert.equal(page.messages.some((row) => row.content === 'Other channel'), false);
      const previous = await reader.read({ userId, section: 'assistant', conversationId, cursor: page.paging.nextCursor });
      assert.equal(previous.messages.length, 30);
      assert.ok(BigInt(previous.messages.at(-1).id) < BigInt(page.messages[0].id));
      await assert.rejects(reader.read({ userId, section: 'assistant', conversationId: otherConversation, cursor: page.paging.nextCursor }), { code: 'invalid_request' });
      const oldest = await reader.read({ userId, section: 'assistant', conversationId, cursor: previous.paging.nextCursor });
      assert.equal(oldest.messages.length, 5); assert.equal(oldest.paging.nextCursor, null);
    });

    await t.test('new records require refresh; removed records do not shift a later page', async () => {
      const first = await reader.read({ userId, section: 'memory' });
      const remaining = (await reader.read({ userId, section: 'memory', cursor: first.paging.nextCursor })).items;
      await pool.query('UPDATE memories SET active=false WHERE id=$1 AND user_id=$2', [remaining[0].id, userId]);
      await pool.query("INSERT INTO memories(user_id,kind,content) VALUES($1,'fact','New after refresh')", [userId]);
      const next = await reader.read({ userId, section: 'memory', cursor: first.paging.nextCursor });
      assert.equal(next.items.some((row) => row.id === remaining[0].id || row.title === 'New after refresh'), false);
      const refreshed = await reader.read({ userId, section: 'memory' });
      assert.equal(refreshed.items[0].title, 'New after refresh');
      const oldIds = new Set(first.items.map((row) => row.id));
      assert.equal(next.items.some((row) => oldIds.has(row.id)), false);
    });

    await t.test('Life OS keeps upcoming due dates first across page boundaries and null dates', async () => {
      await pool.query(`UPDATE life_commitments SET due_at='2026-11-01 10:00:00.123456+00'
        WHERE id IN (SELECT id FROM life_commitments WHERE user_id=$1 ORDER BY id LIMIT 35)`, [userId]);
      const first = await reader.read({ userId, section: 'life' });
      assert.ok(first.items.every((row) => row.detail.includes('01.11.2026')));
      const second = await reader.read({ userId, section: 'life', cursor: first.paging.nextCursor });
      assert.ok(second.items.slice(0, 5).every((row) => row.detail.includes('01.11.2026')));
      assert.ok(second.items.slice(5).every((row) => row.detail === 'Договорённость'));
      const third = await reader.read({ userId, section: 'life', cursor: second.paging.nextCursor });
      assert.equal(third.items.length, 5); assert.equal(third.paging.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items, ...third.items].map((row) => row.id)).size, 65);
    });

    await t.test('real routes check rights again after a page read and include mission only on first page', async () => {
      const routes = new Map(); let allowed = true;
      registerMiniAppSelfRoutes({ route(method, name, handler) { routes.set(`${method} ${name}`, handler); },
        async authorize() { return { actor: { userId, level: 'owner', permissions: allowed ? ['memory', 'life'] : [] } }; } }, {
        pool, sectionReader: reader, memoryService: {}, missionControlService: { async get() { return { currentMission: { id: 'mission', name: 'Current mission' } }; } },
      });
      const initial = await routes.get('GET /sections/:permission')({ params: { permission: 'life' } });
      assert.equal(initial.items.length, 31); assert.equal(initial.items[0].title, 'Current mission');
      const page = await routes.get('GET /sections/:permission/page/:cursor')({ params: { permission: 'life', cursor: initial.paging.nextCursor } });
      assert.equal(page.items.length, 30); assert.equal(page.items.some((row) => row.id === 'mission'), false);
      const read = reader.read.bind(reader);
      reader.read = async (input) => { const result = await read(input); allowed = false; return result; };
      await assert.rejects(routes.get('GET /sections/:permission')({ params: { permission: 'memory' } }), { code: 'forbidden' });
    });
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
