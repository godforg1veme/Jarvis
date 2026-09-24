ALTER TABLE telegram_updates
  ADD COLUMN status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('processing', 'completed', 'failed')),
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN failure_code text
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{2,79}$');

CREATE INDEX telegram_updates_failed_idx
  ON telegram_updates (failed_at DESC)
  WHERE status = 'failed';
