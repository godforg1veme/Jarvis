const { Bot, InputFile } = require('grammy');
const { sendTelegramText, splitTelegramText } = require('./telegramFormatting');
const { isLifeCallback } = require('./telegramLifeOsService');
const { isVpnCallback } = require('../vpn/vpnCommandService');
const { TELEGRAM_FAILURE_CODES, classifyTelegramFailure, telegramFailureReply } = require('./telegramFailure');

const VPN_CALLBACK_RE = /^vpn:(?:menu|status|health|clients|new|restart|routing|pc|sub:(?:menu|new|(?:view|rotate|revoke|repair):[a-f0-9-]{36})|probe:(?:menu|enable|disable|(?:install|rotate|recheck):(?:de|nl):[vh])|c:(?:de|nl)|p:[vh]|(?:(?:de|nl):)?[vh]:(?:menu|status|clients|new|restart|routing|pc|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12})|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12}|(?:confirm|reject):[a-f0-9-]{36})$/i;
const TELEGRAM_CALLBACK_RE = /^(?:vpn:(?:menu|status|health|clients|new|restart|routing|pc|sub:(?:menu|new|(?:view|rotate|revoke|repair):[a-f0-9-]{36})|probe:(?:menu|enable|disable|(?:install|rotate|recheck):(?:de|nl):[vh])|c:(?:de|nl)|p:[vh]|(?:(?:de|nl):)?[vh]:(?:menu|status|clients|new|restart|routing|pc|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12})|(?:client|export|rotate|revoke):vpn-[a-f0-9]{12}|(?:confirm|reject):[a-f0-9-]{36})|vpsup:(?:allow|reject|details):[a-f0-9-]{36}|cmd:(?:confirm|reject):[a-f0-9-]{36}|life:(?:confirm|dismiss):[a-f0-9-]{36}|mem:(?:menu|list|add|correct|forget|(?:edit|forget_prompt|forget_confirm):[a-f0-9-]{36})|doc:(?:menu|add|cancel|(?:del_prompt|delete):[a-f0-9-]{36})|dev:(?:menu|list|pair|cancel|(?:(?:select|task|revoke_prompt|revoke):[a-f0-9-]{36}))|flow:cancel:[a-f0-9-]{36}|gallery:(?:(?:page|keep):[0-9]{1,4}|(?:open|delete):[dv]:[a-f0-9-]{36}:[0-9]{1,4}))$/i;

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
        const validCallback = data && !url && Buffer.byteLength(data, 'utf8') <= 64 && (TELEGRAM_CALLBACK_RE.test(data) || isLifeCallback(data) || isVpnCallback(data));
        const validOperationsUrl = url && !data && options.operationsPanelUrl && url === options.operationsPanelUrl;
        const validRoutingUrl = url && !data && (url === 'https://jarvis.rilora.ru/happ-routing' || (options.routingUrl && url === options.routingUrl));
        const validSubscriptionUrl = url && !data && (
          url.startsWith('https://jarvis.rilora.ru/happ-sub/') ||
          (options.publicUrl && url.startsWith(`${options.publicUrl}/happ-sub/`))
        );
        const validUrl = validOperationsUrl || validRoutingUrl || validSubscriptionUrl;
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

function validatedMedia(media, options = {}) {
  const configuredLimit = Number(options.mediaMaxBytes);
  const limit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, 20 * 1024 * 1024)
    : 20 * 1024 * 1024;
  const content = media?.content;
  const filename = String(media?.filename || '');
  const contentType = String(media?.contentType || '');
  const caption = String(media?.caption || '');
  if (!['photo', 'document'].includes(media?.kind) || !Buffer.isBuffer(content) || content.length < 1 || content.length > limit) throw new Error('invalid Telegram media');
  if (filename.length < 1 || filename.length > 100 || /[\\/\0]/.test(filename)) throw new Error('invalid Telegram media filename');
  if (!/^[\w.+-]+\/[\w.+-]+$/i.test(contentType) || caption.length > 1024) throw new Error('invalid Telegram media metadata');
  const jpeg = contentType === 'image/jpeg' && content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const png = contentType === 'image/png' && content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (media.kind === 'photo' && !jpeg && !png) throw new Error('invalid Telegram photo');
  return { kind: media.kind, content, filename, contentType, caption, markup: vpnReplyMarkup(media.buttons, options) };
}

