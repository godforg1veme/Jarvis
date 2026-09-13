const { Bot, InputFile } = require('grammy');
const { sendTelegramText, splitTelegramText } = require('./telegramFormatting');

const VPN_CALLBACK_RE = /^vpn:(?:menu|status|clients|new|restart|p:[vh]|[vh]:(?:menu|status|clients|new|restart|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12})|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12}|(?:confirm|reject):[a-f0-9-]{36})$/i;
const TELEGRAM_CALLBACK_RE = /^(?:vpn:(?:menu|status|clients|new|restart|p:[vh]|[vh]:(?:menu|status|clients|new|restart|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12})|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12}|(?:confirm|reject):[a-f0-9-]{36})|cmd:(?:confirm|reject):[a-f0-9-]{36}|life:(?:confirm|dismiss):[a-f0-9-]{36}|doc:(?:del_prompt|delete):[a-f0-9-]{36}|doc:cancel|dev:(?:revoke_prompt|revoke):[a-f0-9-]{36}|dev:cancel)$/i;

function vpnReplyMarkup(buttons) {
  if (buttons === undefined) return undefined;
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 60) throw new Error('invalid VPN buttons');
  return {
    inline_keyboard: buttons.map((row) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 3) throw new Error('invalid VPN button row');
      return row.map((button) => {
        const text = String(button?.text || '');
        const data = String(button?.data || '');
        if (text.length < 1 || text.length > 64 || Buffer.byteLength(data, 'utf8') > 64 || !TELEGRAM_CALLBACK_RE.test(data)) {
          throw new Error('invalid VPN button');
        }
        return { text, callback_data: data };
      });
    }),
  };
}

async function replyWithChunks(ctx, text, buttons) {
  const markup = vpnReplyMarkup(buttons);
  await sendTelegramText(
    (chunk, options) => ctx.reply(chunk, options),
    text,
    markup ? { reply_markup: markup } : {},
  );
}

async function sendResult(ctx, result) {
  if (result.status === 'forbidden') {
    await ctx.reply('Доступ к этому Jarvis не разрешён.');
    return;
  }
  if (result.status !== 'answered') return;
  await replyWithChunks(ctx, result.answer, result.buttons);
  if (result.artifact) {
    const artifact = result.artifact;
    if (artifact.kind !== 'happ-vless' || !/^.{1,80}\.txt$/u.test(artifact.filename) || !String(artifact.content || '').startsWith('vless://') || String(artifact.content).length > 4096) {
      throw new Error('invalid VPN artifact');
    }
    await ctx.replyWithDocument(new InputFile(Buffer.from(artifact.content, 'utf8'), artifact.filename));
  }
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

  bot.on('callback_query:data', async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');
    if (!TELEGRAM_CALLBACK_RE.test(data)) return next();
    await ctx.answerCallbackQuery().catch(() => {});
    const result = typeof messageService.handleCallback === 'function'
      ? await messageService.handleCallback(ctx.update)
      : (data.startsWith('vpn:') ? await messageService.handleVpnCallback(ctx.update) : null);
    if (result) await sendResult(ctx, result);
  });

  if (typeof options.approvalHandler === 'function') {
    bot.on('callback_query:data', options.approvalHandler);
  }

  bot.on('message', async (ctx) => {
    const result = await messageService.handle(ctx.update, {
      downloadAttachment: () => downloadTelegramAttachment(ctx, options.token, options.documentMaxBytes, options.fetchImpl),
      downloadVoice: () => downloadTelegramAttachment(ctx, options.token, options.voiceMaxBytes, options.fetchImpl),
    });
    await sendResult(ctx, result);
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

module.exports = {
  TELEGRAM_CALLBACK_RE,
  VPN_CALLBACK_RE,
  createTelegramBot,
  downloadTelegramAttachment,
  replyWithChunks,
  sendResult,
  splitTelegramText,
  telegramReplyMarkup: vpnReplyMarkup,
  vpnReplyMarkup,
};
