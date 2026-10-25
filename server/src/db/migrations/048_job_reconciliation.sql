-- Daily full reconciliation has its own cursor and schedule, with the shared
-- per-user lease, settings and access checks.
ALTER TABLE job_searches
  ADD COLUMN reconciliation_checkpoint timestamptz,
  ADD COLUMN reconciliation_progress jsonb,
  ADD COLUMN reconciliation_next_check_at timestamptz NOT NULL DEFAULT now()+interval '1 day';

CREATE INDEX job_searches_reconciliation_due_idx ON job_searches(reconciliation_next_check_at,user_id)
  WHERE settings->>'activated'='true' AND settings->>'paused'='false';
