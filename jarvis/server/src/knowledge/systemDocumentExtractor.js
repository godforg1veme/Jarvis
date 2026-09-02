const childProcess = require('node:child_process');
const path = require('node:path');
const { chunkText, extractDocumentText, metadataText, normalizeText } = require('./documentText');

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30000;

function runCommand({ executable, args, execFileImpl = childProcess.execFile }) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, args, {
      encoding: 'utf8',
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(new Error('document extractor failed'));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function withPositions(chunks) {
  return chunks.map((chunk, position) => ({ ...chunk, position }));
}

function chunksForPdfText(text, document) {
  const metadataChunks = chunkText(metadataText(document), { type: 'metadata' });
  const pages = String(text || '').split('\f').map((page) => normalizeText(page)).filter(Boolean);
  const pageChunks = pages.flatMap((page, index) => chunkText(page, { page: index + 1, type: 'pdf_page' }));
  return withPositions([...metadataChunks, ...pageChunks]);
}

function normalizeMediaMetadata(raw) {
  const format = raw && raw.format && typeof raw.format === 'object' ? raw.format : {};
  const tags = format.tags && typeof format.tags === 'object' ? format.tags : {};
  const duration = Number(format.duration);
  return {
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? Math.min(Math.round(duration), 86400) : null,
    title: String(tags.title || '').trim().slice(0, 200),
    performer: String(tags.artist || tags.album_artist || '').trim().slice(0, 200),
  };
}

class SystemDocumentExtractor {
  constructor(options = {}) {
    this.pdfToTextBin = options.pdfToTextBin || 'pdftotext';
    this.ffprobeBin = options.ffprobeBin || 'ffprobe';
    this.runCommand = options.runCommand || runCommand;
  }

  async extract({ buffer, document, storagePath }) {
    const extension = path.extname(String(document.originalName || '')).toLowerCase();
    if (extension === '.pdf') {
      const text = await this.runCommand({
        executable: this.pdfToTextBin,
        args: ['-enc', 'UTF-8', storagePath, '-'],
      });
      const chunks = chunksForPdfText(text, document);
      if (chunks.length <= 1) return { content: metadataText(document), mode: 'metadata' };
      return { chunks, mode: 'content' };
    }

    if (document.category === 'audio' || document.category === 'video') {
      try {
        const output = await this.runCommand({
          executable: this.ffprobeBin,
          args: ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist,album_artist', '-of', 'json', storagePath],
        });
        const metadata = normalizeMediaMetadata(JSON.parse(output));
        return {
          content: metadataText({ ...document, ...metadata }),
          mode: 'metadata',
        };
      } catch {
        // A corrupt or unsupported media stream must not make a private upload unavailable.
        return extractDocumentText({ buffer, document });
      }
    }

    return extractDocumentText({ buffer, document });
  }
}

module.exports = {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  SystemDocumentExtractor,
  chunksForPdfText,
  normalizeMediaMetadata,
  runCommand,
};
