CREATE TABLE job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id text NOT NULL CHECK (chat_id ~ '^[0-9]{1,20}$'),
  settings jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  checkpoint timestamptz, progress jsonb, next_check_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, lease_id uuid,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','collecting','attention')),
  failure_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  profile jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_box jsonb, resume_id text CHECK (char_length(resume_id)<=128),
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','attention','refreshing')),
  refresh_operation_id uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id text NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','exchanging','complete','unknown','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_vacancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL CHECK (source='hh'),
  external_id text NOT NULL CHECK (external_id ~ '^[0-9]{1,20}$'),
  snapshot jsonb NOT NULL, content_hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  published_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source,external_id)
);
CREATE TABLE job_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  filter_revision integer NOT NULL, annotations jsonb NOT NULL DEFAULT '[]',
  saved boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,vacancy_id)
);
CREATE TABLE job_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES job_vacancies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'card' CHECK (kind IN ('card','budget')),
  dedup_key text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','unknown')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, telegram_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,dedup_key)
);
CREATE INDEX job_deliveries_queue_idx ON job_deliveries(status,available_at);
CREATE TABLE job_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('generate','edit','translate','settings','profile')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed','unknown')),
  result_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
CREATE TABLE job_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  parent_draft_id uuid REFERENCES job_drafts(id), profile_revision integer NOT NULL,
  vacancy_revision integer NOT NULL, text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 10000),
  fact_ids jsonb NOT NULL, current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_drafts_current_idx ON job_drafts(user_id,vacancy_id) WHERE current;
CREATE TABLE job_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id text NOT NULL, provider_request_id text,
  cost_usd numeric(20,10) CHECK (cost_usd>=0),
  outcome text NOT NULL CHECK (outcome IN ('success','failed','pending')),
  occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
CREATE TABLE job_budget_notices (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  threshold_usd numeric(20,10) NOT NULL CHECK (threshold_usd>0),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,month,threshold_usd)
);
CREATE TABLE job_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id text NOT NULL, channel text NOT NULL CHECK (channel='telegram'),
  kind text NOT NULL CHECK (kind IN ('apply','settings','profile')),
  target_id uuid NOT NULL, frozen jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','stale','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  resume_id text NOT NULL, draft_id uuid NOT NULL REFERENCES job_drafts(id),
  confirmation_id uuid NOT NULL UNIQUE REFERENCES job_confirmations(id),
  operation_id uuid NOT NULL UNIQUE, approved_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','sent','failed','unknown','manual_required','already_applied')),
  external_id text, failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,vacancy_id,resume_id)
);
