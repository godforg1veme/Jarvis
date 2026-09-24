ALTER TABLE ops_incidents ADD COLUMN notified_at timestamptz;
ALTER TABLE ops_incidents ADD COLUMN notification_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE ops_incidents ADD COLUMN notification_retry_at timestamptz;
-- Legacy incidents were already offered to Telegram. Avoid replaying old alerts
-- during rollout; all newly created incidents use durable delivery tracking.
UPDATE ops_incidents SET notified_at=now();
