const crypto = require('node:crypto');
const { storageKeyForId } = require('./documentStorage');
const { chunkText, extractDocumentText } = require('./documentText');
const { classifyAttachment, safeDisplayName } = require('./fileTypes');
const { recordDocumentEvent } = require('../life/lifeSourceEvents');

const DEFAULT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

function boundedByteSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : 0;
}

function normalizeAttachment(input = {}) {
  const classified = classifyAttachment(input);
  return {
    ...classified,
    byteSize: boundedByteSize(input.byteSize),
    durationSeconds: input.durationSeconds === null || input.durationSeconds === undefined ? null : Number(input.durationSeconds),
    caption: String(input.caption || '').trim().slice(0, 1000),
    performer: String(input.performer || '').trim().slice(0, 200),
    title: String(input.title || '').trim().slice(0, 200),
  };
}

function publicDocumentStatus(document) {
  const states = {
    pending: 'ожидает индексации',
    processing: 'индексируется',
    ready: document.embedding_status === 'pending'
      ? 'готов (текстовый поиск; semantic indexing выполняется)'
      : document.embedding_status === 'failed'
      ? 'готов (текстовый поиск; semantic indexing недоступен)'
      : document.extraction_mode === 'metadata' ? 'готов (поиск по имени и метаданным)' : 'готов',
    failed: 'ошибка индексации',
  };
  return states[document.status] || 'неизвестно';
}

function renderDocumentCitations(answer, sources) {
  return String(answer || '').replace(/\[S([1-9][0-9]*)\]/g, (match, rawIndex) => {
    const source = sources[Number(rawIndex) - 1];
    if (!source) return '';
    const page = source.metadata && Number.isInteger(Number(source.metadata.page)) ? `, стр. ${source.metadata.page}` : '';
    return `[${source.originalName}${page}]`;
  });
}

class KnowledgeService {
  constructor(options) {
    this.repository = options.repository;
    this.storage = options.storage;
    this.maxBytes = Number(options.maxBytes || DEFAULT_DOCUMENT_MAX_BYTES);
    this.userQuotaBytes = Number(options.userQuotaBytes || (1024 * 1024 * 1024));
    this.extract = options.extract || extractDocumentText;
    this.chunk = options.chunk || chunkText;
    this.embeddingProvider = options.embeddingProvider || null;
    this.lifeEventGateway = options.lifeEventGateway || null;
  }

