CREATE TABLE vpn_action_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'desktop')),
  origin_device_id uuid,
  action text NOT NULL CHECK (action IN ('issue', 'revoke', 'rotate', 'export', 'restart')),
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(arguments) = 'object' AND octet_length(convert_to(arguments::text, 'UTF8')) <= 2048
  ),
  request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint) = 32),
  status text NOT NULL CHECK (status IN ('awaiting_confirmation', 'running', 'succeeded', 'failed', 'unknown', 'cancelled', 'expired')),
  result jsonb CHECK (
    result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(convert_to(result::text, 'UTF8')) <= 4096)
  ),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (origin_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE RESTRICT,
  CHECK ((origin_channel = 'desktop' AND origin_device_id IS NOT NULL) OR (origin_channel = 'telegram' AND origin_device_id IS NULL))
);

CREATE INDEX vpn_action_requests_owner_status_idx
  ON vpn_action_requests (user_id, status, created_at DESC);

CREATE TABLE vpn_audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action_request_id uuid REFERENCES vpn_action_requests(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type ~ '^vpn\.[a-z0-9_.-]{1,100}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(convert_to(metadata::text, 'UTF8')) <= 2048
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vpn_audit_events_created_idx ON vpn_audit_events (created_at DESC);

