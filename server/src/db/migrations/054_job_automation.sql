-- A personal, explicitly enabled authorization for autonomous HH applications.
CREATE TABLE job_automations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  resume_id text CHECK (char_length(resume_id) <= 128),
  connection_revision integer,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id text CHECK (chat_id ~ '^[0-9]{1,20}$'),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_automations_consent CHECK (
    NOT enabled OR (resume_id IS NOT NULL AND connection_revision IS NOT NULL
      AND conversation_id IS NOT NULL AND chat_id IS NOT NULL))
);

-- Each candidate is evaluated at most once per enabled consent revision. An
-- interrupted model call is unknown until inspected, never blindly retried.
CREATE TABLE job_automation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  automation_revision integer NOT NULL CHECK (automation_revision > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','evaluating','skipped','generating','submitting','sent','manual_required','unknown','failed')),
  evaluation_request_id text NOT NULL UNIQUE,
  draft_request_id text NOT NULL UNIQUE,
  draft_id uuid REFERENCES job_drafts(id),
  operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,vacancy_id,automation_revision)
);
CREATE INDEX job_automation_items_pending_idx ON job_automation_items(status,created_at,id)
  WHERE status='pending';

-- An autonomous application refers to the consent revision instead of a
-- per-vacancy interactive confirmation. Manual applications retain their FK.
ALTER TABLE job_applications ALTER COLUMN confirmation_id DROP NOT NULL;
ALTER TABLE job_applications ADD COLUMN automation_revision integer;
ALTER TABLE job_applications ADD CONSTRAINT job_applications_authorization_check CHECK
  ((confirmation_id IS NOT NULL AND automation_revision IS NULL)
   OR (confirmation_id IS NULL AND automation_revision IS NOT NULL));

-- The notice is informational. Preserve each person's other search settings.
UPDATE job_searches SET settings=jsonb_set(settings,'{budgetUsd}','2'::jsonb)
  WHERE settings->>'budgetUsd' IS DISTINCT FROM '2';
