CREATE TABLE life_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(aliases) = 'array'
    AND jsonb_array_length(aliases) <= 16
    AND octet_length(convert_to(aliases::text, 'UTF8')) <= 2048
  ),
  relationship_type text NOT NULL DEFAULT 'other' CHECK (relationship_type IN (
    'family', 'partner', 'friend', 'colleague', 'client', 'provider', 'other'
  )),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE INDEX life_people_owner_name_idx
  ON life_people (user_id, lower(display_name)) WHERE status = 'active';
CREATE INDEX life_people_owner_status_idx
  ON life_people (user_id, status, updated_at DESC, id);

CREATE TABLE life_person_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  related_person_id uuid,
  direction text NOT NULL DEFAULT 'mutual' CHECK (direction IN (
    'owner_to_person', 'person_to_owner', 'mutual', 'person_to_person'
  )),
  relation_type text NOT NULL CHECK (relation_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  origin text NOT NULL CHECK (origin IN ('user', 'trusted', 'inferred')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, person_id, related_person_id, relation_type),
  FOREIGN KEY (user_id, person_id) REFERENCES life_people(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, related_person_id) REFERENCES life_people(user_id, id) ON DELETE CASCADE,
  CHECK (related_person_id IS NULL OR person_id <> related_person_id),
  CHECK ((direction = 'person_to_person') = (related_person_id IS NOT NULL))
);

CREATE INDEX life_person_relationships_owner_person_idx
  ON life_person_relationships (user_id, person_id, updated_at DESC);
CREATE UNIQUE INDEX life_person_relationships_owner_direct_idx
  ON life_person_relationships (user_id, person_id, relation_type)
  WHERE related_person_id IS NULL;

CREATE TABLE life_person_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  project_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('participant', 'stakeholder', 'assignee', 'beneficiary', 'other')),
  origin text NOT NULL CHECK (origin IN ('user', 'trusted', 'inferred')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, person_id, project_id, role),
  FOREIGN KEY (user_id, person_id) REFERENCES life_people(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, project_id) REFERENCES life_projects(user_id, id) ON DELETE CASCADE
);

CREATE INDEX life_person_project_links_owner_project_idx
  ON life_person_project_links (user_id, project_id, person_id);

CREATE TABLE life_family_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN (
    'area', 'project', 'event_category', 'commitment', 'calendar_source'
  )),
  resource_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('view_summary', 'contribute_event', 'acknowledge')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  CHECK (user_id <> member_user_id),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX life_family_access_grants_active_idx
  ON life_family_access_grants (user_id, member_user_id, resource_type, resource_id, permission)
  WHERE revoked_at IS NULL;
CREATE INDEX life_family_access_grants_member_idx
  ON life_family_access_grants (member_user_id, resource_type, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE life_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN (
    'work', 'focus', 'home', 'family', 'meeting', 'travel', 'rest', 'sleep', 'emergency'
  )),
  previous_mode text CHECK (previous_mode IS NULL OR previous_mode IN (
    'work', 'focus', 'home', 'family', 'meeting', 'travel', 'rest', 'sleep', 'emergency'
  )),
  source text NOT NULL CHECK (source IN ('manual', 'accepted_suggestion')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  transition_event_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id),
  FOREIGN KEY (user_id, transition_event_id) REFERENCES life_events(user_id, id) ON DELETE SET NULL (transition_event_id),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE life_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference_key text NOT NULL CHECK (preference_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  value jsonb NOT NULL CHECK (
    jsonb_typeof(value) IN ('string', 'number', 'boolean', 'array', 'object')
    AND octet_length(convert_to(value::text, 'UTF8')) <= 4096
  ),
  source text NOT NULL CHECK (source IN ('explicit', 'derived')),
  explanation text NOT NULL DEFAULT '' CHECK (char_length(explanation) <= 500),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count BETWEEN 0 AND 100000),
  confidence double precision NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, preference_key)
);

CREATE INDEX life_preferences_owner_source_idx
  ON life_preferences (user_id, source, updated_at DESC);

ALTER TABLE life_commitments
  ADD COLUMN kind text NOT NULL DEFAULT 'commitment' CHECK (kind IN ('commitment', 'task')),
  ADD COLUMN person_id uuid,
  ADD COLUMN due_window_end_at timestamptz,
  ADD COLUMN recurrence jsonb,
  ADD COLUMN external_source_ref text CHECK (
    external_source_ref IS NULL OR char_length(external_source_ref) BETWEEN 1 AND 256
  ),
  ADD FOREIGN KEY (user_id, person_id) REFERENCES life_people(user_id, id) ON DELETE SET NULL (person_id),
  ADD CHECK (due_window_end_at IS NULL OR due_at IS NULL OR due_window_end_at >= due_at),
  ADD CHECK (recurrence IS NULL OR (
    jsonb_typeof(recurrence) = 'object'
    AND octet_length(convert_to(recurrence::text, 'UTF8')) <= 2048
  ));

