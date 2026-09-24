CREATE TABLE action_workflows (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  origin_channel text NOT NULL CHECK (origin_channel IN ('telegram', 'pwa', 'desktop')),
  origin_device_id uuid,
  target_executor_type text NOT NULL CHECK (char_length(target_executor_type) BETWEEN 1 AND 64),
  target_id text,
  status text NOT NULL CHECK (status IN (
    'active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result',
    'succeeded', 'failed', 'cancelled', 'expired'
  )),
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
  step_count integer NOT NULL DEFAULT 0 CHECK (step_count BETWEEN 0 AND 4),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id, user_id),
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (origin_device_id, user_id) REFERENCES devices(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX action_workflows_active_conversation_idx
  ON action_workflows (user_id, conversation_id, origin_channel, updated_at DESC)
  WHERE status IN ('active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result');

CREATE INDEX action_workflows_expiry_idx
  ON action_workflows (status, expires_at)
  WHERE status IN ('active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result');

CREATE TABLE action_runs (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 3),
  executor_type text NOT NULL CHECK (char_length(executor_type) BETWEEN 1 AND 64),
  target_id text,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 128),
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(arguments) = 'object'),
  policy text NOT NULL CHECK (policy IN ('observe', 'low_risk', 'requires_confirmation', 'requires_strong_confirmation')),
  status text NOT NULL CHECK (status IN ('planned', 'awaiting_confirmation', 'running', 'succeeded', 'failed', 'cancelled')),
  result jsonb,
  command_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (workflow_id, position),
  FOREIGN KEY (workflow_id, user_id) REFERENCES action_workflows(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE SET NULL
);

CREATE INDEX action_runs_workflow_idx ON action_runs (workflow_id, position);
CREATE INDEX action_runs_user_status_idx ON action_runs (user_id, status, updated_at DESC);

ALTER TABLE commands
  ADD COLUMN workflow_id uuid,
  ADD COLUMN action_run_id uuid,
  ADD CONSTRAINT commands_workflow_user_fk
    FOREIGN KEY (workflow_id, user_id) REFERENCES action_workflows(id, user_id) ON DELETE SET NULL,
  ADD CONSTRAINT commands_action_run_fk
    FOREIGN KEY (action_run_id) REFERENCES action_runs(id) ON DELETE SET NULL;

CREATE INDEX commands_workflow_idx ON commands (workflow_id, created_at);
