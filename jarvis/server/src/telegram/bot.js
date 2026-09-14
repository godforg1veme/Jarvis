const { Bot, InputFile } = require('grammy');
const { sendTelegramText, splitTelegramText } = require('./telegramFormatting');

const VPN_CALLBACK_RE = /^vpn:(?:menu|status|clients|new|restart|p:[vh]|[vh]:(?:menu|status|clients|new|restart|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12})|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12}|(?:confirm|reject):[a-f0-9-]{36})$/i;
const TELEGRAM_CALLBACK_RE = /^(?:vpn:(?:menu|status|clients|new|restart|p:[vh]|[vh]:(?:menu|status|clients|new|restart|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12})|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12}|(?:confirm|reject):[a-f0-9-]{36})|cmd:(?:confirm|reject):[a-f0-9-]{36}|life:(?:confirm|dismiss):[a-f0-9-]{36}|mem:(?:menu|list|add|correct|forget|(?:edit|forget_prompt|forget_confirm):[a-f0-9-]{36})|doc:(?:menu|add|cancel|(?:del_prompt|delete):[a-f0-9-]{36})|dev:(?:menu|list|pair|cancel|(?:(?:select|task|revoke_prompt|revoke):[a-f0-9-]{36}))|flow:cancel:[a-f0-9-]{36})$/i;

function vpnReplyMarkup(buttons, options = {}) {
  if (buttons === undefined) return undefined;
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 60) throw new Error('invalid VPN buttons');
  return {
    inline_keyboard: buttons.map((row) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 3) throw new Error('invalid VPN button row');
      return row.map((button) => {
        const text = String(button?.text || '');
        const data = String(button?.data || '');
        const url = String(button?.url || '');
        const validCallback = data && !url && Buffer.byteLength(data, 'utf8') <= 64 && TELEGRAM_CALLBACK_RE.test(data);
        const validUrl = url && !data && options.operationsPanelUrl && url === options.operationsPanelUrl;
        if (text.length < 1 || text.length > 64 || (!validCallback && !validUrl)) {
          throw new Error('invalid VPN button');
        }
        return validUrl ? { text, url } : { text, callback_data: data };
      });
    }),
  };
}

function validatedReplyKeyboard(value) {
  if (value === undefined) return undefined;
  if (!value || !Array.isArray(value.keyboard) || value.keyboard.length < 1 || value.keyboard.length > 8) throw new Error('invalid Telegram reply keyboard');
  const keyboard = value.keyboard.map((row) => {
    if (!Array.isArray(row) || row.length < 1 || row.length > 3) throw new Error('invalid Telegram reply keyboard');
    return row.map((button) => {
      const text = String(button?.text || '');
      if (text.length < 1 || text.length > 64) throw new Error('invalid Telegram reply keyboard');
      return { text };
    });
  });
  return { keyboard, resize_keyboard: true, is_persistent: true };
}

async function replyWithChunks(ctx, text, buttons, replyKeyboard, options = {}) {
  if (buttons !== undefined && replyKeyboard !== undefined) throw new Error('Telegram message cannot mix inline and reply keyboards');
  const markup = buttons !== undefined
    ? vpnReplyMarkup(buttons, options)
    : validatedReplyKeyboard(replyKeyboard);
  await sendTelegramText(
    (chunk, options) => ctx.reply(chunk, options),
    text,
    markup ? { reply_markup: markup } : {},
  );
}

async function sendResult(ctx, result, options = {}) {
  if (result.status === 'forbidden') {
    await ctx.reply('Доступ к этому Jarvis не разрешён.');
    return;
  }
  if (result.status !== 'answered') return;
  await replyWithChunks(ctx, result.answer, result.buttons, result.replyKeyboard, options);
  if (result.artifact) {
    const artifact = result.artifact;
    const content = String(artifact.content || '');
    const validVless = artifact.kind === 'happ-vless' && content.startsWith('vless://');
    const validHysteria2 = artifact.kind === 'happ-hysteria2' && (content.startsWith('hy2://') || content.startsWith('hysteria2://'));
    if ((!validVless && !validHysteria2) || !/^.{1,80}\.txt$/u.test(artifact.filename) || content.length > 4096) {
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
    if (result) await sendResult(ctx, result, { operationsPanelUrl: options.operationsPanelUrl });
  });

  if (typeof options.approvalHandler === 'function') {
    bot.on('callback_query:data', options.approvalHandler);
  }

  bot.on('message', async (ctx) => {
    const result = await messageService.handle(ctx.update, {
      downloadAttachment: () => downloadTelegramAttachment(ctx, options.token, options.documentMaxBytes, options.fetchImpl),
      downloadVoice: () => downloadTelegramAttachment(ctx, options.token, options.voiceMaxBytes, options.fetchImpl),
    });
    await sendResult(ctx, result, { operationsPanelUrl: options.operationsPanelUrl });
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
  validatedReplyKeyboard,
  vpnReplyMarkup,
};
