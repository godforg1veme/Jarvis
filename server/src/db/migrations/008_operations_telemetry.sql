CREATE TABLE ops_metric_samples (
  id bigserial PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  service_id uuid REFERENCES ops_services(id) ON DELETE CASCADE,
  metric_name text NOT NULL CHECK (metric_name ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  metric_value double precision NOT NULL CHECK (metric_value = metric_value),
  sampled_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX ops_metric_samples_unique_idx
  ON ops_metric_samples (host_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid), metric_name, sampled_at);

CREATE INDEX ops_metric_samples_query_idx
  ON ops_metric_samples (host_id, service_id, metric_name, sampled_at DESC);

CREATE TABLE ops_metric_rollups (
  id bigserial PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  service_id uuid REFERENCES ops_services(id) ON DELETE CASCADE,
  metric_name text NOT NULL CHECK (metric_name ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  bucket_at timestamptz NOT NULL,
  minimum double precision NOT NULL CHECK (minimum = minimum),
  maximum double precision NOT NULL CHECK (maximum = maximum),
  average double precision NOT NULL CHECK (average = average),
  sample_count integer NOT NULL CHECK (sample_count BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX ops_metric_rollups_unique_idx
  ON ops_metric_rollups (host_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid), metric_name, bucket_at);

CREATE INDEX ops_metric_rollups_query_idx
  ON ops_metric_rollups (host_id, service_id, metric_name, bucket_at DESC);

CREATE TABLE ops_log_entries (
  id bigserial PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES ops_services(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('journald', 'docker')),
  observed_at timestamptz NOT NULL,
  priority smallint CHECK (priority BETWEEN 0 AND 7),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 16384),
  fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
  UNIQUE (service_id, source, fingerprint, observed_at)
);

CREATE INDEX ops_log_entries_service_created_idx ON ops_log_entries (service_id, observed_at DESC);

CREATE TABLE ops_parser_results (
  id bigserial PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES ops_hosts(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  result_kind text NOT NULL CHECK (result_kind IN ('service_state', 'operational_error', 'status_file')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
  UNIQUE (host_id, result_kind, fingerprint)
);

CREATE INDEX ops_parser_results_host_observed_idx ON ops_parser_results (host_id, observed_at DESC);
