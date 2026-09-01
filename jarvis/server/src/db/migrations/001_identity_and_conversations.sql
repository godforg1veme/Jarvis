CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('telegram', 'pwa')),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('telegram', 'pwa', 'desktop')),
  external_chat_id text NOT NULL CHECK (char_length(external_chat_id) BETWEEN 1 AND 128),
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, external_chat_id)
);

CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_type text NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'voice_transcript', 'document', 'tool')),
  content text NOT NULL CHECK (char_length(content) <= 100000),
  external_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_message_id)
);

CREATE INDEX messages_user_created_idx ON messages (user_id, created_at DESC);
CREATE INDEX messages_conversation_created_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE telegram_updates (
  update_id bigint PRIMARY KEY,
  telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^[0-9]{1,20}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);
