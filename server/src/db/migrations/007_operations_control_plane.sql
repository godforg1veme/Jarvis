CREATE TABLE ops_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_key text NOT NULL UNIQUE CHECK (host_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'unavailable', 'unknown')),
  last_contact_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  service_key text NOT NULL CHECK (service_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  service_type text NOT NULL CHECK (service_type IN ('systemd', 'docker', 'jarvis', 'parser', 'backup', 'provider')),
  source_state text NOT NULL DEFAULT 'unknown' CHECK (source_state IN ('active', 'inactive', 'failed', 'unknown', 'unavailable')),
  health_state text NOT NULL DEFAULT 'unknown' CHECK (health_state IN ('healthy', 'degraded', 'unavailable', 'no_fresh_data', 'unknown')),
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, service_key)
);

CREATE TABLE ops_service_capabilities (
  service_id uuid NOT NULL REFERENCES ops_services(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('start', 'stop', 'restart')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, action)
);

CREATE TABLE ops_panel_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_verifier_hash bytea NOT NULL CHECK (octet_length(browser_verifier_hash) = 32),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  browser_label text NOT NULL DEFAULT '' CHECK (char_length(browser_label) <= 100),
  client_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(client_metadata) = 'object' AND octet_length(client_metadata::text) <= 2048),
  decided_at timestamptz,
  consumed_at timestamptz,
  CHECK (expires_at > requested_at)
);

CREATE INDEX ops_panel_approval_pending_idx
  ON ops_panel_approval_requests (state, expires_at) WHERE state = 'pending';

CREATE TABLE ops_panel_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_hash bytea NOT NULL UNIQUE CHECK (octet_length(credential_hash) = 32),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 100),
  client_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(client_metadata) = 'object' AND octet_length(client_metadata::text) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) BETWEEN 1 AND 80)
);

CREATE INDEX ops_panel_sessions_active_idx
  ON ops_panel_sessions (last_used_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE ops_operation_runs (
  id uuid PRIMARY KEY,
  panel_session_id uuid REFERENCES ops_panel_sessions(id) ON DELETE SET NULL,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  target_key text CHECK (target_key IS NULL OR target_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  idempotency_key_hash bytea NOT NULL CHECK (octet_length(idempotency_key_hash) = 32),
  request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint) = 32),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'succeeded', 'failed', 'unknown', 'cancelled')),
  result jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 8192)),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (panel_session_id, idempotency_key_hash)
);

CREATE INDEX ops_operation_runs_host_status_idx ON ops_operation_runs (host_id, status, created_at DESC);

CREATE TABLE ops_admin_audit (
  id bigserial PRIMARY KEY,
  panel_session_id uuid REFERENCES ops_panel_sessions(id) ON DELETE SET NULL,
  operation_run_id uuid REFERENCES ops_operation_runs(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_admin_audit_created_idx ON ops_admin_audit (created_at DESC);

CREATE TABLE ops_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  service_id uuid REFERENCES ops_services(id) ON DELETE CASCADE,
  failure_kind text NOT NULL CHECK (failure_kind ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  technical_detail text NOT NULL DEFAULT '' CHECK (char_length(technical_detail) <= 4000),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX ops_incidents_open_unique_idx
  ON ops_incidents (host_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid), failure_kind)
  WHERE state = 'open';

CREATE TABLE ops_events (
  id bigserial PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  service_id uuid REFERENCES ops_services(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_events_host_created_idx ON ops_events (host_id, created_at DESC);

CREATE TABLE ops_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  operation_run_id uuid UNIQUE REFERENCES ops_operation_runs(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'unknown')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 1000)
);

CREATE INDEX ops_backup_runs_host_started_idx ON ops_backup_runs (host_id, started_at DESC);

CREATE TABLE ops_maintenance_flags (
  flag text PRIMARY KEY CHECK (flag IN ('knowledge_writes_paused')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'system' CHECK (char_length(updated_by) BETWEEN 1 AND 100)
);

INSERT INTO ops_maintenance_flags (flag, enabled)
VALUES ('knowledge_writes_paused', false)
ON CONFLICT (flag) DO NOTHING;
