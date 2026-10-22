ALTER TABLE job_confirmations DROP CONSTRAINT job_confirmations_kind_check;
ALTER TABLE job_confirmations ADD CONSTRAINT job_confirmations_kind_check
  CHECK (kind IN ('apply','settings','profile','resume'));
