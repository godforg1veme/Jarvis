CREATE TABLE desktop_requests (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  client_message_id text NOT NULL CHECK (client_message_id ~ '^[a-zA-Z0-9_.:-]{1,128}$'),
  conversation_id uuid,
  kind text NOT NULL CHECK (kind IN ('text', 'voice')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  response jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_message_id),
  FOREIGN KEY (device_id, user_id) REFERENCES devices(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE SET NULL
);

CREATE INDEX desktop_requests_user_created_idx ON desktop_requests (user_id, created_at DESC);
CREATE INDEX desktop_requests_device_status_idx ON desktop_requests (device_id, status, created_at DESC);
