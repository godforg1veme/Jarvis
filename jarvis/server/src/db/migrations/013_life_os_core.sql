CREATE TABLE life_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_key text CHECK (area_key IS NULL OR area_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, area_key)
);

CREATE UNIQUE INDEX life_areas_owner_name_idx ON life_areas (user_id, lower(name));
CREATE INDEX life_areas_owner_order_idx ON life_areas (user_id, status, sort_order, created_at);

CREATE TABLE life_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  target_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, area_id) REFERENCES life_areas(user_id, id) ON DELETE SET NULL (area_id)
);

CREATE UNIQUE INDEX life_projects_owner_name_idx ON life_projects (user_id, lower(name)) WHERE status <> 'archived';
CREATE INDEX life_projects_owner_status_idx ON life_projects (user_id, status, updated_at DESC);
CREATE INDEX life_projects_owner_area_idx ON life_projects (user_id, area_id, status);

CREATE TABLE life_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'message.received', 'voice.transcribed', 'vision.observed',
    'document.ingested', 'document.ingest_failed',
    'device.connected', 'device.disconnected', 'device.state_changed',
    'project.created', 'project.updated', 'project.archived',
    'commitment.detected', 'commitment.updated', 'commitment.completed',
    'proposal.created', 'proposal.dismissed', 'proposal.confirmed', 'proposal.expired',
    'workflow.started', 'workflow.awaiting_confirmation', 'workflow.completed',
    'workflow.failed', 'workflow.outcome_unknown', 'feedback.recorded'
  )),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_channel text NOT NULL CHECK (source_channel IN (
    'telegram', 'desktop', 'voice', 'vision', 'knowledge', 'memory',
    'device', 'orchestrator', 'life_os', 'backfill'
  )),
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 256),
  source_device_id uuid,
  deduplication_key text NOT NULL CHECK (char_length(deduplication_key) BETWEEN 1 AND 512),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence double precision NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  privacy_class text NOT NULL DEFAULT 'personal' CHECK (privacy_class IN ('personal', 'family', 'sensitive')),
  trust_level text NOT NULL DEFAULT 'trusted' CHECK (trust_level IN ('trusted', 'inferred', 'user')),
  correlation_id text CHECK (correlation_id IS NULL OR char_length(correlation_id) BETWEEN 1 AND 128),
  causation_event_id uuid,
  processing_state text NOT NULL DEFAULT 'pending' CHECK (processing_state IN ('pending', 'claimed', 'processed', 'failed')),
  claim_token uuid,
  claimed_at timestamptz,
  processing_attempts integer NOT NULL DEFAULT 0 CHECK (processing_attempts BETWEEN 0 AND 10),
  processing_error_code text CHECK (processing_error_code IS NULL OR processing_error_code ~ '^[A-Z0-9_]{1,80}$'),
  processed_at timestamptz,
  UNIQUE (user_id, id),
  UNIQUE (user_id, deduplication_key),
  FOREIGN KEY (source_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE SET NULL (source_device_id),
  FOREIGN KEY (user_id, causation_event_id) REFERENCES life_events(user_id, id) ON DELETE SET NULL (causation_event_id),
  CHECK (octet_length(convert_to(structured_data::text, 'UTF8')) <= 16384),
  CHECK ((processing_state = 'claimed') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);

CREATE INDEX life_events_owner_timeline_idx ON life_events (user_id, occurred_at DESC, id DESC);
CREATE INDEX life_events_owner_type_idx ON life_events (user_id, event_type, occurred_at DESC);
CREATE INDEX life_events_processing_idx ON life_events (processing_state, recorded_at) WHERE processing_state IN ('pending', 'claimed');
CREATE INDEX life_events_correlation_idx ON life_events (user_id, correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE life_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN (
    'area', 'project', 'conversation', 'document', 'device', 'workflow',
    'commitment', 'proposal', 'event', 'memory'
  )),
  target_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  origin text NOT NULL CHECK (origin IN ('trusted', 'inferred', 'user')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id, target_type, target_id, relation_type),
  FOREIGN KEY (user_id, event_id) REFERENCES life_events(user_id, id) ON DELETE CASCADE
);

CREATE INDEX life_event_links_target_idx ON life_event_links (user_id, target_type, target_id, event_id);

CREATE TABLE life_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL,
  area_id uuid,
  project_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'dismissed', 'expired')),
  due_at timestamptz,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, source_event_id),
  FOREIGN KEY (user_id, source_event_id) REFERENCES life_events(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, area_id) REFERENCES life_areas(user_id, id) ON DELETE SET NULL (area_id),
  FOREIGN KEY (user_id, project_id) REFERENCES life_projects(user_id, id) ON DELETE SET NULL (project_id)
);

CREATE INDEX life_commitments_owner_due_idx ON life_commitments (user_id, status, due_at) WHERE status = 'open';
CREATE INDEX life_commitments_owner_project_idx ON life_commitments (user_id, project_id, status);

CREATE TABLE life_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id uuid,
  project_id uuid,
  commitment_id uuid,
  workflow_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  explanation text NOT NULL CHECK (char_length(explanation) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'confirmed', 'dismissed', 'expired', 'executing', 'completed', 'failed', 'outcome_unknown'
  )),
  risk_class text NOT NULL CHECK (risk_class IN ('safe', 'changing')),
  action_name text CHECK (action_name IS NULL OR action_name ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  action_arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'desktop')),
  origin_conversation_id uuid,
  origin_device_id uuid,
  cooldown_key text NOT NULL CHECK (char_length(cooldown_key) BETWEEN 1 AND 256),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, area_id) REFERENCES life_areas(user_id, id) ON DELETE SET NULL (area_id),
  FOREIGN KEY (user_id, project_id) REFERENCES life_projects(user_id, id) ON DELETE SET NULL (project_id),
  FOREIGN KEY (user_id, commitment_id) REFERENCES life_commitments(user_id, id) ON DELETE SET NULL (commitment_id),
  FOREIGN KEY (workflow_id, user_id) REFERENCES action_workflows(id, user_id) ON DELETE SET NULL (workflow_id),
  FOREIGN KEY (origin_conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE SET NULL (origin_conversation_id),
  FOREIGN KEY (origin_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE SET NULL (origin_device_id),
  CHECK (octet_length(convert_to(action_arguments::text, 'UTF8')) <= 8192),
  CHECK ((origin_channel = 'desktop' AND origin_device_id IS NOT NULL)
    OR (origin_channel = 'telegram' AND origin_conversation_id IS NOT NULL))
);

CREATE UNIQUE INDEX life_proposals_open_cooldown_idx ON life_proposals (user_id, cooldown_key)
  WHERE status IN ('open', 'confirmed', 'executing');
CREATE INDEX life_proposals_owner_status_idx ON life_proposals (user_id, status, expires_at);

CREATE TABLE life_proposal_evidence (
  proposal_id uuid NOT NULL,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 31),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, event_id),
  UNIQUE (proposal_id, position),
  FOREIGN KEY (user_id, proposal_id) REFERENCES life_proposals(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, event_id) REFERENCES life_events(user_id, id) ON DELETE CASCADE
);

CREATE INDEX life_proposal_evidence_owner_idx ON life_proposal_evidence (user_id, proposal_id, position);

CREATE TABLE life_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('useful', 'not_useful', 'incorrect_link', 'wrong_project', 'dismissed', 'suppress_similar')),
  target_type text NOT NULL CHECK (target_type IN ('event', 'link', 'project', 'commitment', 'proposal')),
  target_id uuid NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX life_feedback_owner_target_idx ON life_feedback (user_id, target_type, target_id, created_at DESC);
