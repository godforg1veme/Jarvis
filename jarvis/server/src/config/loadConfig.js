const { z } = require('zod');

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseAllowedTelegramIds(value) {
  if (!value) return [];
  const ids = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(ids));
  for (const id of unique) {
    if (!/^\d{1,20}$/.test(id)) throw new Error('TELEGRAM_ALLOWED_IDS must contain only numeric IDs');
  }
  return unique;
}

const baseSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  trustProxy: z.boolean(),
  databaseUrl: z.string().max(2048),
  telegramBotToken: z.string().max(512),
  telegramAllowedIds: z.array(z.string().regex(/^\d{1,20}$/)).max(100),
  modelProvider: z.enum(['echo', 'salad', 'openrouter']),
  modelFallbackProvider: z.enum(['', 'salad', 'openrouter']),
  modelTimeoutMs: z.number().int().min(1000).max(120000),
  saladBaseUrl: z.string().max(2048),
  saladApiKey: z.string().max(2048),
  saladModel: z.string().max(255),
  saladAuthMode: z.enum(['bearer', 'salad-api-key']),
  openrouterApiKey: z.string().max(2048),
  openrouterModel: z.string().max(255),
  openrouterFallbackApiKey: z.string().max(2048),
  openrouterFallbackModel: z.string().max(255),
  openrouterReasoningEffort: z.enum(['', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']),
  openrouterReasoningExclude: z.boolean(),
  geminiApiKey: z.string().max(2048),
  geminiModel: z.string().max(255),
  documentStoragePath: z.string().min(1).max(2048),
  documentMaxBytes: z.number().int().min(1024 * 1024).max(20 * 1024 * 1024),
  documentUserQuotaBytes: z.number().int().min(20 * 1024 * 1024).max(100 * 1024 * 1024 * 1024),
  documentWorkerIntervalMs: z.number().int().min(250).max(60000),
  pdfToTextBin: z.string().min(1).max(2048),
  ffprobeBin: z.string().min(1).max(2048),
  embeddingProvider: z.enum(['disabled', 'openai-compatible']),
  embeddingBaseUrl: z.string().max(2048),
  embeddingApiKey: z.string().max(2048),
  embeddingModel: z.string().max(255),
  embeddingDimensions: z.number().int().min(0).max(4096),
  embeddingTimeoutMs: z.number().int().min(1000).max(120000),
  embeddingBatchSize: z.number().int().min(1).max(64),
  asrProvider: z.enum(['disabled', 'openai-compatible']),
  asrBaseUrl: z.string().max(2048),
  asrApiKey: z.string().max(2048),
  asrModel: z.string().max(255),
  asrTimeoutMs: z.number().int().min(1000).max(120000),
  operationsEnabled: z.boolean(),
  operationsHostKey: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  operationsHostLabel: z.string().min(1).max(100),
  operationsSocketPath: z.string().min(1).max(2048),
  operationsAuthenticatorPath: z.string().min(1).max(2048),
  operationsPollIntervalMs: z.number().int().min(5000).max(300000),
  operationsOwnerTelegramId: z.string().regex(/^\d{1,20}$/),
  operationsPublicOrigin: z.string().max(2048),
});

function validateProvider(config, provider) {
  if (!provider) return;
  if (provider === 'salad') {
    if (!config.saladBaseUrl || !config.saladApiKey || !config.saladModel) {
      throw new Error('SALAD_BASE_URL, SALAD_API_KEY, and SALAD_MODEL are required for Salad');
    }
    const url = new URL(config.saladBaseUrl);
    if (config.nodeEnv === 'production' && url.protocol !== 'https:') throw new Error('SALAD_BASE_URL must use HTTPS in production');
  }
  if (provider === 'openrouter' && (!config.openrouterApiKey || !config.openrouterModel)) {
    throw new Error('OPENROUTER_API_KEY and OPENROUTER_MODEL are required for OpenRouter');
  }
}

