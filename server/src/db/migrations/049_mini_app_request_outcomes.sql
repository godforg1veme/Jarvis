ALTER TABLE mini_app_requests
  DROP CONSTRAINT mini_app_requests_status_check;

ALTER TABLE mini_app_requests
  ADD COLUMN failure_code text
  CHECK (failure_code IN ('request_failed', 'request_expired'));

ALTER TABLE mini_app_requests
  ADD CONSTRAINT mini_app_requests_status_check
  CHECK (status IN ('processing', 'completed', 'failed'));

ALTER TABLE mini_app_requests
  DROP CONSTRAINT mini_app_requests_check;

ALTER TABLE mini_app_requests
  ADD CONSTRAINT mini_app_requests_check CHECK (
    (status = 'processing' AND answer IS NULL AND failure_code IS NULL) OR
    (status = 'completed' AND answer IS NOT NULL AND failure_code IS NULL) OR
    (status = 'failed' AND answer IS NULL AND failure_code IS NOT NULL)
  );
