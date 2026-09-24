ALTER TABLE telegram_updates
  ADD COLUMN update_kind text
    CHECK (update_kind IS NULL OR update_kind IN ('message', 'callback'));

CREATE INDEX telegram_updates_kind_idx
  ON telegram_updates (update_kind, received_at DESC)
  WHERE update_kind IS NOT NULL;
