const GALLERY_PAGE_SIZE = 8;
const MAX_GALLERY_PAGE = 9999;

function boundedPage(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 0 || page > MAX_GALLERY_PAGE) throw new Error('invalid Telegram gallery page');
  return page;
}

class TelegramMemoryGalleryRepository {
  constructor(pool) { this.pool = pool; }

  async listPage({ userId, page = 0, includeVisual = false }) {
    const bounded = boundedPage(page);
    const result = await this.pool.query(`
      WITH gallery AS (
        SELECT 'd'::text AS source_kind, id, original_name AS label,
               media_type, category, byte_size AS byte_length, created_at AS event_at
        FROM documents
        WHERE user_id=$1 AND status<>'deleted'
        UNION ALL
        SELECT 'v'::text AS source_kind, id,
               CASE
                 WHEN source_id ILIKE '%camera%' THEN 'Кадр камеры'
                 WHEN source_id ILIKE '%screen%' OR source_id ILIKE '%display%' OR source_id ILIKE '%workspace%' THEN 'Снимок экрана'
                 ELSE 'Визуальный кадр'
               END AS label,
               'image/jpeg'::text AS media_type, 'visual'::text AS category,
               byte_length, captured_at AS event_at
        FROM visual_memories
        WHERE user_id=$1 AND $2::boolean AND state='stored' AND blob_key IS NOT NULL
      )
      SELECT source_kind,id,label,media_type,category,byte_length,event_at
      FROM gallery
      ORDER BY event_at DESC,id DESC
      LIMIT $3 OFFSET $4
    `, [userId, includeVisual === true, GALLERY_PAGE_SIZE + 1, bounded * GALLERY_PAGE_SIZE]);
    return {
      items: result.rows.slice(0, GALLERY_PAGE_SIZE),
      page: bounded,
      hasNext: result.rows.length > GALLERY_PAGE_SIZE,
    };
  }
}

module.exports = { GALLERY_PAGE_SIZE, MAX_GALLERY_PAGE, TelegramMemoryGalleryRepository, boundedPage };
