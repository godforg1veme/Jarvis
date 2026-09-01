ALTER TABLE conversations
  ADD CONSTRAINT conversations_id_user_unique UNIQUE (id, user_id);

ALTER TABLE messages
  ADD CONSTRAINT messages_conversation_user_fk
  FOREIGN KEY (conversation_id, user_id)
  REFERENCES conversations(id, user_id)
  ON DELETE CASCADE;

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'revoked')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities) = 'object'),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE INDEX devices_user_status_idx ON devices (user_id, status);

CREATE TABLE device_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 100),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_pairing_codes_user_expiry_idx ON device_pairing_codes (user_id, expires_at DESC);

CREATE TABLE device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  remote_address_hash bytea,
  FOREIGN KEY (device_id, user_id) REFERENCES devices(id, user_id) ON DELETE CASCADE
);

CREATE INDEX device_sessions_device_connected_idx ON device_sessions (device_id, connected_at DESC);

CREATE TABLE commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  conversation_id uuid,
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'pwa', 'desktop')),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(arguments) = 'object'),
  policy text NOT NULL CHECK (policy IN ('observe', 'low_risk', 'requires_confirmation', 'requires_strong_confirmation')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (device_id, user_id) REFERENCES devices(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE SET NULL (conversation_id)
);

CREATE INDEX commands_user_created_idx ON commands (user_id, created_at DESC);
CREATE INDEX commands_device_status_idx ON commands (device_id, status, created_at);

CREATE TABLE command_steps (
  id bigserial PRIMARY KEY,
  command_id uuid NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(arguments) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_id, position)
);

CREATE TABLE confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_id uuid NOT NULL UNIQUE REFERENCES commands(id) ON DELETE CASCADE,
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'pwa', 'desktop')),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 1000),
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX confirmations_user_pending_idx ON confirmations (user_id, decision, expires_at);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  command_id uuid REFERENCES commands(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_user_created_idx ON audit_events (user_id, created_at DESC);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('profile', 'preference', 'fact', 'summary')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  source_conversation_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (source_conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE SET NULL (source_conversation_id)
);

CREATE INDEX memories_user_active_idx ON memories (user_id, active, updated_at DESC);

CREATE TABLE memory_versions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  change_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (memory_id, user_id) REFERENCES memories(id, user_id) ON DELETE CASCADE
);

CREATE INDEX memory_versions_memory_created_idx ON memory_versions (memory_id, created_at DESC);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  media_type text NOT NULL CHECK (char_length(media_type) BETWEEN 1 AND 100),
  storage_key text NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 500),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE INDEX documents_user_created_idx ON documents (user_id, created_at DESC);

CREATE TABLE document_chunks (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 50000),
  embedding vector,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE,
  UNIQUE (document_id, position)
);

CREATE INDEX document_chunks_user_document_idx ON document_chunks (user_id, document_id, position);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 100),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_poll_idx ON jobs (status, available_at, created_at) WHERE status = 'queued';
CREATE INDEX jobs_user_created_idx ON jobs (user_id, created_at DESC);
