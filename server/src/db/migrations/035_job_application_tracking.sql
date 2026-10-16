CREATE TABLE job_history_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 topic_id text NOT NULL CHECK(topic_id ~ '^[1-9][0-9]{0,19}$'),
 external_vacancy_id text NOT NULL CHECK(external_vacancy_id ~ '^[1-9][0-9]{0,19}$'),
 resume_native_id text NOT NULL CHECK(resume_native_id ~ '^[1-9][0-9]{0,19}$'),
 resume_hash text CHECK(resume_hash ~ '^[a-zA-Z0-9]{1,100}$'),
 resume_title text CHECK(char_length(resume_title) BETWEEN 1 AND 500),
 title text CHECK(char_length(title) BETWEEN 1 AND 500), company text CHECK(char_length(company) BETWEEN 1 AND 300),
 applied_at timestamptz, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz NOT NULL DEFAULT now(), status_checked_at timestamptz,
 employer_status text NOT NULL DEFAULT 'unknown' CHECK(employer_status IN ('not_viewed','viewed','invited','rejected','unknown')),
 vacancy_archived boolean NOT NULL DEFAULT false,
 application_id uuid REFERENCES job_applications(id) ON DELETE SET NULL,
 UNIQUE(user_id,topic_id)
);
CREATE INDEX job_history_owner_dates ON job_history_observations(user_id,applied_at DESC,first_seen_at DESC);
CREATE TABLE job_history_events (
 id bigserial PRIMARY KEY, observation_id uuid NOT NULL REFERENCES job_history_observations(id) ON DELETE CASCADE,
 employer_status text NOT NULL CHECK(employer_status IN ('not_viewed','viewed','invited','rejected','unknown')),
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_history_syncs (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 chat_id text NOT NULL CHECK(chat_id ~ '^[0-9]{1,20}$'),
 run_id uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','paused','complete','incomplete','failed')),
 section text NOT NULL DEFAULT 'active' CHECK(section IN ('active','archived')),
 page integer NOT NULL DEFAULT 0 CHECK(page BETWEEN 0 AND 999),
 pass integer NOT NULL DEFAULT 1 CHECK(pass IN (1,2)),
 pages_read integer NOT NULL DEFAULT 0 CHECK(pages_read BETWEEN 0 AND 2000),
 expected_total integer CHECK(expected_total BETWEEN 0 AND 100000),
 expected_pages integer CHECK(expected_pages BETWEEN 1 AND 1000),
 seen_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(seen_ids)='array' AND jsonb_array_length(seen_ids)<=100000),
 lease_id uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
 failure_code text CHECK(failure_code ~ '^JOB_[A-Z_]{1,70}$')
);
