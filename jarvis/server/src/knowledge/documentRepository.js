const { vectorLiteral } = require('./embeddingProvider');
const { reciprocalRankFusion } = require('./hybridSearch');

class DocumentRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createPending(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const maintenance = await client.query(`
        SELECT enabled FROM ops_maintenance_flags
        WHERE flag='knowledge_writes_paused'
        FOR SHARE
      `);
      if (maintenance.rows[0] && maintenance.rows[0].enabled) {
        const error = new Error('knowledge writes are temporarily paused');
        error.code = 'KNOWLEDGE_WRITES_PAUSED';
        throw error;
      }
      const owner = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [input.userId]);
      if (owner.rowCount !== 1) throw new Error('document owner is unavailable');
      const total = await client.query(`
        SELECT COALESCE(SUM(byte_size), 0)::bigint AS byte_size
        FROM documents
        WHERE user_id = $1 AND status <> 'deleted'
      `, [input.userId]);
      const used = Number(total.rows[0].byte_size || 0);
      if (used + Number(input.byteSize) > Number(input.userQuotaBytes)) throw new Error('document quota exceeded');
      const result = await client.query(`
        INSERT INTO documents (id, user_id, original_name, media_type, storage_key, byte_size, sha256, category, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING id, user_id, original_name, media_type, storage_key, byte_size, category, metadata, status, extraction_mode, created_at
      `, [input.id, input.userId, input.originalName, input.mediaType, input.storageKey, input.byteSize, input.sha256, input.category, JSON.stringify(input.metadata || {})]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueIngest({ userId, documentId }) {
    const result = await this.pool.query(`
      INSERT INTO jobs (user_id, kind, payload, max_attempts)
      VALUES ($1, 'document_ingest', jsonb_build_object('documentId', $2::text), 3)
      RETURNING id, user_id, kind, payload, status, attempts, max_attempts
    `, [userId, documentId]);
    return result.rows[0];
  }

  async enqueueEmbedding({ userId, documentId }) {
    const result = await this.pool.query(`
      INSERT INTO jobs (user_id, kind, payload, max_attempts)
      VALUES ($1, 'document_embedding', jsonb_build_object('documentId', $2::text), 3)
      RETURNING id, user_id, kind, payload, status, attempts, max_attempts
    `, [userId, documentId]);
    return result.rows[0];
  }

  async enqueueMissingEmbeddings({ limit = 20 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const result = await this.pool.query(`
      INSERT INTO jobs (user_id, kind, payload, max_attempts)
      SELECT d.user_id, 'document_embedding', jsonb_build_object('documentId', d.id::text), 3
      FROM documents d
      WHERE d.status = 'ready' AND d.embedding_status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.user_id = d.user_id
            AND j.kind = 'document_embedding'
            AND j.payload->>'documentId' = d.id::text
            AND j.status IN ('queued', 'running')
        )
      ORDER BY d.updated_at ASC, d.id ASC
      LIMIT $1
      RETURNING id, user_id, kind, payload, status, attempts, max_attempts
    `, [boundedLimit]);
    return result.rows;
  }

  async getForUser({ userId, documentId }) {
    const result = await this.pool.query(`
      SELECT id, user_id, original_name, media_type, storage_key, byte_size, category, metadata, status, extraction_mode, embedding_status, embedding_model, failure_code, created_at, updated_at
      FROM documents
      WHERE id = $1 AND user_id = $2 AND status <> 'deleted'
    `, [documentId, userId]);
    return result.rows[0] || null;
  }

  async getForWorker(documentId) {
    const result = await this.pool.query(`
      SELECT id, user_id, original_name, media_type, storage_key, byte_size, category, metadata, status, extraction_mode, failure_code, created_at, updated_at
      FROM documents
      WHERE id = $1 AND status IN ('pending', 'processing')
    `, [documentId]);
    return result.rows[0] || null;
  }

  async getForEmbedding(documentId) {
    const result = await this.pool.query(`
      SELECT id, user_id, original_name, media_type, category, metadata, status, extraction_mode,
             embedding_status, embedding_model
      FROM documents
      WHERE id = $1 AND status = 'ready' AND embedding_status IN ('pending', 'failed')
    `, [documentId]);
    if (!result.rows[0]) return null;
    const chunks = await this.pool.query(`
      SELECT id, position, content, metadata
      FROM document_chunks
      WHERE document_id = $1 AND user_id = $2
      ORDER BY position ASC
    `, [documentId, result.rows[0].user_id]);
    return { ...result.rows[0], chunks: chunks.rows };
  }

  async listForUser({ userId, limit = 30 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const result = await this.pool.query(`
      SELECT id, original_name, media_type, byte_size, category, metadata, status, extraction_mode, embedding_status, embedding_model, failure_code, created_at, updated_at
      FROM documents
      WHERE user_id = $1 AND status <> 'deleted'
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `, [userId, boundedLimit]);
    return result.rows;
  }

  async getActiveForUser({ userId, documentId }) {
    const result = await this.pool.query(`
      SELECT id,original_name,media_type,storage_key,byte_size,category,status
      FROM documents
      WHERE id=$1 AND user_id=$2 AND status<>'deleted'
    `, [documentId, userId]);
    return result.rows[0] || null;
  }

  async claimNextIngest(workerId) {
    const result = await this.pool.query(`
      WITH maintenance AS MATERIALIZED (
        SELECT enabled FROM ops_maintenance_flags
        WHERE flag='knowledge_writes_paused' FOR SHARE
      ), next_job AS (
        SELECT id
        FROM jobs
        WHERE kind IN ('document_ingest', 'document_embedding')
          AND status = 'queued'
          AND available_at <= now()
          AND EXISTS (SELECT 1 FROM maintenance WHERE NOT enabled)
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $1, updated_at = now()
      FROM next_job
      WHERE jobs.id = next_job.id
      RETURNING jobs.id, jobs.user_id, jobs.kind, jobs.payload, jobs.attempts, jobs.max_attempts
    `, [String(workerId).slice(0, 100)]);
    return result.rows[0] || null;
  }

  async markReady({ userId, documentId, chunks, extractionMode, embeddingStatus = 'not_requested' }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`
        UPDATE documents
        SET status = 'ready', extraction_mode = $3, embedding_status = $4,
            embedding_model = NULL, failure_code = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'processing')
        RETURNING id
      `, [documentId, userId, extractionMode, embeddingStatus]);
      if (updated.rowCount !== 1) throw new Error('document is unavailable for indexing');
      await client.query('DELETE FROM document_chunks WHERE document_id = $1 AND user_id = $2', [documentId, userId]);
      for (const chunk of chunks) {
        await client.query(`
          INSERT INTO document_chunks (user_id, document_id, position, content, metadata)
          VALUES ($1, $2, $3, $4, $5::jsonb)
        `, [userId, documentId, chunk.position, chunk.content, JSON.stringify(chunk.metadata || {})]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markEmbeddings({ userId, documentId, embeddings, model }) {
    if (!Array.isArray(embeddings)) throw new Error('embeddings are required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const document = await client.query(`
        SELECT id FROM documents
        WHERE id = $1 AND user_id = $2 AND status = 'ready'
        FOR UPDATE
      `, [documentId, userId]);
      if (document.rowCount !== 1) throw new Error('document is unavailable for embedding');
      const chunks = await client.query(`
        SELECT id, position FROM document_chunks
        WHERE document_id = $1 AND user_id = $2
        ORDER BY position ASC
      `, [documentId, userId]);
      if (chunks.rowCount !== embeddings.length) throw new Error('embedding count does not match document chunks');
      for (let index = 0; index < chunks.rows.length; index += 1) {
        await client.query(`
          UPDATE document_chunks
          SET embedding = $3::vector
          WHERE id = $1 AND document_id = $2 AND user_id = $4
        `, [chunks.rows[index].id, documentId, vectorLiteral(embeddings[index]), userId]);
      }
      await client.query(`
        UPDATE documents
        SET embedding_status = 'ready', embedding_model = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2
      `, [documentId, userId, String(model || '').slice(0, 255) || null]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJob(jobId) {
    await this.pool.query(`
      UPDATE jobs SET status = 'succeeded', updated_at = now()
      WHERE id = $1 AND status = 'running'
    `, [jobId]);
  }

  async failJob({ jobId, userId, documentId, attempts, maxAttempts, failureCode }) {
    const retry = Number(attempts) < Number(maxAttempts);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (retry) {
        await client.query(`
          UPDATE jobs
          SET status = 'queued', available_at = now() + interval '30 seconds', locked_at = NULL, locked_by = NULL,
              last_error_code = $2, updated_at = now()
          WHERE id = $1 AND status = 'running'
        `, [jobId, failureCode]);
      } else {
        await client.query(`
          UPDATE jobs
          SET status = 'failed', last_error_code = $2, updated_at = now()
          WHERE id = $1 AND status = 'running'
        `, [jobId, failureCode]);
        await client.query(`
          UPDATE documents
          SET status = 'failed', failure_code = $3, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'processing')
        `, [documentId, userId, failureCode]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failEmbeddingJob({ jobId, userId, documentId, attempts, maxAttempts, failureCode }) {
    const retry = Number(attempts) < Number(maxAttempts);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (retry) {
        await client.query(`
          UPDATE jobs
          SET status = 'queued', available_at = now() + interval '30 seconds', locked_at = NULL, locked_by = NULL,
              last_error_code = $2, updated_at = now()
          WHERE id = $1 AND status = 'running'
        `, [jobId, failureCode]);
      } else {
        await client.query(`
          UPDATE jobs
          SET status = 'failed', last_error_code = $2, updated_at = now()
          WHERE id = $1 AND status = 'running'
        `, [jobId, failureCode]);
        await client.query(`
          UPDATE documents
          SET embedding_status = 'failed', updated_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'ready'
        `, [documentId, userId]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async search({ userId, query, queryEmbedding = null, limit = 8 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const candidateLimit = Math.min(Math.max(boundedLimit * 4, 8), 40);
    const lexicalPromise = this.pool.query(`
      SELECT c.id, c.document_id, c.position, c.content, c.metadata, d.original_name, d.media_type, d.category,
             ts_rank_cd(c.search_vector, plainto_tsquery('simple', $2)) AS lexical_score
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
      WHERE c.user_id = $1
        AND d.status = 'ready'
        AND c.search_vector @@ plainto_tsquery('simple', $2)
      ORDER BY ts_rank_cd(c.search_vector, plainto_tsquery('simple', $2)) DESC, c.document_id, c.position
      LIMIT $3
    `, [userId, String(query).slice(0, 1000), candidateLimit]);

    if (!Array.isArray(queryEmbedding)) return (await lexicalPromise).rows.slice(0, boundedLimit);
    const semanticPromise = this.pool.query(`
      SELECT c.id, c.document_id, c.position, c.content, c.metadata, d.original_name, d.media_type, d.category,
             1 - (c.embedding <=> $2::vector) AS semantic_score
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
      WHERE c.user_id = $1 AND d.status = 'ready' AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2::vector ASC, c.document_id, c.position
      LIMIT $3
    `, [userId, vectorLiteral(queryEmbedding), candidateLimit]);
    const [lexical, semantic] = await Promise.all([lexicalPromise, semanticPromise]);
    const lexicalRows = lexical.rows.map((row) => ({ ...row, lexical_score: row.lexical_score || 0 }));
    return reciprocalRankFusion([lexicalRows, semantic.rows], { limit: boundedLimit });
  }

  async deleteForUser({ userId, documentId }) {
    const result = await this.pool.query(`
      DELETE FROM documents
      WHERE id = $1 AND user_id = $2
      RETURNING storage_key, original_name
    `, [documentId, userId]);
    return result.rows[0] || null;
  }
}

module.exports = { DocumentRepository };
