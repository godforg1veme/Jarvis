CREATE TABLE job_resume_managers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  resumes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(resumes)='array' AND octet_length(resumes::text)<=32768),
  refreshed_at timestamptz,
  next_refresh_at timestamptz NOT NULL DEFAULT now(),
  refresh_lease_until timestamptz,
  auto_raise_enabled boolean NOT NULL DEFAULT false,
  auto_raise_resume_id text CHECK (auto_raise_resume_id ~ '^[a-zA-Z0-9]{1,100}$'),
  next_raise_at timestamptz,
  last_raise_at timestamptz,
  last_outcome text CHECK (last_outcome IN ('raised','not_due','ineligible','failed','unknown')),
  last_error text CHECK (last_error IN ('refresh_failed','access_denied','resume_missing','operation_unknown')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT auto_raise_enabled OR (auto_raise_resume_id IS NOT NULL AND next_raise_at IS NOT NULL))
);
CREATE TABLE job_resume_operations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('settings','refresh','raise')),
  status text NOT NULL CHECK (status IN ('working','complete','failed','unknown')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4096),
  result jsonb CHECK (jsonb_typeof(result)='object' AND octet_length(result::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(user_id,request_id)
);
CREATE UNIQUE INDEX job_resume_settings_pending ON job_resume_operations(user_id)
  WHERE kind='settings' AND status IN ('working','unknown');
CREATE INDEX job_resume_operation_history ON job_resume_operations(user_id,kind,created_at DESC);
CREATE INDEX job_resume_due_refresh ON job_resume_managers(next_refresh_at);
CREATE INDEX job_resume_due_raise ON job_resume_managers(next_raise_at) WHERE auto_raise_enabled;
