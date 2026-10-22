-- Preserve the original observation while distinguishing current and archived HH evidence.
ALTER TABLE job_history_observations
 ADD COLUMN topic_created_at timestamptz,
 ADD COLUMN history_section text CHECK(history_section IN ('active','archived')),
 ADD COLUMN last_seen_run_id uuid;
ALTER TABLE job_history_syncs ADD COLUMN last_success_run_id uuid;
-- Existing rows have no run/section proof. A successful full refresh supplies it.
