-- A second cursor shares the existing per-user search lease and settings.
ALTER TABLE job_searches
  ADD COLUMN fresh_checkpoint timestamptz,
  ADD COLUMN fresh_progress jsonb,
  ADD COLUMN fresh_next_check_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX job_searches_fresh_due_idx ON job_searches(fresh_next_check_at,user_id)
  WHERE settings->>'activated'='true' AND settings->>'paused'='false';

-- Fresh cards can move ahead of the historical backlog without changing the
-- existing delivery identity, status, or unknown-outcome rules.
ALTER TABLE job_deliveries
  ADD COLUMN priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1);