  async ingest({ userId, attachment, data }) {
    const normalized = normalizeAttachment(attachment);
    if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('document download is empty');
    if (normalized.byteSize && normalized.byteSize !== data.length) throw new Error('document size changed during download');
    if (data.length > this.maxBytes) throw new Error('document is too large');

    const id = crypto.randomUUID();
    const storageKey = storageKeyForId(id);
    const sha256 = crypto.createHash('sha256').update(data).digest();
    await this.storage.write(storageKey, data);
    try {
      const document = await this.repository.createPending({
        id,
        userId,
        originalName: safeDisplayName(normalized.name),
        mediaType: normalized.mediaType,
        storageKey,
        byteSize: data.length,
        sha256,
        category: normalized.category,
        userQuotaBytes: this.userQuotaBytes,
        metadata: {
          durationSeconds: normalized.durationSeconds,
          caption: normalized.caption,
          performer: normalized.performer,
          title: normalized.title,
          telegramFileUniqueId: String(attachment.fileUniqueId || '').slice(0, 200),
        },
      });
      await this.repository.enqueueIngest({ userId, documentId: id });
      return { ...document, ...normalized, id };
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => {});
      throw error;
    }
  }

  async processJob(job) {
    const documentId = job && job.payload && String(job.payload.documentId || '');
    if (!/^[a-f0-9-]{36}$/i.test(documentId)) throw new Error('invalid document ingest job');
    const document = await this.repository.getForWorker(documentId);
    if (!document) {
      await this.repository.completeJob(job.id);
      return { status: 'skipped' };
    }
    let documentReady = false;
    try {
      const buffer = await this.storage.read(document.storage_key);
      const storagePath = typeof this.storage.pathFor === 'function'
        ? this.storage.pathFor(document.storage_key)
        : undefined;
      const extracted = await this.extract({
        buffer,
        storagePath,
        document: {
          originalName: document.original_name,
          mediaType: document.media_type,
          category: document.category,
          ...(document.metadata || {}),
        },
      });
      const chunks = Array.isArray(extracted.chunks) ? extracted.chunks : this.chunk(extracted.content);
      if (chunks.length === 0) throw new Error('document contains no indexable content');
      await this.repository.markReady({
        userId: document.user_id,
        documentId: document.id,
        chunks,
        extractionMode: extracted.mode,
        embeddingStatus: this.embeddingProvider ? 'pending' : 'not_requested',
      });
      documentReady = true;
      if (this.embeddingProvider && typeof this.repository.enqueueEmbedding === 'function') {
        await this.repository.enqueueEmbedding({ userId: document.user_id, documentId: document.id });
      }
      await this.repository.completeJob(job.id);
      await recordDocumentEvent(this.lifeEventGateway, {
        userId: document.user_id,
        documentId: document.id,
        name: document.original_name,
        category: document.category,
      });
      return { status: 'ready', chunks: chunks.length };
    } catch (error) {
      if (documentReady && this.embeddingProvider) {
        // The text index is already usable. Leave the document ready and let
        // the worker recreate a missing embedding job on a later pass.
        await this.repository.completeJob(job.id);
      } else {
        await this.repository.failJob({
          jobId: job.id,
          userId: document.user_id,
          documentId: document.id,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          failureCode: 'document_ingest_failed',
        });
        if (Number(job.attempts) >= Number(job.max_attempts)) {
          await recordDocumentEvent(this.lifeEventGateway, {
            userId: document.user_id,
            documentId: document.id,
            name: document.original_name,
            category: document.category,
            failed: true,
          });
        }
      }
      throw error;
    }
  }

  async processEmbeddingJob(job) {
    const documentId = job && job.payload && String(job.payload.documentId || '');
    if (!/^[a-f0-9-]{36}$/i.test(documentId)) throw new Error('invalid document embedding job');
    if (!this.embeddingProvider) {
      await this.repository.completeJob(job.id);
      return { status: 'skipped' };
    }
    const document = await this.repository.getForEmbedding(documentId);
    if (!document) {
      await this.repository.completeJob(job.id);
      return { status: 'skipped' };
    }
    try {
      const embeddings = await this.embeddingProvider.embedDocuments(document.chunks.map((chunk) => chunk.content));
      await this.repository.markEmbeddings({
        userId: document.user_id,
        documentId: document.id,
        embeddings,
        model: this.embeddingProvider.model,
      });
      await this.repository.completeJob(job.id);
      return { status: 'ready', chunks: embeddings.length };
    } catch (error) {
      await this.repository.failEmbeddingJob({
        jobId: job.id,
        userId: document.user_id,
        documentId: document.id,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        failureCode: 'document_embedding_failed',
      });
      throw error;
    }
  }

  async searchForPrompt({ userId, query }) {
    const text = String(query || '').trim();
    if (text.length < 2) return [];
    let queryEmbedding = null;
    if (this.embeddingProvider) {
      try {
        queryEmbedding = await this.embeddingProvider.embedQuery(text);
      } catch (_) {
        // FTS remains available when the embedding service is unavailable.
        queryEmbedding = null;
      }
    }
    let results;
    try {
      results = await this.repository.search({ userId, query: text, queryEmbedding, limit: 8 });
    } catch (error) {
      if (!queryEmbedding) throw error;
      // A stale vector profile must degrade to lexical search instead of hiding the knowledge base.
      results = await this.repository.search({ userId, query: text, queryEmbedding: null, limit: 8 });
    }
    return results.map((result, index) => ({
      source: `S${index + 1}`,
      originalName: result.original_name,
      mediaType: result.media_type,
      category: result.category,
      content: String(result.content || '').slice(0, 6000),
      metadata: result.metadata && typeof result.metadata === 'object' ? result.metadata : {},
    }));
  }

  async list({ userId }) {
    return this.repository.listForUser({ userId, limit: 30 });
  }

  async readForDelivery({ userId, documentId }) {
    const document = await this.repository.getActiveForUser({ userId, documentId });
    if (!document) return null;
    let content;
    try {
      content = await this.storage.read(document.storage_key);
    } catch (_) {
      throw new Error('document preview unavailable');
    }
    if (!Buffer.isBuffer(content) || content.length === 0 || content.length > this.maxBytes) throw new Error('document preview unavailable');
    const contentType = /^[\w.+-]+\/[\w.+-]+$/i.test(String(document.media_type || ''))
      ? String(document.media_type).toLowerCase()
      : 'application/octet-stream';
    return {
      content,
      contentType,
      filename: safeDisplayName(document.original_name),
      category: document.category,
      byteLength: content.length,
    };
  }

  async remove({ userId, documentId }) {
    const deleted = await this.repository.deleteForUser({ userId, documentId });
    if (!deleted) return null;
    await this.storage.remove(deleted.storage_key).catch(() => {});
    return deleted;
  }
}

class KnowledgeWorker {
  constructor(options) {
    this.repository = options.repository;
    this.service = options.service;
    this.logger = options.logger || null;
    this.workerId = options.workerId || `knowledge-${process.pid}`;
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs || 2000), 250), 60000);
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    void this.runOnce();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      if (typeof this.repository.enqueueMissingEmbeddings === 'function') {
        await this.repository.enqueueMissingEmbeddings({ limit: 20 });
      }
      const job = await this.repository.claimNextIngest(this.workerId);
      if (job) {
        if (job.kind === 'document_embedding') await this.service.processEmbeddingJob(job);
        else await this.service.processJob(job);
      }
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') this.logger.warn({ err: error }, 'knowledge ingest job failed');
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  DEFAULT_DOCUMENT_MAX_BYTES,
  KnowledgeService,
  KnowledgeWorker,
  normalizeAttachment,
  publicDocumentStatus,
  renderDocumentCitations,
};