function validateConfiguredFallbacks(config) {
  const hasOpenRouterFallbackKey = Boolean(config.openrouterFallbackApiKey);
  const hasOpenRouterFallbackModel = Boolean(config.openrouterFallbackModel);
  if (hasOpenRouterFallbackKey !== hasOpenRouterFallbackModel) {
    throw new Error('OPENROUTER_FALLBACK_API_KEY and OPENROUTER_FALLBACK_MODEL must be configured together');
  }

  const hasGeminiKey = Boolean(config.geminiApiKey);
  const hasGeminiModel = Boolean(config.geminiModel);
  if (hasGeminiKey !== hasGeminiModel) {
    throw new Error('GEMINI_API_KEY and GEMINI_MODEL must be configured together');
  }

  if (config.modelProvider === 'openrouter'
    && hasOpenRouterFallbackKey
    && config.openrouterApiKey === config.openrouterFallbackApiKey
    && config.openrouterModel === config.openrouterFallbackModel) {
    throw new Error('OpenRouter fallback must use a different key or model from the primary provider');
  }
}

function validateAsr(config) {
  if (config.asrProvider !== 'openai-compatible') return;
  if (!config.asrBaseUrl || !config.asrModel) {
    throw new Error('ASR_BASE_URL and ASR_MODEL are required for OpenAI-compatible ASR');
  }
  const url = new URL(config.asrBaseUrl);
  if (config.nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('ASR_BASE_URL must use HTTPS in production');
  }
}

function validateEmbeddings(config) {
  if (config.embeddingProvider !== 'openai-compatible') return;
  if (!config.embeddingBaseUrl || !config.embeddingModel) {
    throw new Error('JARVIS_EMBEDDING_BASE_URL and JARVIS_EMBEDDING_MODEL are required for embeddings');
  }
  const url = new URL(config.embeddingBaseUrl);
  if (config.nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('JARVIS_EMBEDDING_BASE_URL must use HTTPS in production');
  }
  if (config.embeddingDimensions === 0) {
    throw new Error('JARVIS_EMBEDDING_DIMENSIONS is required for embeddings');
  }
}

