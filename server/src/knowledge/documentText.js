const path = require('node:path');
const zlib = require('node:zlib');

const MAX_EXTRACTED_CHARS = 500000;
const CHUNK_SIZE = 5000;
const CHUNK_OVERLAP = 500;
const MAX_DOCX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function decodeText(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('buffer is required');
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1] || 0;
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/u, '');
}

function normalizeText(value, limit = MAX_EXTRACTED_CHARS) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/giu, (entity, hex, decimal) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()] || entity;
    });
}

function wordXmlToText(xml) {
  return decodeXmlEntities(String(xml || '')
    .replace(/<w:tab\b[^>]*\/?\s*>/giu, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/giu, '\n')
    .replace(/<\/w:p\s*>/giu, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function findEndOfCentralDirectory(buffer) {
  const firstOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= firstOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error('invalid DOCX archive');
}

function readDocxXmlEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_DOCX_ARCHIVE_BYTES) {
    throw new Error('DOCX archive is invalid or too large');
  }
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entriesOnDisk !== entryCount || centralOffset + centralSize > eocdOffset || entryCount > 10000) {
    throw new Error('DOCX archive uses an unsupported directory');
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) throw new Error('invalid DOCX central directory');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const headerEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (headerEnd > buffer.length || (flags & 0x1) !== 0) throw new Error('DOCX archive contains unsupported entries');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const selected = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/iu.test(name);
    if (selected) {
      if (uncompressedSize > MAX_DOCX_UNCOMPRESSED_BYTES || totalUncompressed + uncompressedSize > MAX_DOCX_UNCOMPRESSED_BYTES) {
        throw new Error('DOCX extracted text is too large');
      }
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) throw new Error('invalid DOCX local entry');
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + compressedSize > buffer.length) throw new Error('invalid DOCX entry bounds');
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      let content;
      if (method === 0) content = Buffer.from(compressed);
      else if (method === 8) content = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_DOCX_UNCOMPRESSED_BYTES - totalUncompressed });
      else throw new Error('DOCX compression method is unsupported');
      if (content.length !== uncompressedSize) throw new Error('invalid DOCX entry size');
      totalUncompressed += content.length;
      entries.set(name, content);
    }
    offset = headerEnd;
  }
  return entries;
}

function extractDocxText(buffer) {
  const entries = readDocxXmlEntries(buffer);
  if (!entries.has('word/document.xml')) throw new Error('DOCX document body is missing');
  return Array.from(entries.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, content]) => wordXmlToText(content.toString('utf8')))
    .join('\n');
}

function metadataText(document) {
  const lines = [
    `Файл: ${document.originalName}`,
    `Категория: ${document.category}`,
    `Тип: ${document.mediaType}`,
  ];
  if (document.durationSeconds !== null && document.durationSeconds !== undefined) lines.push(`Длительность: ${document.durationSeconds} с`);
  if (document.performer) lines.push(`Исполнитель: ${document.performer}`);
  if (document.title) lines.push(`Название: ${document.title}`);
  if (document.caption) lines.push(`Подпись пользователя: ${document.caption}`);
  return normalizeText(lines.join('\n'), 5000);
}

function extractDocumentText({ buffer, document }) {
  const metadata = metadataText(document);
  if (path.extname(String(document.originalName || '')).toLowerCase() === '.docx') {
    const content = normalizeText(`${metadata}\n\n${extractDocxText(buffer)}`);
    return { content, mode: 'content' };
  }
  if (document.category !== 'text') return { content: metadata, mode: 'metadata' };
  let text = decodeText(buffer);
  if (/\.html?$/iu.test(document.originalName) || document.mediaType === 'text/html') text = stripHtml(text);
  const content = normalizeText(`${metadata}\n\n${text}`);
  return { content, mode: 'content' };
}

function chunkText(value, metadata = {}) {
  const text = normalizeText(value);
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf(' ', end));
      if (boundary > start + Math.floor(CHUNK_SIZE / 2)) end = boundary;
    }
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ position: chunks.length, content, metadata: { ...metadata } });
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

module.exports = {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  MAX_DOCX_ARCHIVE_BYTES,
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_EXTRACTED_CHARS,
  chunkText,
  decodeText,
  extractDocumentText,
  extractDocxText,
  findEndOfCentralDirectory,
  metadataText,
  normalizeText,
  readDocxXmlEntries,
  stripHtml,
  wordXmlToText,
};
