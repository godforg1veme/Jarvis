const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseAllowedTelegramIds } = require('../src/config/loadConfig');

test('loads safe development defaults', () => {
  const config = loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3210);
  assert.deepEqual(config.telegramAllowedIds, []);
  assert.equal(config.telegramVoiceEnabled, false);
  assert.equal(config.lifeOsEnabled, false);
  assert.equal(config.lifeOsContextEnabled, false);
  assert.equal(config.lifeOsContextDeadlineMs, 150);
  assert.equal(config.lifeOsEnrichmentEnabled, false);
  assert.equal(config.lifeOsProactivityEnabled, false);
  assert.equal(config.lifeOsWorkerIntervalMs, 2000);
  assert.equal(config.lifeOsRemindersEnabled, false);
  assert.equal(config.lifeOsReminderIntervalMs, 5000);
  assert.equal(config.lifeOsReminderBatchSize, 10);
  assert.equal(config.lifeOsFixtureSourcesEnabled, false);
  assert.equal(config.vpnSupervisorAcceptanceEnabled, false);
});

test('VPN Supervisor acceptance requires Operations and a configured model', () => {
  assert.throws(() => loadConfig({ JARVIS_VPN_SUPERVISOR_ACCEPTANCE_ENABLED: 'true' }), /OPERATIONS_ENABLED/);
  assert.throws(() => loadConfig({
    JARVIS_VPN_SUPERVISOR_ACCEPTANCE_ENABLED: 'true',
    JARVIS_OPERATIONS_ENABLED: 'true',
    JARVIS_OPERATIONS_PUBLIC_ORIGIN: 'https://jarvis.example.test',
    JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '101',
  }), /configured model provider/);
  const config = loadConfig({
    JARVIS_VPN_SUPERVISOR_ACCEPTANCE_ENABLED: 'true',
    JARVIS_OPERATIONS_ENABLED: 'true',
    JARVIS_OPERATIONS_PUBLIC_ORIGIN: 'https://jarvis.example.test',
    JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '101',
    JARVIS_MODEL_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_MODEL: 'test-model',
  });
  assert.equal(config.vpnSupervisorAcceptanceEnabled, true);
});

test('keeps Life OS ingestion, enrichment, and proactivity independently opt-in', () => {
  const config = loadConfig({
    JARVIS_LIFE_OS_ENABLED: 'true',
    JARVIS_LIFE_OS_CONTEXT_ENABLED: 'true',
    JARVIS_LIFE_OS_CONTEXT_DEADLINE_MS: '250',
    JARVIS_LIFE_OS_ENRICHMENT_ENABLED: 'true',
    JARVIS_LIFE_OS_PROACTIVITY_ENABLED: 'false',
    JARVIS_LIFE_OS_WORKER_INTERVAL_MS: '750',
    JARVIS_LIFE_OS_REMINDERS_ENABLED: 'true',
    JARVIS_LIFE_OS_REMINDER_INTERVAL_MS: '1250',
    JARVIS_LIFE_OS_REMINDER_BATCH_SIZE: '12',
    JARVIS_LIFE_OS_FIXTURE_SOURCES_ENABLED: 'true',
  });
  assert.equal(config.lifeOsEnabled, true);
  assert.equal(config.lifeOsContextEnabled, true);
  assert.equal(config.lifeOsContextDeadlineMs, 250);
  assert.equal(config.lifeOsEnrichmentEnabled, true);
  assert.equal(config.lifeOsProactivityEnabled, false);
  assert.equal(config.lifeOsWorkerIntervalMs, 750);
  assert.equal(config.lifeOsRemindersEnabled, true);
  assert.equal(config.lifeOsReminderIntervalMs, 1250);
  assert.equal(config.lifeOsReminderBatchSize, 12);
  assert.equal(config.lifeOsFixtureSourcesEnabled, true);
  assert.throws(() => loadConfig({ JARVIS_LIFE_OS_WORKER_INTERVAL_MS: '50' }));
  assert.throws(() => loadConfig({ JARVIS_LIFE_OS_CONTEXT_DEADLINE_MS: '10' }));
  assert.throws(() => loadConfig({ JARVIS_LIFE_OS_CONTEXT_ENABLED: 'true' }), /LIFE_OS_ENABLED/);
  assert.throws(() => loadConfig({ JARVIS_LIFE_OS_REMINDERS_ENABLED: 'true' }), /LIFE_OS_ENABLED/);
  assert.throws(() => loadConfig({ JARVIS_LIFE_OS_FIXTURE_SOURCES_ENABLED: 'true' }), /LIFE_OS_ENABLED/);
  assert.throws(() => loadConfig({ JARVIS_LIFE_OS_REMINDER_BATCH_SIZE: '100' }));
});

test('keeps Telegram voice ASR opt-in', () => {
  assert.throws(
    () => loadConfig({ JARVIS_TELEGRAM_VOICE_ENABLED: 'true' }),
    /requires OpenAI-compatible ASR/,
  );
  assert.equal(loadConfig({
    JARVIS_TELEGRAM_VOICE_ENABLED: 'true',
    JARVIS_ASR_PROVIDER: 'openai-compatible',
    ASR_BASE_URL: 'http://gigaam-asr:8000/v1',
    ASR_MODEL: 'GigaAM/v3_e2e_rnnt',
  }).telegramVoiceEnabled, true);
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
