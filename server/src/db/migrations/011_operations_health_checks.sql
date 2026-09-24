CREATE TABLE ops_health_checks (
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  check_key text NOT NULL CHECK (check_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  state text NOT NULL CHECK (state IN ('healthy','unavailable','unknown','no_fresh_data')),
  summary text NOT NULL CHECK (char_length(summary)<=300),
  checked_at timestamptz NOT NULL DEFAULT now(),
  next_run_at timestamptz,
  PRIMARY KEY(host_id,check_key)
);
