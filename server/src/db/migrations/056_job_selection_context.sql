-- Private, bounded reason and input versions for each autonomous decision.
ALTER TABLE job_automation_items ADD COLUMN evaluation jsonb;
ALTER TABLE job_automation_items ADD CONSTRAINT job_automation_evaluation_shape CHECK
  (evaluation IS NULL OR (jsonb_typeof(evaluation)='object' AND pg_column_size(evaluation)<=4096));
