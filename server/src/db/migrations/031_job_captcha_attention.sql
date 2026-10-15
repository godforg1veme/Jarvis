ALTER TABLE job_deliveries DROP CONSTRAINT job_deliveries_kind_check;
ALTER TABLE job_deliveries ADD CONSTRAINT job_deliveries_kind_check
  CHECK (kind IN ('card','budget','attention'));
