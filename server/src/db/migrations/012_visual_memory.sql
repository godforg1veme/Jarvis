CREATE TABLE visual_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  lease_id text NOT NULL CHECK (char_length(lease_id) BETWEEN 1 AND 128),
  frame_id text NOT NULL CHECK (char_length(frame_id) BETWEEN 1 AND 128),
  source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 128),
  state text NOT NULL CHECK (state IN ('pending_sensitive_consent', 'stored', 'rejected', 'expired', 'deleted')),
  sensitivity text NOT NULL CHECK (sensitivity IN ('none', 'possible', 'sensitive')),
  blob_key text,
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  confidence double precision CHECK (confidence BETWEEN 0 AND 1),
  captured_at timestamptz NOT NULL,
  expires_at timestamptz,
  pending_expires_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  corrected_summary text NOT NULL DEFAULT '' CHECK (char_length(corrected_summary) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, frame_id)
);

CREATE INDEX visual_memories_owner_timeline_idx ON visual_memories (user_id, captured_at DESC);
CREATE INDEX visual_memories_retention_idx ON visual_memories (state, expires_at) WHERE pinned = false;
CREATE INDEX visual_memories_pending_idx ON visual_memories (state, pending_expires_at);

CREATE TABLE visual_memory_tokens (
  memory_id uuid NOT NULL REFERENCES visual_memories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  PRIMARY KEY (memory_id, token_hash)
);

CREATE INDEX visual_memory_tokens_owner_search_idx ON visual_memory_tokens (user_id, token_hash);
