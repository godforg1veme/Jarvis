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
