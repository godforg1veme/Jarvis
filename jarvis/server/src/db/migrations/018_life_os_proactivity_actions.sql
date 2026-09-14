ALTER TABLE action_workflows DROP CONSTRAINT action_workflows_status_check;
ALTER TABLE action_workflows ADD CONSTRAINT action_workflows_status_check CHECK (status IN (
  'active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result',
  'succeeded', 'failed', 'outcome_unknown', 'cancelled', 'expired'
));

ALTER TABLE action_runs DROP CONSTRAINT action_runs_status_check;
ALTER TABLE action_runs ADD CONSTRAINT action_runs_status_check CHECK (status IN (
  'planned', 'awaiting_confirmation', 'running', 'succeeded', 'failed',
  'outcome_unknown', 'cancelled'
));
