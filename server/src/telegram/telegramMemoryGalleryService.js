const path = require('node:path');
const { safeDisplayName } = require('../knowledge/fileTypes');
const { MAX_GALLERY_PAGE, boundedPage } = require('./telegramMemoryGalleryRepository');

const MAX_TELEGRAM_PREVIEW_BYTES = 20 * 1024 * 1024;
const UUID_PART = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const GALLERY_CALLBACK_RE = new RegExp(`^gallery:(?:page:([0-9]{1,4})|keep:([0-9]{1,4})|(open|delete):(d|v):(${UUID_PART}):([0-9]{1,4}))$`, 'i');

function parseGalleryCallback(value) {
  const match = GALLERY_CALLBACK_RE.exec(String(value || ''));
  if (!match) return null;
  if (match[1] !== undefined) return { action: 'page', page: boundedPage(match[1]) };
  if (match[2] !== undefined) return { action: 'keep', page: boundedPage(match[2]) };
  return { action: match[3].toLowerCase(), source: match[4].toLowerCase(), id: match[5].toLowerCase(), page: boundedPage(match[6]) };
}

function itemIcon(item) {
  if (item.source_kind === 'v') return /камер/i.test(item.label) ? '📷' : '🖥';
  if (item.category === 'image') return '🖼';
  if (item.category === 'audio') return '🎵';
  if (item.category === 'video') return '🎬';
  if (['text', 'document'].includes(item.category)) return '📄';
  return '📦';
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU');
}

function previewButtons(source, id, page) {
  return [[
    { text: '🗑 Удалить', data: `gallery:delete:${source}:${id}:${page}` },
    { text: '✅ Оставить', data: `gallery:keep:${page}` },
  ], [{ text: '← Назад', data: `gallery:page:${page}` }]];
}

function isTelegramPhoto(content, contentType) {
  if (!Buffer.isBuffer(content)) return false;
  if (contentType === 'image/jpeg') return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  if (contentType === 'image/png') return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

function decodeVisualImage(read) {
  const contentType = String(read?.payload?.contentType || '').toLowerCase();
  const encoded = String(read?.payload?.image || '');
  if (!/^image\/(?:jpeg|png|webp)$/i.test(contentType) || !/^[a-z0-9+/]+={0,2}$/i.test(encoded) || encoded.length > Math.ceil(MAX_TELEGRAM_PREVIEW_BYTES / 3) * 4 + 4) {
    throw new Error('visual preview unavailable');
  }
  const content = Buffer.from(encoded, 'base64');
  if (!content.length || content.length > MAX_TELEGRAM_PREVIEW_BYTES) throw new Error('visual preview unavailable');
  const extension = contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : '.jpg';
  return { content, contentType, filename: `jarvis-frame${extension}` };
}

class TelegramMemoryGalleryService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.knowledgeService = options.knowledgeService;
    this.visualMemoryService = options.visualMemoryService || null;
  }

  async listPage({ userId, page = 0, prefix = '' }) {
    const result = await this.repository.listPage({ userId, page, includeVisual: Boolean(this.visualMemoryService) });
    const lines = result.items.map((item) => `${itemIcon(item)} ${item.label}${safeDate(item.event_at) ? ` · ${safeDate(item.event_at)}` : ''}`);
    const buttons = result.items.map((item) => [{
      text: `${itemIcon(item)} ${String(item.label || 'Файл').slice(0, 45)}`,
      data: `gallery:open:${item.source_kind}:${item.id}:${result.page}`,
    }]);
    const navigation = [];
    if (result.page > 0) navigation.push({ text: '⬅️', data: `gallery:page:${result.page - 1}` });
    if (result.hasNext && result.page < MAX_GALLERY_PAGE) navigation.push({ text: '➡️', data: `gallery:page:${result.page + 1}` });
    if (navigation.length) buttons.push(navigation);
    buttons.push([{ text: '← В память', data: 'mem:menu' }]);
    const answer = result.items.length ? `Файлы и кадры, страница ${result.page + 1}:\n${lines.join('\n')}` : 'На этой странице файлов и кадров нет.';
    return { answer: `${prefix}${answer}`, buttons };
  }

  async preview(callback, context) {
    let delivery;
    try {
      if (callback.source === 'd') {
        delivery = await this.knowledgeService.readForDelivery({ userId: context.userId, documentId: callback.id });
      } else if (this.visualMemoryService) {
        const read = await this.visualMemoryService.read({ userId: context.userId, memoryId: callback.id });
        if (read) delivery = decodeVisualImage(read);
      }
    } catch (_) {
      return this.listPage({ userId: context.userId, page: callback.page, prefix: 'Файл не удалось подготовить для отправки. Он не удалён.\n\n' });
    }
    if (!delivery) return this.listPage({ userId: context.userId, page: callback.page, prefix: 'Этот файл уже недоступен.\n\n' });
    const photo = isTelegramPhoto(delivery.content, delivery.contentType) && delivery.content.length <= MAX_TELEGRAM_PREVIEW_BYTES;
    return {
      answer: 'Файл отправлен для просмотра.',
      media: {
        kind: photo ? 'photo' : 'document',
        content: delivery.content,
        contentType: delivery.contentType,
        filename: safeDisplayName(delivery.filename || `jarvis-file${path.extname(delivery.filename || '')}`).slice(0, 100),
        caption: 'Удалить этот файл или оставить?',
        buttons: previewButtons(callback.source, callback.id, callback.page),
      },
    };
  }

  async remove(callback, context) {
    const removed = callback.source === 'd'
      ? await this.knowledgeService.remove({ userId: context.userId, documentId: callback.id })
      : this.visualMemoryService && await this.visualMemoryService.remove({ userId: context.userId, memoryId: callback.id });
    return this.listPage({
      userId: context.userId,
      page: callback.page,
      prefix: removed ? 'Удалено.\n\n' : 'Этот файл уже недоступен.\n\n',
    });
  }

  async handleCallback(value, context) {
    const callback = parseGalleryCallback(value);
    if (!callback) return null;
    if (callback.action === 'page' || callback.action === 'keep') return this.listPage({ userId: context.userId, page: callback.page });
    if (callback.action === 'open') return this.preview(callback, context);
    return this.remove(callback, context);
  }
}

module.exports = {
  GALLERY_CALLBACK_RE,
  MAX_TELEGRAM_PREVIEW_BYTES,
  TelegramMemoryGalleryService,
  decodeVisualImage,
  itemIcon,
  isTelegramPhoto,
  parseGalleryCallback,
  previewButtons,
};
