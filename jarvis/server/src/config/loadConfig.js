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
  openrouterReasoningEffort: z.enum(['', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']),
  openrouterReasoningExclude: z.boolean(),
  asrProvider: z.enum(['disabled', 'openai-compatible']),
  asrBaseUrl: z.string().max(2048),
  asrApiKey: z.string().max(2048),
  asrModel: z.string().max(255),
  asrTimeoutMs: z.number().int().min(1000).max(120000),
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
    openrouterReasoningEffort: String(env.OPENROUTER_REASONING_EFFORT || '').trim().toLowerCase(),
    openrouterReasoningExclude: parseBoolean(env.OPENROUTER_REASONING_EXCLUDE),
    asrProvider: String(env.JARVIS_ASR_PROVIDER || 'disabled').trim().toLowerCase(),
    asrBaseUrl: String(env.ASR_BASE_URL || '').trim(),
    asrApiKey: String(env.ASR_API_KEY || '').trim(),
    asrModel: String(env.ASR_MODEL || '').trim(),
    asrTimeoutMs: Number(env.JARVIS_ASR_TIMEOUT_MS || 60000),
  };

  const config = baseSchema.parse(raw);
  if (config.nodeEnv === 'production') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required in production');
    if (!config.telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is required in production');
    if (config.telegramAllowedIds.length === 0) throw new Error('TELEGRAM_ALLOWED_IDS is required in production');
  }
  validateProvider(config, config.modelProvider);
  validateProvider(config, config.modelFallbackProvider);
  validateAsr(config);
  if (config.modelProvider !== 'echo' && config.modelProvider === config.modelFallbackProvider) {
    throw new Error('model fallback provider must differ from the primary provider');
  }
  return Object.freeze(config);
}

module.exports = {
  loadConfig,
  parseAllowedTelegramIds,
  parseBoolean,
  validateAsr,
};