function loadConfig(env = process.env) {
  const raw = {
    nodeEnv: String(env.NODE_ENV || 'development').trim().toLowerCase(),
    host: String(env.JARVIS_SERVER_HOST || '127.0.0.1').trim(),
    port: Number(env.JARVIS_SERVER_PORT || 3210),
    logLevel: String(env.JARVIS_LOG_LEVEL || 'info').trim().toLowerCase(),
    trustProxy: parseBoolean(env.JARVIS_TRUST_PROXY),
    databaseUrl: String(env.DATABASE_URL || '').trim(),
    telegramBotToken: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    telegramAllowedIds: parseAllowedTelegramIds(env.TELEGRAM_ALLOWED_IDS),
    modelProvider: String(env.JARVIS_MODEL_PROVIDER || 'echo').trim().toLowerCase(),
    modelFallbackProvider: String(env.JARVIS_MODEL_FALLBACK_PROVIDER || '').trim().toLowerCase(),
    modelTimeoutMs: Number(env.JARVIS_MODEL_TIMEOUT_MS || 60000),
    saladBaseUrl: String(env.SALAD_BASE_URL || 'https://ai.salad.cloud/v1').trim(),
    saladApiKey: String(env.SALAD_API_KEY || '').trim(),
    saladModel: String(env.SALAD_MODEL || '').trim(),
    saladAuthMode: String(env.SALAD_AUTH_MODE || 'bearer').trim().toLowerCase(),
    openrouterApiKey: String(env.OPENROUTER_API_KEY || '').trim(),
    openrouterModel: String(env.OPENROUTER_MODEL || '').trim(),
    openrouterFallbackApiKey: String(env.OPENROUTER_FALLBACK_API_KEY || '').trim(),
    openrouterFallbackModel: String(env.OPENROUTER_FALLBACK_MODEL || '').trim(),
    openrouterReasoningEffort: String(env.OPENROUTER_REASONING_EFFORT || '').trim().toLowerCase(),
    openrouterReasoningExclude: parseBoolean(env.OPENROUTER_REASONING_EXCLUDE),
    geminiApiKey: String(env.GEMINI_API_KEY || '').trim(),
    geminiModel: String(env.GEMINI_MODEL || '').trim(),
    documentStoragePath: String(env.JARVIS_DOCUMENT_STORAGE_PATH || '/srv/jarvis/documents').trim(),
    documentMaxBytes: Number(env.JARVIS_DOCUMENT_MAX_BYTES || (20 * 1024 * 1024)),
    documentUserQuotaBytes: Number(env.JARVIS_DOCUMENT_USER_QUOTA_BYTES || (1024 * 1024 * 1024)),
    documentWorkerIntervalMs: Number(env.JARVIS_DOCUMENT_WORKER_INTERVAL_MS || 2000),
    pdfToTextBin: String(env.JARVIS_PDFTOTEXT_BIN || 'pdftotext').trim(),
    ffprobeBin: String(env.JARVIS_FFPROBE_BIN || 'ffprobe').trim(),
    embeddingProvider: String(env.JARVIS_EMBEDDING_PROVIDER || 'disabled').trim().toLowerCase(),
    embeddingBaseUrl: String(env.JARVIS_EMBEDDING_BASE_URL || '').trim(),
    embeddingApiKey: String(env.JARVIS_EMBEDDING_API_KEY || '').trim(),
    embeddingModel: String(env.JARVIS_EMBEDDING_MODEL || '').trim(),
    embeddingDimensions: Number(env.JARVIS_EMBEDDING_DIMENSIONS || 0),
    embeddingTimeoutMs: Number(env.JARVIS_EMBEDDING_TIMEOUT_MS || 60000),
    embeddingBatchSize: Number(env.JARVIS_EMBEDDING_BATCH_SIZE || 32),
    asrProvider: String(env.JARVIS_ASR_PROVIDER || 'disabled').trim().toLowerCase(),
    asrBaseUrl: String(env.ASR_BASE_URL || '').trim(),
    asrApiKey: String(env.ASR_API_KEY || '').trim(),
    asrModel: String(env.ASR_MODEL || '').trim(),
    asrTimeoutMs: Number(env.JARVIS_ASR_TIMEOUT_MS || 60000),
    operationsEnabled: parseBoolean(env.JARVIS_OPERATIONS_ENABLED),
    operationsHostKey: String(env.JARVIS_OPERATIONS_HOST_KEY || 'vps').trim(),
    operationsHostLabel: String(env.JARVIS_OPERATIONS_HOST_LABEL || 'Jarvis VPS').trim(),
    operationsSocketPath: String(env.JARVIS_OPERATIONS_SOCKET_PATH || '/run/jarvis-host-agent/agent.sock').trim(),
    operationsAuthenticatorPath: String(env.JARVIS_OPERATIONS_AUTHENTICATOR_PATH || '/run/secrets/operations_host_agent_authenticator').trim(),
    operationsPollIntervalMs: Number(env.JARVIS_OPERATIONS_POLL_INTERVAL_MS || 30000),
    operationsOwnerTelegramId: String(env.JARVIS_OPERATIONS_OWNER_TELEGRAM_ID || '0').trim(),
    operationsPublicOrigin: String(env.JARVIS_OPERATIONS_PUBLIC_ORIGIN || '').trim(),
  };

  const config = baseSchema.parse(raw);
  if (config.nodeEnv === 'production') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required in production');
    if (!config.telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is required in production');
    if (config.telegramAllowedIds.length === 0) throw new Error('TELEGRAM_ALLOWED_IDS is required in production');
  }
  validateProvider(config, config.modelProvider);
  validateProvider(config, config.modelFallbackProvider);
  validateConfiguredFallbacks(config);
  validateAsr(config);
  validateEmbeddings(config);
  if (config.operationsEnabled) {
    if (!config.operationsPublicOrigin) throw new Error('JARVIS_OPERATIONS_PUBLIC_ORIGIN is required when operations are enabled');
    const operationsUrl = new URL(config.operationsPublicOrigin);
    if (config.nodeEnv === 'production' && operationsUrl.protocol !== 'https:') throw new Error('JARVIS_OPERATIONS_PUBLIC_ORIGIN must use HTTPS in production');
    if (operationsUrl.pathname !== '/' || operationsUrl.search || operationsUrl.hash) throw new Error('JARVIS_OPERATIONS_PUBLIC_ORIGIN must be an origin without a path');
    if (config.operationsOwnerTelegramId === '0') throw new Error('JARVIS_OPERATIONS_OWNER_TELEGRAM_ID is required when operations are enabled');
  }
  if (config.modelProvider !== 'echo' && config.modelProvider === config.modelFallbackProvider) {
    throw new Error('model fallback provider must differ from the primary provider');
  }
  return Object.freeze(config);
}

module.exports = {
  loadConfig,
  parseAllowedTelegramIds,
  parseBoolean,
  validateConfiguredFallbacks,
  validateAsr,
  validateEmbeddings,
};
