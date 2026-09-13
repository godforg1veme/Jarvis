const { Bot, InputFile } = require('grammy');
const { sendTelegramText, splitTelegramText } = require('./telegramFormatting');

async function replyWithChunks(ctx, text) {
  await sendTelegramText((chunk, options) => ctx.reply(chunk, options), text);
}

async function downloadTelegramAttachment(ctx, token, maxBytes = 20 * 1024 * 1024, fetchImpl = globalThis.fetch) {
  try {
    const file = await ctx.getFile();
    if (!file || !file.file_path) throw new Error('missing file path');
    const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new Error('file response failed');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) throw new Error('file is too large');
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > maxBytes) throw new Error('file is too large');
    return data;
  } catch {
    // Do not retain a caught network error: Telegram's file URL contains the bot token.
    throw new Error('Telegram document download failed');
  }
}

function createTelegramBot(options) {
  const bot = new Bot(options.token);
  const messageService = options.messageService;
  if (options.onPollingHealth) bot.api.config.use(async (previous, method, payload, signal) => {
    try {
      const result = await previous(method, payload, signal);
      if (method === 'getUpdates') options.onPollingHealth({ at: Date.now(), ok: result.ok === true });
      return result;
    } catch (error) {
      if (method === 'getUpdates') options.onPollingHealth({ at: Date.now(), ok: false });
      throw error;
    }
  });

  if (typeof options.approvalHandler === 'function') {
    bot.on('callback_query:data', options.approvalHandler);
  }

  bot.on('message', async (ctx) => {
    const result = await messageService.handle(ctx.update, {
      downloadAttachment: () => downloadTelegramAttachment(ctx, options.token, options.documentMaxBytes, options.fetchImpl),
      downloadVoice: () => downloadTelegramAttachment(ctx, options.token, options.voiceMaxBytes, options.fetchImpl),
    });
    if (result.status === 'forbidden') {
      await ctx.reply('Доступ к этому Jarvis не разрешён.');
      return;
    }
    if (result.status === 'answered') {
      await replyWithChunks(ctx, result.answer);
      if (result.artifact) {
        const artifact = result.artifact;
        if (artifact.kind !== 'happ-vless' || !/^.{1,80}\.txt$/u.test(artifact.filename) || !String(artifact.content || '').startsWith('vless://') || String(artifact.content).length > 4096) {
          throw new Error('invalid VPN artifact');
        }
        await ctx.replyWithDocument(new InputFile(Buffer.from(artifact.content, 'utf8'), artifact.filename));
      }
    }
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

module.exports = { createTelegramBot, downloadTelegramAttachment, replyWithChunks, splitTelegramText };
