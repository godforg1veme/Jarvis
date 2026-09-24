CREATE TABLE vpn_supervisor_runs (
  id uuid PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  synthetic boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN (
    'planning', 'awaiting_owner', 'approved', 'rejected', 'succeeded',
    'expired', 'stale', 'failed'
  )),
  incident_code text NOT NULL CHECK (incident_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  incident_revision text NOT NULL CHECK (incident_revision ~ '^[a-f0-9]{64}$'),
  prompt_version text NOT NULL CHECK (prompt_version ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  catalog_version text NOT NULL CHECK (catalog_version ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  playbook_id text CHECK (playbook_id IS NULL OR playbook_id IN (
    'restart_xray', 'restart_hysteria2', 'restore_xray_known_good',
    'restore_hysteria2_known_good', 'supervisor_acceptance_noop'
  )),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  confidence text CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(safe_metadata) = 'object' AND octet_length(safe_metadata::text) <= 4096
  ),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vpn_supervisor_one_active_synthetic_idx
  ON vpn_supervisor_runs (host_id)
  WHERE synthetic = true AND status IN ('planning', 'awaiting_owner', 'approved');

CREATE INDEX vpn_supervisor_runs_created_idx
  ON vpn_supervisor_runs (host_id, created_at DESC);