CREATE INDEX life_commitments_owner_person_idx
  ON life_commitments (user_id, person_id, status) WHERE person_id IS NOT NULL;

CREATE TABLE life_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commitment_id uuid,
  project_id uuid,
  person_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  trigger_at timestamptz NOT NULL,
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 80),
  recurrence jsonb,
  delivery_channels text[] NOT NULL CHECK (
    cardinality(delivery_channels) BETWEEN 1 AND 2
    AND delivery_channels <@ ARRAY['telegram', 'desktop']::text[]
  ),
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'desktop', 'life_os')),
  origin_conversation_id uuid,
  origin_device_id uuid,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN (
    'scheduled', 'claimed', 'delivered', 'acknowledged', 'cancelled', 'expired', 'failed', 'outcome_unknown'
  )),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  occurrence_key text NOT NULL CHECK (char_length(occurrence_key) BETWEEN 1 AND 256),
  next_attempt_at timestamptz NOT NULL,
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,80}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (user_id, occurrence_key),
  FOREIGN KEY (user_id, commitment_id) REFERENCES life_commitments(user_id, id) ON DELETE SET NULL (commitment_id),
  FOREIGN KEY (user_id, project_id) REFERENCES life_projects(user_id, id) ON DELETE SET NULL (project_id),
  FOREIGN KEY (user_id, person_id) REFERENCES life_people(user_id, id) ON DELETE SET NULL (person_id),
  FOREIGN KEY (origin_conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE SET NULL (origin_conversation_id),
  FOREIGN KEY (origin_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE SET NULL (origin_device_id),
  CHECK (recurrence IS NULL OR (
    jsonb_typeof(recurrence) = 'object'
    AND octet_length(convert_to(recurrence::text, 'UTF8')) <= 2048
  )),
  CHECK ((state = 'claimed') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (
    (origin_channel = 'telegram' AND origin_conversation_id IS NOT NULL)
    OR (origin_channel = 'desktop' AND origin_device_id IS NOT NULL)
    OR origin_channel = 'life_os'
  )
);

CREATE INDEX life_reminders_due_claim_idx
  ON life_reminders (next_attempt_at, trigger_at, id)
  WHERE state = 'scheduled';
CREATE INDEX life_reminders_owner_state_idx
  ON life_reminders (user_id, state, trigger_at, id);

CREATE TABLE life_recovery_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  source_context_revision bigint NOT NULL CHECK (source_context_revision >= 0),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  creation_reason text NOT NULL CHECK (creation_reason ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'ready', 'awaiting_confirmation', 'executing', 'completed', 'partial',
    'failed', 'outcome_unknown', 'expired', 'cancelled'
  )),
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'desktop')),
  origin_conversation_id uuid,
  origin_device_id uuid,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id, project_id) REFERENCES life_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (origin_conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE SET NULL (origin_conversation_id),
  FOREIGN KEY (origin_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE SET NULL (origin_device_id),
  CHECK (
    (origin_channel = 'telegram' AND origin_conversation_id IS NOT NULL)
    OR (origin_channel = 'desktop' AND origin_device_id IS NOT NULL)
  )
);

CREATE INDEX life_recovery_plans_owner_project_idx
  ON life_recovery_plans (user_id, project_id, status, updated_at DESC);

CREATE TABLE life_recovery_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 31),
  step_type text NOT NULL CHECK (step_type IN (
    'show_fact', 'show_document', 'open_application', 'open_file', 'restore_window',
    'continue_workflow', 'prepare_workspace', 'suggest_next_step'
  )),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  risk_class text NOT NULL CHECK (risk_class IN ('safe', 'changing')),
  action_name text CHECK (action_name IS NULL OR action_name ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  resource_ref text CHECK (resource_ref IS NULL OR char_length(resource_ref) BETWEEN 1 AND 256),
  depends_on_positions smallint[] NOT NULL DEFAULT '{}'::smallint[] CHECK (
    cardinality(depends_on_positions) <= 16
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'awaiting_confirmation', 'executing', 'completed', 'failed', 'outcome_unknown', 'skipped'
  )),
  result_summary text NOT NULL DEFAULT '' CHECK (char_length(result_summary) <= 1000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (plan_id, position),
  FOREIGN KEY (user_id, plan_id) REFERENCES life_recovery_plans(user_id, id) ON DELETE CASCADE,
  CHECK ((risk_class = 'changing') = (action_name IS NOT NULL))
);

CREATE INDEX life_recovery_steps_owner_plan_idx
  ON life_recovery_steps (user_id, plan_id, position);

