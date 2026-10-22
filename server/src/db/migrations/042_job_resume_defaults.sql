ALTER TABLE job_resume_managers
  ADD COLUMN auto_raise_policy_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_raise_preference boolean;

-- A completed settings request is an explicit choice, including "off".
-- Pending/unknown requests remain unresolved and are not inferred here.
UPDATE job_resume_managers m SET
  auto_raise_preference = (SELECT (o.payload->'input'->>'autoRaiseEnabled')::boolean
    FROM job_resume_operations o WHERE o.user_id=m.user_id AND o.kind='settings'
      AND o.status='complete' AND o.payload->'input' ? 'autoRaiseEnabled'
    ORDER BY o.created_at DESC,o.request_id DESC LIMIT 1),
  auto_raise_policy_applied = EXISTS (SELECT 1 FROM job_resume_operations o
    WHERE o.user_id=m.user_id AND o.kind='settings' AND o.status='complete'
      AND o.payload->'input' ? 'autoRaiseEnabled');

-- Preserve an already active schedule even if its historical receipt is absent.
UPDATE job_resume_managers SET auto_raise_policy_applied=true,
  auto_raise_preference=true WHERE auto_raise_enabled AND NOT auto_raise_policy_applied;
