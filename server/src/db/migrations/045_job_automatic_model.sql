-- Model selection for job letters now follows the shared OpenRouter route.
-- Preserve search activation, filters, and checkpoints while dropping only the obsolete preference.
UPDATE job_searches SET settings = settings - 'model' WHERE settings ? 'model';

-- Old previews can contain the removed model field; they must not restore it on approval.
UPDATE job_confirmations SET status = 'stale'
WHERE kind = 'settings' AND status = 'pending' AND frozen->'value' ? 'model';

-- A pending guided model value cannot be consumed by the new settings handler.
UPDATE telegram_interactions SET status = 'cancelled'
WHERE kind = 'job_setting_value' AND status = 'active' AND context->>'field' = 'model';

