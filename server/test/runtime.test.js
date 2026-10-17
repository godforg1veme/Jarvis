const assert = require('node:assert/strict');
const test = require('node:test');
const { createRuntime } = require('../src/runtime');

test('runtime migrates before it starts and closes every resource', async () => {
  const events = [];
  const pool = { async end() { events.push('pool.end'); } };
  const app = {
    log: { error() {} },
    async listen() { events.push('app.listen'); },
    async close() { events.push('app.close'); },
  };
  const bot = {
    async start() { events.push('bot.start'); },
    async stop() { events.push('bot.stop'); },
  };
  const config = {
    databaseUrl: 'postgres://unused',
    telegramBotToken: 'unused',
    telegramAllowedIds: ['1'],
    host: '127.0.0.1',
    port: 3210,
  };

  const runtime = await createRuntime(config, {
    pool,
    app,
    bot,
    async runMigrations(receivedPool) {
      assert.equal(receivedPool, pool);
      events.push('migrate');
    },
  });
  await runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  await runtime.close();

  assert.deepEqual(events, ['migrate', 'app.listen', 'bot.start', 'bot.stop', 'app.close', 'pool.end']);
});

test('runtime still closes HTTP and pool after Telegram stop rejects', async () => {
  const events = [];
  const runtime = await createRuntime({}, {
    pool: { async end() { events.push('pool'); } },
    app: { log: { error() {} }, async close() { events.push('app'); } },
    bot: { async stop() { events.push('bot'); throw new Error('private detail'); } },
    async runMigrations() {},
  });
  await assert.rejects(runtime.close());
  assert.deepEqual(events.sort(), ['app', 'bot', 'pool']);
});

test('runtime drains pending command work before closing the pool', async () => {
  const { CommandWorker } = require('../src/commands/commandWorker');
  let finish;
  const events = [];
  const worker = new CommandWorker({ repository: { expireStale: () => new Promise((resolve) => { finish = resolve; }) } });
  const work = worker.runOnce();
  const runtime = await createRuntime({}, {
    pool: { async end() { events.push('pool'); } },
    app: { log: { error() {} }, async close() { events.push('app'); } },
    commandWorker: worker,
    async runMigrations() {},
  });
  const closing = runtime.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.includes('pool'), false);
  finish();
  await work;
  await closing;
  assert.equal(events.at(-1), 'pool');
});

test('Telegram stop acknowledgement does not close pool until middleware has drained', async () => {
  let completeHandlers;
  let poolClosed = false;
  const runtime = await createRuntime({}, {
    pool: { async end() { poolClosed = true; } },
    app: { log: { error() {} }, async listen() {}, async close() {} },
    bot: { start: () => new Promise((resolve) => { completeHandlers = resolve; }), async stop() {} },
    async runMigrations() {},
  });
  await runtime.start();
  const close = runtime.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(poolClosed, false);
  completeHandlers();
  await close;
  assert.equal(poolClosed, true);
});

for (const failing of ['commandWorker', 'operationsRuntime', 'telegram', 'http', 'database']) {
  test(`runtime attempts other resources when ${failing} fails`, async () => {
    const events = [];
    function close(name) {
      events.push(name);
      if (name === failing) throw new Error('private-close-detail');
    }
    const runtime = await createRuntime({}, {
      pool: { end() { close('database'); } },
      app: { log: { error() {} }, close() { close('http'); } },
      bot: { stop() { close('telegram'); } },
      commandWorker: { stop() { close('commandWorker'); } },
      async createOperationsRuntime() { return { close() { close('operationsRuntime'); } }; },
      async runMigrations() {},
    });
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await assert.rejects(closing, (error) => {
      assert.deepEqual(error.failures, [{ resource: failing, code: 'RESOURCE_CLOSE_FAILED' }]);
      assert.doesNotMatch(error.stack + JSON.stringify(error), /private-close-detail/);
      return true;
    });
    assert.equal(events.at(-1), 'database');
    assert.deepEqual(events.sort(), ['commandWorker', 'database', 'http', 'operationsRuntime', 'telegram']);
  });
}
