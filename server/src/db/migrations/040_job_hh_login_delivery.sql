ALTER TABLE job_hh_login_sessions
  ADD COLUMN telegram_delivery_status text NOT NULL DEFAULT 'none'
    CHECK (telegram_delivery_status IN ('none','sending','sent','failed','unknown')),
  ADD COLUMN telegram_delivery_chat_id text
    CHECK (telegram_delivery_chat_id IS NULL OR telegram_delivery_chat_id ~ '^[1-9][0-9]{0,19}$'),
  ADD COLUMN telegram_delivery_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN telegram_delivery_at timestamptz;