async function sendTelegramMedia(ctx, media, options = {}) {
  const valid = validatedMedia(media, options);
  const sendOptions = {
    ...(valid.caption ? { caption: valid.caption } : {}),
    ...(valid.markup ? { reply_markup: valid.markup } : {}),
  };
  const input = new InputFile(valid.content, valid.filename);
  try {
    if (valid.kind === 'photo') return await ctx.replyWithPhoto(input, sendOptions);
    return await ctx.replyWithDocument(input, sendOptions);
  } catch (_) {
    throw new Error('Telegram media delivery failed');
  }
}

async function sendResult(ctx, result, options = {}) {
  if (result.status === 'forbidden') {
    await ctx.reply('Доступ к этому Jarvis не разрешён.');
    return;
  }
  if (result.status !== 'answered') return;
  if (result.media) {
    await sendTelegramMedia(ctx, result.media, options);
    return;
  }
  await replyWithChunks(ctx, result.answer, result.buttons, result.replyKeyboard, options);
  if (result.artifact) {
    const artifact = result.artifact;
    const content = String(artifact.content || '');
    const validVless = artifact.kind === 'happ-vless' && content.startsWith('vless://') && /^.{1,80}\.txt$/u.test(artifact.filename) && content.length <= 4096;
    const validHysteria2 = artifact.kind === 'happ-hysteria2' && (content.startsWith('hy2://') || content.startsWith('hysteria2://')) && /^.{1,80}\.txt$/u.test(artifact.filename) && content.length <= 4096;
    const validRouting = artifact.kind === 'happ-routing' && /^.{1,80}\.(json|txt|yaml)$/u.test(artifact.filename) && content.length <= 65536;
    if (!validVless && !validHysteria2 && !validRouting) {
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

async function deliverResult(ctx, result, options) {
  try {
    await sendResult(ctx, result, options);
  } catch (_) {
    // Telegram API errors may contain the bot-token URL; keep only a closed type.
    const error = new Error('Telegram delivery failed');
    error.name = 'TelegramDeliveryError';
    throw error;
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
    if (!TELEGRAM_CALLBACK_RE.test(data) && !isLifeCallback(data) && !isVpnCallback(data)) return next();
    await ctx.answerCallbackQuery().catch(() => {});
    const result = typeof messageService.handleCallback === 'function'
      ? await messageService.handleCallback(ctx.update)
      : (data.startsWith('vpn:') ? await messageService.handleVpnCallback(ctx.update) : null);
    if (result) await deliverResult(ctx, result, { operationsPanelUrl: options.operationsPanelUrl, mediaMaxBytes: options.documentMaxBytes });
  });

  if (typeof options.approvalHandler === 'function') {
    bot.on('callback_query:data', options.approvalHandler);
  }

  bot.on('message', async (ctx) => {
    const result = await messageService.handle(ctx.update, {
      downloadAttachment: () => downloadTelegramAttachment(ctx, options.token, options.documentMaxBytes, options.fetchImpl),
      downloadVoice: () => downloadTelegramAttachment(ctx, options.token, options.voiceMaxBytes, options.fetchImpl),
    });
    await deliverResult(ctx, result, { operationsPanelUrl: options.operationsPanelUrl, mediaMaxBytes: options.documentMaxBytes });
  });

  bot.catch(async (error) => {
    const updateId = error.ctx && error.ctx.update && error.ctx.update.update_id;
    const failureCode = classifyTelegramFailure(error.error);
    options.logger.error({ telegramFailureCode: failureCode, updateId }, 'Telegram update delivery failed');
    try {
      await error.ctx.reply(telegramFailureReply(failureCode));
    } catch (_) {
      options.logger.warn({ telegramFailureCode: TELEGRAM_FAILURE_CODES.TELEGRAM_FALLBACK_DELIVERY_FAILED, updateId }, 'Telegram fallback reply delivery failed');
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
  sendTelegramMedia,
  sendResult,
  splitTelegramText,
  telegramReplyMarkup: vpnReplyMarkup,
  validatedReplyKeyboard,
  validatedMedia,
  vpnReplyMarkup,
};
