const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHmac } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { buildApp } = require('../src/app');
const { AccessService } = require('../src/access/accessService');
const { registerMiniAppRoutes } = require('../src/miniApp/routes');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');
const { completeReceipt, failReceipt } = require('../src/miniApp/assistantReceipts');
const { UserRepository } = require('../src/users/userRepository');
const {
  ConversationRepository,
} = require('../src/conversations/conversationRepository');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const {
  TelegramInteractionRepository,
} = require('../src/telegram/telegramInteractionRepository');
const {
  TelegramUpdateRepository,
} = require('../src/telegram/telegramUpdateRepository');
const { MENU } = require('../src/telegram/telegramMenu');
const { DENIED_ANSWER } = require('../src/telegram/telegramPermissionPolicy');
const { createRuntime } = require('../src/runtime');
const { loadConfig } = require('../src/config/loadConfig');

const url =
  process.env.JARVIS_MINI_TEST_DATABASE_URL ||
  process.env.JARVIS_JOB_TEST_DATABASE_URL;
const origin = 'https://jarvis.example';
const botToken = 'integration-fixture-bot';
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function signed(telegramId) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Fixture' }),
  });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const data = [...fields]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fields.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return fields.toString();
}
async function fixture() {
  const schema = `mini_integration_${randomBytes(10).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
    max: 8,
  });
  let app;
  try {
    for (const file of [
      '001_identity_and_conversations.sql',
      '015_telegram_interactions.sql',
      '024_telegram_update_outcomes.sql',
      '025_telegram_update_kind.sql',
      '037_access_mini_app.sql',
      '038_mini_app_requests.sql',
      '049_mini_app_request_outcomes.sql',
    ]) {
      await pool.query(
        (
          await fs.readFile(
            path.join(__dirname, '../src/db/migrations', file),
            'utf8',
          )
        ).replace(/^CREATE EXTENSION[^;]+;\s*/gm, ''),
      );
    }
    const accessService = new AccessService({
      pool,
      ownerTelegramId: '101',
      legacyAllowedIds: ['202'],
    });
    await accessService.initialize();
    const owner = await accessService.getAccessForTelegram('101');
    const member = await accessService.getAccessForTelegram('202');
    const conversationRepository = new ConversationRepository(pool);
    const calls = {
      memory: [],
      documents: [],
      devices: [],
      models: [],
      remember: [],
    };
    let answerImpl = async () => 'Fixture answer';
    const assistant = {
      async answer(input) {
        calls.models.push(input);
        return answerImpl(input);
      },
    };
    const memoryService = {
      async list({ userId }) {
        calls.memory.push(userId);
        return [
          {
            id: randomUUID(),
            content:
              userId === owner.userId
                ? 'OWNER PRIVATE MEMORY'
                : 'MEMBER MEMORY',
            storage_key: 'PRIVATE_STORAGE',
            credentials: 'PRIVATE_CREDENTIAL',
          },
        ];
      },
      async memoriesForPrompt({ userId }) {
        calls.memory.push(userId);
        return [`MEMORY:${userId}`];
      },
      async handleUserText() {
        return { handled: false };
      },
      async remember(input) {
        calls.remember.push(input);
        return { ok: true };
      },
    };
    const knowledgeService = {
      async list({ userId }) {
        calls.documents.push(userId);
        return [
          {
            id: randomUUID(),
            original_name: `Document:${userId}`,
            status: 'ready',
            storage_key: 'PRIVATE_STORAGE',
            extracted_text: 'PRIVATE_EXTRACT',
            token: 'PRIVATE_TOKEN',
          },
        ];
      },
      async searchForPrompt({ userId }) {
        calls.documents.push(userId);
        return [];
      },
    };
    const deviceService = {
      async list({ userId }) {
        calls.devices.push(userId);
        return [
          {
            id: randomUUID(),
            name: `Device:${userId}`,
            status: 'online',
            token: 'PRIVATE_TOKEN',
            credentials: 'PRIVATE_CREDENTIAL',
          },
        ];
      },
    };
    const services = {
      pool,
      accessService,
      conversationRepository,
      assistant,
      memoryService,
      knowledgeService,
      deviceService,
      getTelegramBotUsername: () => 'IntegrationFixtureBot',
    };
    app = buildApp({
      config: {
        nodeEnv: 'production',
        logLevel: 'silent',
        trustProxy: false,
        miniAppEnabled: true,
      },
    });
    registerMiniAppRoutes(app, {
      config: { miniAppPublicOrigin: origin, telegramBotToken: botToken },
      accessService,
      pool,
      registerUserRoutes: (routes) =>
        registerMiniAppSelfRoutes(routes, services),
    });
    const interactions = new TelegramInteractionRepository(pool);
    const menuService = new TelegramMenuService({
      interactions,
      accessService,
      ownerTelegramId: '101',
      memoryService,
      knowledgeService,
      deviceService,
    });
    const messages = new TelegramMessageService({
      accessService,
      accessPolicy: { isAllowed: (id) => accessService.isAllowedTelegram(id) },
      updateRepository: new TelegramUpdateRepository(pool),
      userRepository: new UserRepository(pool),
      conversationRepository,
      assistant,
      menuService,
      memoryService,
      knowledgeService,
      deviceService,
    });
    let update = 80000;
    const msg = (text, extra = {}, options = {}) =>
      messages.handle(
        {
          update_id: ++update,
          message: {
            message_id: update,
            from: { id: 202 },
            chat: { id: 202, type: 'private' },
            text,
            ...extra,
          },
        },
        options,
      );
    const cb = (data) =>
      messages.handleCallback({
        update_id: ++update,
        callback_query: {
          id: String(update),
          from: { id: 202 },
          data,
          message: { message_id: update, chat: { id: 202, type: 'private' } },
        },
      });
    const patch = async (values) => {
      const current = await accessService.getAccessForTelegram('202');
      return accessService.mutate(
        owner.userId,
        'user.update',
        { operationId: randomUUID(), revision: current.revision, ...values },
        '202',
      );
    };
    const login = async (id = 202) => {
      const response = await app.inject({
        method: 'POST',
        url: '/mini/api/session',
        headers: { origin },
        payload: { initData: signed(id) },
      });
      assert.equal(response.statusCode, 200);
      return {
        cookie: response.headers['set-cookie'].split(';')[0],
        csrf: response.json().csrfToken,
      };
    };
    const request = (session, method, route, payload) =>
      app.inject({
        method,
        url: `/mini/api${route}`,
        headers: {
          cookie: session.cookie,
          origin,
          'x-jarvis-csrf': session.csrf,
        },
        ...(payload === undefined ? {} : { payload }),
      });
    return {
      ...services,
      app,
      owner,
      member,
      calls,
      interactions,
      messages,
      msg,
      cb,
      patch,
      login,
      request,
      setAnswer: (fn) => {
        answerImpl = fn;
      },
      async close() {
        await app.close();
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  } catch (error) {
    if (app) await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw error;
  }
}

test('Mini App handoff reaches the personal Telegram menu and obeys live PostgreSQL access changes', { skip: !url }, async () => {
  const f = await fixture();
  try {
    await f.patch({ overrides: { documents: 'allow' } });
    const session = await f.login();
    const section = await f.request(session, 'GET', '/sections/documents');
    assert.equal(section.statusCode, 200);
    const action = section.json().actions.find((item) => item.kind === 'telegram');
    assert.equal(action.href, 'https://t.me/IntegrationFixtureBot?start=mini_documents');
    const parameter = new URL(action.href).searchParams.get('start');
    const reply = await f.msg(`/start ${parameter}`);
    assert.ok(reply.answer.includes(`Document:${f.member.userId}`));
    assert.equal(reply.answer.includes(f.owner.userId), false);
    assert.equal(f.calls.models.length, 0, 'handoff never invokes the assistant');
    await f.patch({ overrides: { documents: 'deny' } });
    assert.equal((await f.request(session, 'GET', '/sections/documents')).statusCode, 403);
    assert.equal((await f.msg(`/start ${parameter}`)).answer, DENIED_ANSWER);
    assert.equal(f.calls.models.length, 0);
  } finally { await f.close(); }
});

test('real runtime serves built Mini App and preserves stored blocks with UI disabled', { skip: !url }, async () => {
  const f = await fixture();
  const sharedPool = { query: (...args) => f.pool.query(...args), connect: () => f.pool.connect(), async end() {} };
  const base = { NODE_ENV: 'test', DATABASE_URL: url, TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_ALLOWED_IDS: '101,202', JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '101',
    JARVIS_MINI_APP_PUBLIC_ORIGIN: origin, JARVIS_LOG_LEVEL: 'silent' };
  let runtime;
  try {
    runtime = await createRuntime(loadConfig({ ...base, JARVIS_MINI_APP_ENABLED: 'true' }), {
      pool: sharedPool, async runMigrations() {}, bot: { async start() {}, async stop() {} },
    });
    const page = await runtime.app.inject('/mini/');
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /telegram-web-app\.js/);
    assert.equal((await runtime.app.inject('/mini/api/me')).statusCode, 401);
    await runtime.close(); runtime = null;
    await f.patch({ blocked: true });
    runtime = await createRuntime(loadConfig({ ...base, JARVIS_MINI_APP_ENABLED: 'false' }), {
      pool: sharedPool, async runMigrations() {}, bot: { async start() {}, async stop() {} },
    });
    assert.equal((await runtime.app.inject('/mini/api/me')).statusCode, 404);
    assert.equal(await runtime.accessService.isAllowedTelegram('202'), false);
    assert.equal(await runtime.accessService.allows(f.member.userId, 'devices'), false);
  } finally { if (runtime) await runtime.close(); await f.close(); }
});

test(
  'real app and Telegram HMAC bind self sections/history to actor and strip private fields',
  { skip: !url },
  async () => {
    const f = await fixture();
    try {
      const session = await f.login();
      const ownerConversation = await f.conversationRepository.getOrCreate({
        userId: f.owner.userId,
        channel: 'pwa',
        externalChatId: 'mini',
      });
      await f.conversationRepository.appendMessage({
        userId: f.owner.userId,
        conversationId: ownerConversation.id,
        role: 'assistant',
        content: 'OWNER PRIVATE ANSWER',
      });
      for (const section of ['memory', 'documents', 'devices']) {
        const response = await f.request(
          session,
          'GET',
          `/sections/${section}`,
        );
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.includes('PRIVATE'), false);
        assert.equal(response.body.includes(f.owner.userId), false);
        assert.match(
          response.headers['content-security-policy'],
          /frame-ancestors 'self' https:\/\/web.telegram.org/,
        );
        assert.equal(response.headers['x-frame-options'], undefined);
        assert.equal(
          f.calls[section === 'memory' ? 'memory' : section].at(-1),
          f.member.userId,
        );
      }
      const id = randomUUID();
      assert.equal(
        (
          await f.request(session, 'POST', '/assistant/messages', {
            requestId: id,
            text: 'My question',
          })
        ).statusCode,
        200,
      );
      assert.equal(f.calls.models[0].userId, f.member.userId);
      const history = await f.request(session, 'GET', '/assistant/messages');
      assert.deepEqual(
        history.json().messages.map((item) => item.content),
        ['My question', 'Fixture answer'],
      );
      assert.equal(history.body.includes('OWNER PRIVATE'), false);
      assert.equal(
        (
          await f.request(
            session,
            'GET',
            `/sections/memory?userId=${f.owner.userId}`,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await f.request(session, 'POST', '/assistant/messages', {
            requestId: randomUUID(),
            text: 'Forged',
            userId: f.owner.userId,
          })
        ).statusCode,
        400,
      );
      const health = await f.app.inject({ url: '/health/live' });
      assert.equal(health.headers['x-frame-options'], 'DENY');
      const forged = await f.app.inject({
        method: 'POST',
        url: '/mini/api/session',
        headers: { origin },
        payload: { initData: signed(202).replace('202', '101') },
      });
      assert.equal(forged.statusCode, 400);
    } finally {
      await f.close();
    }
  },
);

test(
  'self requests retain original UUID through success, concurrent unknown and source revocation',
  { skip: !url },
  async () => {
    const f = await fixture();
    try {
      const session = await f.login(),
        id = randomUUID();
      const payload = { requestId: id, text: 'Original' };
      assert.equal(
        (await f.request(session, 'POST', '/assistant/messages', payload))
          .statusCode,
        200,
      );
      assert.equal(
        (await f.request(session, 'POST', '/assistant/messages', payload))
          .statusCode,
        200,
      );
      assert.equal(f.calls.models.length, 1);
      assert.equal(
        (
          await f.request(session, 'POST', '/assistant/messages', {
            ...payload,
            text: 'Changed',
          })
        ).json().code,
        'operation_conflict',
      );
      const entered = deferred(),
        release = deferred(),
        waitingId = randomUUID();
      f.setAnswer(async () => {
        entered.resolve();
        await release.promise;
        return 'Derived from revoked memory';
      });
      const waiting = f.request(session, 'POST', '/assistant/messages', {
        requestId: waitingId,
        text: 'Wait',
      });
      await entered.promise;
      assert.equal(
        (
          await f.request(session, 'POST', '/assistant/messages', {
            requestId: waitingId,
            text: 'Wait',
          })
        ).json().code,
        'operation_unknown',
      );
      await f.patch({ overrides: { memory: 'deny' } });
      release.resolve();
      const denied = await waiting;
      assert.equal(denied.json().code, 'forbidden');
      assert.equal(denied.body.includes('Derived'), false);
      assert.equal(
        (
          await f.request(session, 'GET', `/assistant/requests/${waitingId}`)
        ).json().failureCode,
        'request_failed',
      );
      assert.equal(
        (
          await f.request(session, 'POST', '/assistant/messages', {
            requestId: waitingId,
            text: 'Wait',
          })
        ).json().failureCode,
        'request_failed',
      );
      assert.equal(f.calls.models.length, 2);
      const messages = (
        await f.request(session, 'GET', '/assistant/messages')
      ).json().messages;
      assert.equal(
        messages.some((item) => item.content.includes('Derived')),
        false,
      );
    } finally {
      await f.close();
    }
  },
);

test('source revocation between the final route check and receipt commit leaves no derived answer', { skip: !url }, async () => {
  const f = await fixture();
  try {
    const session = await f.login();
    const requestId = randomUUID();
    const privateAnswer = 'DERIVED ANSWER AFTER FINAL CHECK';
    f.setAnswer(async () => privateAnswer);
    const entered = deferred();
    const release = deferred();
    const originalTransaction = f.accessService.transaction.bind(f.accessService);
    let gateOpen = true;
    f.accessService.transaction = async (work) => {
      if (gateOpen) {
        gateOpen = false;
        entered.resolve();
        await release.promise;
      }
      return originalTransaction(work);
    };
    const pending = f.request(session, 'POST', '/assistant/messages', {
      requestId, text: 'Use my memory',
    });
    await entered.promise;
    try {
      await f.patch({ overrides: { memory: 'deny' } });
    } finally {
      release.resolve();
    }
    const denied = await pending;
    assert.equal(denied.json().code, 'forbidden');
    assert.equal(denied.body.includes(privateAnswer), false);
    assert.ok(f.calls.memory.includes(f.member.userId));
    const savedReceipt = (await f.pool.query(
      'SELECT status,answer FROM mini_app_requests WHERE user_id=$1 AND request_id=$2',
      [f.member.userId, requestId],
    )).rows[0];
    assert.equal(savedReceipt.status, 'failed');
    assert.equal(savedReceipt.answer, null);
    const receipt = (await f.request(session, 'GET', `/assistant/requests/${requestId}`)).json();
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.failureCode, 'request_failed');
    const duplicate = (await f.request(session, 'POST', '/assistant/messages', {
      requestId, text: 'Use my memory',
    })).json();
    assert.equal(duplicate.failureCode, 'request_failed');
    assert.equal(f.calls.models.length, 1);
    const history = (await f.request(session, 'GET', '/assistant/messages')).json().messages;
    assert.equal(history.some((message) => message.content.includes(privateAnswer)), false);
  } finally {
    await f.close();
  }
});

test('failed Mini App model request resolves original UUID without a second model call', { skip: !url }, async () => {
  const f = await fixture();
  try {
    const session = await f.login();
    const id = randomUUID();
    const body = { requestId: id, text: 'Fixture model failure' };
    f.setAnswer(async () => { throw Error('synthetic model error'); });
    const first = await f.request(session, 'POST', '/assistant/messages', body);
    assert.equal(first.statusCode, 503);
    assert.equal(first.json().code, 'unavailable');
    const receipt = await f.request(session, 'GET', `/assistant/requests/${id}`);
    assert.deepEqual(receipt.json(), { ok: true, status: 'failed', failureCode: 'request_failed' });
    const duplicate = await f.request(session, 'POST', '/assistant/messages', body);
    assert.deepEqual(duplicate.json(), receipt.json());
    assert.equal(f.calls.models.length, 1);
    const row = (await f.pool.query('SELECT status,answer,failure_code FROM mini_app_requests WHERE user_id=$1 AND request_id=$2',
      [f.member.userId, id])).rows[0];
    assert.deepEqual(row, { status: 'failed', answer: null, failure_code: 'request_failed' });
    const constraints = (await f.pool.query(`SELECT conname FROM pg_constraint
      WHERE conrelid='mini_app_requests'::regclass AND conname IN
      ('mini_app_requests_check','mini_app_requests_status_check') ORDER BY conname`)).rows.map((item) => item.conname);
    assert.deepEqual(constraints, ['mini_app_requests_check', 'mini_app_requests_status_check']);
    await assert.rejects(f.pool.query(`UPDATE mini_app_requests SET status='processing',answer='invalid',failure_code=NULL
      WHERE user_id=$1 AND request_id=$2`, [f.member.userId, id]), { code: '23514', constraint: 'mini_app_requests_check' });
    await assert.rejects(f.pool.query(`UPDATE mini_app_requests SET status='other'
      WHERE user_id=$1 AND request_id=$2`, [f.member.userId, id]), { code: '23514' });
  } finally { await f.close(); }
});

test('stale Mini App receipt expires on real PostgreSQL and rejects a late answer', { skip: !url }, async () => {
  const f = await fixture();
  try {
    const session = await f.login();
    const id = randomUUID();
    const conversation = await f.conversationRepository.getOrCreate({ userId: f.member.userId, channel: 'pwa', externalChatId: 'mini' });
    await f.pool.query(`INSERT INTO mini_app_requests(user_id,request_id,request_hash,created_at)
      VALUES($1,$2,$3,clock_timestamp()-interval '6 minutes')`, [f.member.userId, id, 'a'.repeat(64)]);
    assert.deepEqual((await f.request(session, 'GET', `/assistant/requests/${id}`)).json(),
      { ok: true, status: 'failed', failureCode: 'request_expired' });
    assert.equal(await completeReceipt(f.pool, { userId: f.member.userId, requestId: id,
      conversationId: conversation.id, answer: 'Must not be appended' }), false);
    const messages = await f.pool.query('SELECT id FROM messages WHERE conversation_id=$1 AND external_message_id=$2',
      [conversation.id, `mini:${id}:answer`]);
    assert.equal(messages.rowCount, 0);
  } finally { await f.close(); }
});

test('Mini App answer append rolls back when its receipt cannot complete', { skip: !url }, async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const conversation = await f.conversationRepository.getOrCreate({ userId: f.member.userId, channel: 'pwa', externalChatId: 'mini' });
    await f.pool.query(`INSERT INTO mini_app_requests(user_id,request_id,request_hash)
      VALUES($1,$2,$3)`, [f.member.userId, id, 'a'.repeat(64)]);
    await f.pool.query(`CREATE FUNCTION reject_fixture_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'synthetic completion rejection'; END IF;
      RETURN NEW; END $$`);
    await f.pool.query(`CREATE TRIGGER reject_fixture_completion BEFORE UPDATE ON mini_app_requests
      FOR EACH ROW EXECUTE FUNCTION reject_fixture_completion()`);
    await assert.rejects(completeReceipt(f.pool, { userId: f.member.userId, requestId: id,
      conversationId: conversation.id, answer: 'Must be rolled back' }));
    assert.equal((await f.pool.query('SELECT status FROM mini_app_requests WHERE user_id=$1 AND request_id=$2',
      [f.member.userId, id])).rows[0].status, 'processing');
    assert.equal((await f.pool.query('SELECT id FROM messages WHERE conversation_id=$1 AND external_message_id=$2',
      [conversation.id, `mini:${id}:answer`])).rowCount, 0);
    await failReceipt(f.pool, f.member.userId, id);
    assert.equal((await f.pool.query('SELECT status FROM mini_app_requests WHERE user_id=$1 AND request_id=$2',
      [f.member.userId, id])).rows[0].status, 'failed');
  } finally { await f.close(); }
});

test('lost COMMIT acknowledgment reconciles one committed Mini App answer', { skip: !url }, async () => {
  const f = await fixture();
  try {
    const session = await f.login();
    const id = randomUUID();
    const conversation = await f.conversationRepository.getOrCreate({ userId: f.member.userId, channel: 'pwa', externalChatId: 'mini' });
    await f.pool.query(`INSERT INTO mini_app_requests(user_id,request_id,request_hash)
      VALUES($1,$2,$3)`, [f.member.userId, id, 'a'.repeat(64)]);
    const uncertainPool = { async connect() {
      const client = await f.pool.connect();
      return { release: () => client.release(), async query(sql, args) {
        const result = await client.query(sql, args);
        if (sql === 'COMMIT') throw Error('synthetic lost commit acknowledgment');
        return result;
      } };
    } };
    await assert.rejects(completeReceipt(uncertainPool, { userId: f.member.userId, requestId: id,
      conversationId: conversation.id, answer: 'Committed once' }));
    await failReceipt(f.pool, f.member.userId, id);
    assert.deepEqual((await f.request(session, 'GET', `/assistant/requests/${id}`)).json(),
      { ok: true, status: 'completed', answer: 'Committed once' });
    assert.equal((await f.pool.query('SELECT id FROM messages WHERE conversation_id=$1 AND external_message_id=$2',
      [conversation.id, `mini:${id}:answer`])).rowCount, 1);
  } finally { await f.close(); }
});

test(
  'real bot search-only role filters menu, denies stale callbacks/commands/uploads and preserves revoked guided state',
  { skip: !url },
  async () => {
    const f = await fixture();
    try {
      const role = await f.accessService.mutate(f.owner.userId, 'role.create', {
        operationId: randomUUID(),
        name: 'Search only',
        permissions: ['jobs'],
      });
      await f.patch({ roleId: role.id });
      const home = await f.msg('/start');
      const labels = home.replyKeyboard.keyboard
        .flat()
        .map((button) => button.text);
      assert.ok(labels.includes(MENU.JOBS));
      for (const hidden of [
        MENU.MEMORY,
        MENU.DOCUMENTS,
        MENU.LIFE,
        MENU.DEVICES,
        MENU.VPN,
      ])
        assert.equal(labels.includes(hidden), false);
      assert.equal(
        (await f.msg('Ordinary assistant question')).answer,
        DENIED_ANSWER,
      );
      assert.equal((await f.cb('mem:list')).answer, DENIED_ANSWER);
      assert.equal((await f.msg('/devices')).answer, DENIED_ANSWER);
      let downloads = 0;
      const upload = await f.msg(
        '',
        {
          document: {
            file_id: 'fixture',
            file_unique_id: 'fixture',
            file_name: 'notes.txt',
            mime_type: 'text/plain',
            file_size: 10,
          },
        },
        {
          downloadAttachment: async () => {
            downloads++;
            return Buffer.from('PRIVATE');
          },
        },
      );
      assert.equal(upload.answer, DENIED_ANSWER);
      assert.equal(downloads, 0);
      assert.equal(f.calls.models.length, 0);
      await f.patch({ overrides: { memory: 'allow' } });
      assert.match((await f.cb('mem:add')).answer, /запомнить/);
      const conversation = await f.conversationRepository.getOrCreate({
        userId: f.member.userId,
        channel: 'telegram',
        externalChatId: '202',
      });
      const scope = {
        userId: f.member.userId,
        conversationId: conversation.id,
        chatId: '202',
      };
      const active = (await f.interactions.getActive(scope)).interaction;
      assert.equal(active.kind, 'memory_add');
      await f.patch({ overrides: { memory: 'deny' } });
      assert.equal(
        (await f.msg('Remember this fixture fact')).answer,
        DENIED_ANSWER,
      );
      assert.equal(
        (await f.interactions.getActive(scope)).interaction.id,
        active.id,
      );
      assert.equal(f.calls.remember.length, 0);
    } finally {
      await f.close();
    }
  },
);

test(
  'real assistant handlers omit sources denied by personal rights',
  { skip: !url },
  async () => {
    const f = await fixture();
    try {
      await f.patch({
        overrides: { memory: 'deny', documents: 'deny', devices: 'deny' },
      });
      const session = await f.login();
      await f.request(session, 'POST', '/assistant/messages', {
        requestId: randomUUID(),
        text: 'Mini fixture',
      });
      await f.msg('Bot fixture');
      assert.equal(f.calls.models.length, 2);
      for (const model of f.calls.models) {
        assert.deepEqual(model.memories, []);
        assert.deepEqual(model.documents, []);
        assert.deepEqual(model.devices, []);
        assert.equal(model.userId, f.member.userId);
      }
      assert.deepEqual(f.calls.memory, []);
      assert.deepEqual(f.calls.documents, []);
      assert.deepEqual(f.calls.devices, []);
    } finally {
      await f.close();
    }
  },
);

test(
  'bot withholds source-derived answer when source permission is revoked during model work',
  { skip: !url, timeout: 10000 },
  async () => {
    const f = await fixture();
    try {
      const entered = deferred(),
        release = deferred();
      f.setAnswer(async () => {
        entered.resolve();
        await release.promise;
        return 'REVOKED SOURCE DERIVED ANSWER';
      });
      const waiting = f.msg('Question using fixture memory');
      await entered.promise;
      assert.equal(f.calls.models.at(-1).memories.length, 1);
      await f.patch({ overrides: { memory: 'deny' } });
      release.resolve();
      const response = await waiting;
      assert.equal(response.answer, DENIED_ANSWER);
      const stored = await f.pool.query(
        "SELECT content FROM messages WHERE user_id=$1 AND role='assistant'",
        [f.member.userId],
      );
      assert.equal(
        stored.rows.some((row) => row.content.includes('REVOKED SOURCE')),
        false,
      );
    } finally {
      await f.close();
    }
  },
);
