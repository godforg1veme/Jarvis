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

test('requires complete secondary OpenRouter and Gemini fallback profiles', () => {
  assert.throws(() => loadConfig({
    OPENROUTER_FALLBACK_API_KEY: 'secondary-key',
  }), /OPENROUTER_FALLBACK_API_KEY and OPENROUTER_FALLBACK_MODEL/);
  assert.throws(() => loadConfig({
    GEMINI_MODEL: 'gemini-test',
  }), /GEMINI_API_KEY and GEMINI_MODEL/);

  const config = loadConfig({
    JARVIS_MODEL_PROVIDER: 'salad',
    SALAD_API_KEY: 'salad-key',
    SALAD_MODEL: 'salad-model',
    OPENROUTER_FALLBACK_API_KEY: 'secondary-key',
    OPENROUTER_FALLBACK_MODEL: 'secondary-model',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-test',
  });
  assert.equal(config.openrouterFallbackModel, 'secondary-model');
  assert.equal(config.geminiModel, 'gemini-test');
});

test('does not accept an identical secondary OpenRouter profile', () => {
  assert.throws(() => loadConfig({
    JARVIS_MODEL_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'same-key',
    OPENROUTER_MODEL: 'same-model',
    OPENROUTER_FALLBACK_API_KEY: 'same-key',
    OPENROUTER_FALLBACK_MODEL: 'same-model',
  }), /different key or model/);
});

test('requires an explicit HTTPS embedding profile when semantic search is enabled', () => {
  assert.throws(() => loadConfig({
    JARVIS_EMBEDDING_PROVIDER: 'openai-compatible',
    JARVIS_EMBEDDING_BASE_URL: 'http://embeddings.example.test/v1',
    JARVIS_EMBEDDING_MODEL: 'test-embedding',
    JARVIS_EMBEDDING_DIMENSIONS: '3',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://unused',
    TELEGRAM_BOT_TOKEN: 'unused',
    TELEGRAM_ALLOWED_IDS: '1',
  }), /must use HTTPS/);
  const config = loadConfig({
    JARVIS_EMBEDDING_PROVIDER: 'openai-compatible',
    JARVIS_EMBEDDING_BASE_URL: 'https://embeddings.example.test/v1',
    JARVIS_EMBEDDING_MODEL: 'test-embedding',
    JARVIS_EMBEDDING_DIMENSIONS: '3',
  });
  assert.equal(config.embeddingDimensions, 3);
});

test('permits only exact private ASR worker URLs over HTTP in production', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://unused',
    TELEGRAM_BOT_TOKEN: 'unused',
    TELEGRAM_ALLOWED_IDS: '1',
    JARVIS_ASR_PROVIDER: 'openai-compatible',
    ASR_MODEL: 'Qwen/Qwen3-ASR-1.7B',
  };
  assert.equal(loadConfig({
    ...production,
    ASR_BASE_URL: 'http://qwen-asr:8000/v1',
  }).asrBaseUrl, 'http://qwen-asr:8000/v1');
  assert.equal(loadConfig({
    ...production,
    ASR_BASE_URL: 'http://gigaam-asr:8000/v1',
  }).asrBaseUrl, 'http://gigaam-asr:8000/v1');
  assert.throws(() => loadConfig({
    ...production,
    ASR_BASE_URL: 'http://qwen-asr:8001/v1',
  }), /must use HTTPS/);
  assert.throws(() => loadConfig({
    ...production,
    ASR_BASE_URL: 'http://gigaam-asr.evil.test:8000/v1',
  }), /must use HTTPS/);
  assert.throws(() => loadConfig({
    ...production,
    ASR_BASE_URL: 'http://qwen-asr:8000/not-v1',
  }), /must use HTTPS/);
});

test('vision is disabled by default and validates an explicit OpenRouter profile', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test' }).visionProvider, 'disabled');
  assert.throws(() => loadConfig({
    JARVIS_VISION_PROVIDER: 'openrouter',
    JARVIS_VISION_MODEL: 'vision-model',
    JARVIS_VISION_MEMORY_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
  }), /API key/);
  const config = loadConfig({
    JARVIS_VISION_PROVIDER: 'openrouter',
    JARVIS_VISION_MODEL: 'vision-model',
    JARVIS_VISION_API_KEY: 'vision-key',
    JARVIS_VISION_MEMORY_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
  });
  assert.equal(config.visionModel, 'vision-model');
});
