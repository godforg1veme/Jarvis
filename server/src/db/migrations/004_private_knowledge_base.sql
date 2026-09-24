ALTER TABLE documents
  ADD COLUMN category text NOT NULL DEFAULT 'document'
    CHECK (category IN ('text', 'document', 'image', 'audio', 'video', 'archive', 'binary')),
  ADD COLUMN extraction_mode text NOT NULL DEFAULT 'pending'
    CHECK (extraction_mode IN ('pending', 'content', 'metadata')),
  ADD COLUMN failure_code text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object');

ALTER TABLE document_chunks
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX document_chunks_search_idx ON document_chunks USING gin (search_vector);
