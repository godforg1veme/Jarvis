CREATE TABLE telegram_interactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id text NOT NULL CHECK (chat_id ~ '^-?[0-9]{1,20}$'),
  kind text NOT NULL CHECK (kind IN (
    'vpn_access_label',
    'device_pairing_name',
    'device_instruction',
    'memory_add',
    'memory_correct_replacement'
  )),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(context) = 'object'
    AND octet_length(convert_to(context::text, 'UTF8')) <= 1024
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX telegram_interactions_active_conversation_idx
  ON telegram_interactions (user_id, conversation_id)
  WHERE status = 'active';

CREATE INDEX telegram_interactions_expiry_idx
  ON telegram_interactions (expires_at)
  WHERE status = 'active';
