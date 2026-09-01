const { buildApp } = require('./app');
const { AssistantService } = require('./assistant/assistantService');
const { createPool, databaseReadinessCheck } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { createAnswerProvider } = require('./providers/providerFactory');
const { providerProfileForConfig } = require('./providers/providerProfile');
const { createTelegramAccessPolicy } = require('./telegram/accessPolicy');
const { createTelegramBot } = require('./telegram/bot');
const { TelegramMessageService } = require('./telegram/messageService');
const { TelegramUpdateRepository } = require('./telegram/telegramUpdateRepository');
const { UserRepository } = require('./users/userRepository');
const { ConversationRepository } = require('./conversations/conversationRepository');

async function createRuntime(config, overrides = {}) {
  let pool = overrides.pool || null;
  if (!pool && config.databaseUrl) pool = createPool(config);

  const readinessChecks = pool ? [databaseReadinessCheck(pool)] : [];
  const app = overrides.app || buildApp({ config, readinessChecks });
  let bot = overrides.bot || null;

  if (pool) {
    await (overrides.runMigrations || runMigrations)(pool);
  }

  if (!bot && pool && config.telegramBotToken) {
    const answerProvider = overrides.provider || createAnswerProvider(config, {
      onFallback(name, error) {
        app.log.warn({ provider: name, err: error }, 'model provider fallback');
      },
    });
    const assistant = overrides.assistant || new AssistantService({
      provider: answerProvider,
      profile: providerProfileForConfig(config),
      logger: app.log,
    });
    const messageService = new TelegramMessageService({
      accessPolicy: createTelegramAccessPolicy(config.telegramAllowedIds),
      updateRepository: new TelegramUpdateRepository(pool),
      userRepository: new UserRepository(pool),
      conversationRepository: new ConversationRepository(pool),
      assistant,
    });
    bot = createTelegramBot({ token: config.telegramBotToken, messageService, logger: app.log });
  }

  return {
    app,
    bot,
    pool,
    async start() {
      await app.listen({ host: config.host, port: config.port });
      if (bot) void bot.start().catch((error) => app.log.error({ err: error }, 'Telegram polling stopped'));
    },
    async close() {
      if (bot && (typeof bot.isRunning !== 'function' || bot.isRunning())) await bot.stop();
      await app.close();
      if (pool) await pool.end();
    },
  };
}

module.exports = { createRuntime };
