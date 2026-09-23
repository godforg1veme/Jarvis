ALTER TABLE vpn_supervisor_runs
  DROP CONSTRAINT vpn_supervisor_runs_status_check,
  ADD CONSTRAINT vpn_supervisor_runs_status_check CHECK (status IN (
    'planning', 'awaiting_owner', 'approved', 'executing', 'verifying',
    'succeeded', 'rejected', 'expired', 'stale', 'failed', 'unknown'
  ));

CREATE UNIQUE INDEX vpn_supervisor_one_active_per_host_idx
  ON vpn_supervisor_runs (host_id)
  WHERE status IN ('planning', 'awaiting_owner', 'approved', 'executing', 'verifying', 'unknown');

CREATE UNIQUE INDEX vpn_supervisor_one_repair_attempt_per_incident_idx
  ON vpn_supervisor_runs (host_id, incident_revision)
  WHERE synthetic = false AND safe_metadata ? 'repairRequestId';
