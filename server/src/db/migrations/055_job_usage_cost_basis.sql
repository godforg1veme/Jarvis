ALTER TABLE job_usage ADD COLUMN cost_basis text NOT NULL DEFAULT 'provider'
  CHECK (cost_basis IN ('provider','estimated','unknown'));
UPDATE job_usage SET cost_basis='unknown' WHERE cost_usd IS NULL;