CREATE TABLE life_source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adapter_type text NOT NULL CHECK (adapter_type IN (
    'calendar', 'email', 'tasks', 'receipts', 'deliveries', 'travel', 'subscriptions', 'smart_home'
  )),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  enabled boolean NOT NULL DEFAULT false,
  selected_scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(selected_scope) = 'object'
    AND octet_length(convert_to(selected_scope::text, 'UTF8')) <= 4096
  ),
  privacy_policy_version integer NOT NULL DEFAULT 1 CHECK (privacy_policy_version > 0),
  configuration_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(configuration_metadata) = 'object'
    AND octet_length(convert_to(configuration_metadata::text, 'UTF8')) <= 4096
  ),
  credential_ref text CHECK (credential_ref IS NULL OR char_length(credential_ref) BETWEEN 1 AND 256),
  health_status text NOT NULL DEFAULT 'unconfigured' CHECK (health_status IN (
    'unconfigured', 'healthy', 'stale', 'degraded', 'failed', 'disabled'
  )),
  last_successful_sync_at timestamptz,
  last_failure_code text CHECK (last_failure_code IS NULL OR last_failure_code ~ '^[A-Z0-9_]{1,80}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, adapter_type, display_name)
);

CREATE INDEX life_source_connections_owner_enabled_idx
  ON life_source_connections (user_id, enabled, adapter_type, id);

CREATE TABLE life_source_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  adapter_schema_version integer NOT NULL CHECK (adapter_schema_version > 0),
  cursor_value text NOT NULL CHECK (char_length(cursor_value) BETWEEN 1 AND 2048),
  claim_token uuid,
  claimed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, connection_id),
  FOREIGN KEY (user_id, connection_id) REFERENCES life_source_connections(user_id, id) ON DELETE CASCADE,
  CHECK ((claim_token IS NULL) = (claimed_at IS NULL))
);

CREATE INDEX life_source_cursors_claim_idx
  ON life_source_cursors (claimed_at, id) WHERE claim_token IS NOT NULL;

CREATE TABLE life_project_priority_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  hidden_until timestamptz,
  user_weight double precision NOT NULL DEFAULT 0 CHECK (user_weight BETWEEN -1 AND 1),
  calculated_score double precision NOT NULL DEFAULT 0 CHECK (calculated_score BETWEEN -1000 AND 1000),
  confidence double precision NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  factor_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(factor_breakdown) = 'array'
    AND jsonb_array_length(factor_breakdown) <= 16
    AND octet_length(convert_to(factor_breakdown::text, 'UTF8')) <= 4096
  ),
  calculation_version integer NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  calculated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, project_id),
  FOREIGN KEY (user_id, project_id) REFERENCES life_projects(user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX life_project_priority_owner_pin_idx
  ON life_project_priority_state (user_id) WHERE pinned;
CREATE INDEX life_project_priority_owner_score_idx
  ON life_project_priority_state (user_id, calculated_score DESC, project_id);

ALTER TABLE life_proposals
  ADD COLUMN person_id uuid,
  ADD COLUMN reminder_id uuid,
  ADD COLUMN source_rule text NOT NULL DEFAULT 'core_v1' CHECK (source_rule ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  ADD COLUMN source_rule_version integer NOT NULL DEFAULT 1 CHECK (source_rule_version > 0),
  ADD COLUMN confidence double precision NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  ADD FOREIGN KEY (user_id, person_id) REFERENCES life_people(user_id, id) ON DELETE SET NULL (person_id),
  ADD FOREIGN KEY (user_id, reminder_id) REFERENCES life_reminders(user_id, id) ON DELETE SET NULL (reminder_id);

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
  'reminder.delivered', 'reminder.delivery_failed', 'reminder.outcome_unknown',
  'recovery.prepared', 'recovery.started', 'recovery.completed',
  'recovery.failed', 'recovery.outcome_unknown',
  'source.synced', 'source.failed', 'mission.pinned', 'mission.hidden', 'mission.restored'
));

ALTER TABLE life_events DROP CONSTRAINT life_events_source_channel_check;
ALTER TABLE life_events ADD CONSTRAINT life_events_source_channel_check CHECK (source_channel IN (
  'telegram', 'desktop', 'voice', 'vision', 'knowledge', 'memory',
  'device', 'orchestrator', 'life_os', 'backfill', 'reminder',
  'calendar', 'email', 'tasks', 'receipts', 'deliveries', 'travel',
  'subscriptions', 'smart_home'
));

ALTER TABLE life_event_links DROP CONSTRAINT life_event_links_target_type_check;
ALTER TABLE life_event_links ADD CONSTRAINT life_event_links_target_type_check CHECK (target_type IN (
  'area', 'project', 'conversation', 'document', 'device', 'workflow',
  'commitment', 'proposal', 'event', 'memory', 'person', 'reminder',
  'recovery_plan', 'source_connection'
));

ALTER TABLE life_feedback DROP CONSTRAINT life_feedback_target_type_check;
ALTER TABLE life_feedback ADD CONSTRAINT life_feedback_target_type_check CHECK (target_type IN (
  'event', 'link', 'project', 'commitment', 'proposal', 'person', 'mode',
  'preference', 'reminder'
));
