const path = require('node:path');

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.html', '.htm', '.rtf']);
const OFFICE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2']);

function safeDisplayName(value, fallback = 'file') {
  const normalized = String(value || fallback)
    .replace(/[\\/\0-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
  return normalized || fallback;
}

function fileExtension(name) {
  return path.extname(safeDisplayName(name)).toLowerCase();
}

function classifyAttachment(input = {}) {
  const name = safeDisplayName(input.name, 'file');
  const mimeType = String(input.mimeType || 'application/octet-stream').toLowerCase().slice(0, 100);
  const extension = fileExtension(name);
  const telegramKind = String(input.telegramKind || 'document').toLowerCase();
  let category = 'binary';

  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/')) category = 'text';
  else if (extension === '.pdf' || OFFICE_EXTENSIONS.has(extension) || /(?:pdf|officedocument|opendocument)/.test(mimeType)) category = 'document';
  else if (telegramKind === 'audio' || telegramKind === 'voice' || mimeType.startsWith('audio/')) category = 'audio';
  else if (telegramKind === 'video' || telegramKind === 'video_note' || telegramKind === 'animation' || mimeType.startsWith('video/')) category = 'video';
  else if (telegramKind === 'photo' || telegramKind === 'sticker' || mimeType.startsWith('image/')) category = 'image';
  else if (ARCHIVE_EXTENSIONS.has(extension) || /(?:zip|rar|7z|tar|gzip)/.test(mimeType)) category = 'archive';

  return Object.freeze({
    category,
    extension,
    mediaType: mimeType,
    name,
    textExtractable: category === 'text',
  });
}

function attachmentFromTelegramMessage(message = {}) {
  const candidate = message.document
    || message.audio
    || message.video
    || message.video_note
    || message.voice
    || message.animation
    || (Array.isArray(message.photo) ? message.photo.at(-1) : null)
    || message.sticker;
  if (!candidate || !candidate.file_id) return null;

  const telegramKind = message.document ? 'document'
    : message.audio ? 'audio'
      : message.video ? 'video'
        : message.video_note ? 'video_note'
          : message.voice ? 'voice'
            : message.animation ? 'animation'
              : message.photo ? 'photo'
                : 'sticker';
  const fallbackName = `${telegramKind}-${String(candidate.file_unique_id || candidate.file_id).slice(0, 32)}`;
  const classified = classifyAttachment({
    telegramKind,
    name: candidate.file_name || fallbackName,
    mimeType: candidate.mime_type || (telegramKind === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
  });

  return Object.freeze({
    ...classified,
    fileId: String(candidate.file_id),
    fileUniqueId: String(candidate.file_unique_id || ''),
    byteSize: Number(candidate.file_size || 0),
    durationSeconds: Number.isFinite(Number(candidate.duration)) ? Math.max(0, Math.min(86400, Number(candidate.duration))) : null,
    caption: String(message.caption || '').trim().slice(0, 1000),
    performer: String(candidate.performer || '').trim().slice(0, 200),
    title: String(candidate.title || '').trim().slice(0, 200),
  });
}

module.exports = {
  ARCHIVE_EXTENSIONS,
  OFFICE_EXTENSIONS,
  TEXT_EXTENSIONS,
  attachmentFromTelegramMessage,
  classifyAttachment,
  fileExtension,
  safeDisplayName,
};
