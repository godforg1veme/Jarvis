-- Private, immutable model requests. A running/unknown request is never reissued.
CREATE TABLE job_questionnaire_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES job_drafts(id) ON DELETE CASCADE,
  request_id text NOT NULL UNIQUE,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  questionnaire jsonb NOT NULL,
  context_versions jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('running','complete','manual_required','failed','unknown')),
  answers jsonb,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^JOB_[A-Z_]{1,70}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,draft_id,input_hash)
);
ALTER TABLE job_applications ADD COLUMN questionnaire jsonb;
ALTER TABLE job_applications ADD COLUMN questionnaire_answers jsonb;
ALTER TABLE job_applications ADD COLUMN questionnaire_context jsonb;
ALTER TABLE job_applications ADD CONSTRAINT job_application_questionnaire_pair CHECK
  ((questionnaire IS NULL AND questionnaire_answers IS NULL AND questionnaire_context IS NULL)
    OR (questionnaire IS NOT NULL AND questionnaire_answers IS NOT NULL AND questionnaire_context IS NOT NULL
      AND automation_revision IS NOT NULL));
