const { Bot } = require('grammy');

function splitTelegramText(text, maxLength = 4000) {
  const chunks = [];
  let remaining = String(text || '');
  while (remaining.length > maxLength) {
    let boundary = remaining.lastIndexOf('\n', maxLength);
    if (boundary < Math.floor(maxLength / 2)) boundary = remaining.lastIndexOf(' ', maxLength);
    if (boundary < Math.floor(maxLength / 2)) boundary = maxLength;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function replyWithChunks(ctx, text) {
  for (const chunk of splitTelegramText(text)) await ctx.reply(chunk);
}

function createTelegramBot(options) {
  const bot = new Bot(options.token);
  const messageService = options.messageService;

  bot.on('message:text', async (ctx) => {
    const result = await messageService.handle(ctx.update);
    if (result.status === 'forbidden') {
      await ctx.reply('Доступ к этому Jarvis не разрешён.');
      return;
    }
    if (result.status === 'answered') await replyWithChunks(ctx, result.answer);
  });

  bot.catch(async (error) => {
    const updateId = error.ctx && error.ctx.update && error.ctx.update.update_id;
    options.logger.error({ err: error.error, updateId }, 'Telegram update failed');
    try {
      await error.ctx.reply('Не удалось обработать сообщение. Попробуйте ещё раз позже.');
    } catch (replyError) {
      options.logger.warn({ err: replyError, updateId }, 'Telegram error reply failed');
    }
  });

  return bot;
}

module.exports = { createTelegramBot, replyWithChunks, splitTelegramText };
