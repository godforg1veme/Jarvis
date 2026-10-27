ALTER TABLE job_drafts
  ADD COLUMN resume_id text CHECK (char_length(resume_id) <= 128),
  ADD COLUMN connection_revision integer CHECK (connection_revision > 0),
  ADD CONSTRAINT job_drafts_resume_context_pair CHECK
    ((resume_id IS NULL) = (connection_revision IS NULL));
