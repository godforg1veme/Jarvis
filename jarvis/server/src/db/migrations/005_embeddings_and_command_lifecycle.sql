ALTER TABLE documents
  ADD COLUMN embedding_status text NOT NULL DEFAULT 'not_requested'
    CHECK (embedding_status IN ('not_requested', 'pending', 'ready', 'failed')),
  ADD COLUMN embedding_model text;

ALTER TABLE commands
  ADD COLUMN origin_device_id uuid,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD CONSTRAINT commands_origin_device_fk
    FOREIGN KEY (origin_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE RESTRICT;

CREATE INDEX commands_origin_device_idx ON commands (origin_device_id, created_at DESC);

CREATE INDEX commands_active_expiry_idx
  ON commands (status, expires_at)
  WHERE expires_at IS NOT NULL;
