const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseAllowedTelegramIds } = require('../src/config/loadConfig');

test('loads safe development defaults', () => {
  const config = loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3210);
  assert.deepEqual(config.telegramAllowedIds, []);
});

test('parses and deduplicates Telegram IDs', () => {
  assert.deepEqual(parseAllowedTelegramIds('123, 456,123'), ['123', '456']);
  assert.throws(() => parseAllowedTelegramIds('123,@name'), /numeric IDs/);
});

test('requires production secrets without exposing values', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL is required/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://secret',
  }), /TELEGRAM_BOT_TOKEN is required/);
});

test('validates selected and fallback model providers', () => {
  assert.throws(() => loadConfig({ JARVIS_MODEL_PROVIDER: 'salad' }), /SALAD_API_KEY/);
  const config = loadConfig({
    JARVIS_MODEL_PROVIDER: 'salad',
    SALAD_API_KEY: 'secret',
    SALAD_MODEL: 'gemma-model',
    JARVIS_MODEL_FALLBACK_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'secret-2',
    OPENROUTER_MODEL: 'openrouter/free',
    OPENROUTER_REASONING_EFFORT: 'medium',
    OPENROUTER_REASONING_EXCLUDE: 'true',
  });
  assert.equal(config.modelProvider, 'salad');
  assert.equal(config.modelFallbackProvider, 'openrouter');
  assert.equal(config.openrouterReasoningEffort, 'medium');
  assert.equal(config.openrouterReasoningExclude, true);
});
