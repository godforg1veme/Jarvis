class DocumentRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createPending(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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

  async getForUser({ userId, documentId }) {
    const result = await this.pool.query(`
      SELECT id, user_id, original_name, media_type, storage_key, byte_size, category, metadata, status, extraction_mode, failure_code, created_at, updated_at
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

  async listForUser({ userId, limit = 30 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const result = await this.pool.query(`
      SELECT id, original_name, media_type, byte_size, category, metadata, status, extraction_mode, failure_code, created_at, updated_at
      FROM documents
      WHERE user_id = $1 AND status <> 'deleted'
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `, [userId, boundedLimit]);
    return result.rows;
  }

  async claimNextIngest(workerId) {
    const result = await this.pool.query(`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE kind = 'document_ingest'
          AND status = 'queued'
          AND available_at <= now()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $1, updated_at = now()
      FROM next_job
      WHERE jobs.id = next_job.id
      RETURNING jobs.id, jobs.user_id, jobs.payload, jobs.attempts, jobs.max_attempts
    `, [String(workerId).slice(0, 100)]);
    return result.rows[0] || null;
  }

  async markReady({ userId, documentId, chunks, extractionMode }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`
        UPDATE documents
        SET status = 'ready', extraction_mode = $3, failure_code = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'processing')
        RETURNING id
      `, [documentId, userId, extractionMode]);
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
          WHERE id = $1 AND user_id = $2
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

  async search({ userId, query, limit = 8 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const result = await this.pool.query(`
      SELECT c.id, c.document_id, c.position, c.content, c.metadata, d.original_name, d.media_type, d.category
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
      WHERE c.user_id = $1
        AND d.status = 'ready'
        AND c.search_vector @@ plainto_tsquery('simple', $2)
      ORDER BY ts_rank_cd(c.search_vector, plainto_tsquery('simple', $2)) DESC, c.document_id, c.position
      LIMIT $3
    `, [userId, String(query).slice(0, 1000), boundedLimit]);
    return result.rows;
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
