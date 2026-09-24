ALTER TABLE life_reminders
  ADD COLUMN expires_at timestamptz,
  ADD CONSTRAINT life_reminders_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at);

CREATE TABLE life_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_id uuid NOT NULL,
  occurrence_key text NOT NULL CHECK (char_length(occurrence_key) BETWEEN 1 AND 256),
  channel text NOT NULL CHECK (channel IN ('telegram', 'desktop')),
  delivery_key text NOT NULL CHECK (char_length(delivery_key) BETWEEN 1 AND 256),
  state text NOT NULL CHECK (state IN ('sending', 'delivered', 'failed', 'outcome_unknown')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 20),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, delivery_key),
  UNIQUE (user_id, reminder_id, occurrence_key, channel),
  FOREIGN KEY (user_id, reminder_id) REFERENCES life_reminders(user_id, id) ON DELETE CASCADE
);

CREATE INDEX life_reminder_deliveries_owner_occurrence_idx
  ON life_reminder_deliveries (user_id, reminder_id, occurrence_key, channel);

ALTER TABLE life_events DROP CONSTRAINT life_events_event_type_check;
ALTER TABLE life_events ADD CONSTRAINT life_events_event_type_check CHECK (event_type IN (
  'message.received', 'voice.transcribed', 'vision.observed',
  'document.ingested', 'document.ingest_failed',
  'device.connected', 'device.disconnected', 'device.state_changed',
  'project.created', 'project.updated', 'project.archived',
  'commitment.detected', 'commitment.updated', 'commitment.completed',
  'task.created', 'task.updated', 'task.completed',
  'proposal.created', 'proposal.dismissed', 'proposal.confirmed', 'proposal.expired',
  'workflow.started', 'workflow.awaiting_confirmation', 'workflow.completed',
  'workflow.failed', 'workflow.outcome_unknown', 'feedback.recorded',
  'person.created', 'person.updated', 'person.archived', 'relationship.updated',
  'family_access.granted', 'family_access.revoked', 'mode.changed',
  'preference.updated', 'preference.deleted',
  'reminder.created', 'reminder.rescheduled', 'reminder.cancelled',
  'reminder.acknowledged', 'reminder.delivered', 'reminder.delivery_failed', 'reminder.outcome_unknown',
  'recovery.prepared', 'recovery.started', 'recovery.completed',
  'recovery.failed', 'recovery.outcome_unknown',
  'source.synced', 'source.failed', 'mission.pinned', 'mission.hidden', 'mission.restored'
));
