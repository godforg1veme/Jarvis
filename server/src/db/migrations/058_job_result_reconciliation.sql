-- Persist origin and read-only recovery separately from authorization to submit.
ALTER TABLE job_applications ADD COLUMN origin_conversation_id uuid REFERENCES conversations(id);
ALTER TABLE job_applications ADD COLUMN origin_chat_id text CHECK(origin_chat_id ~ '^[0-9]{1,20}$');
ALTER TABLE job_applications ADD COLUMN origin_connection_revision integer;
ALTER TABLE job_applications ADD COLUMN reconciliation_attempts integer NOT NULL DEFAULT 0 CHECK(reconciliation_attempts BETWEEN 0 AND 6);
ALTER TABLE job_applications ADD COLUMN reconciliation_after timestamptz NOT NULL DEFAULT now();
ALTER TABLE job_applications ADD COLUMN reconciliation_token uuid;
ALTER TABLE job_applications ADD COLUMN reconciliation_lease_until timestamptz;
ALTER TABLE job_automation_items ADD COLUMN failure_phase text CHECK(failure_phase IN ('evaluation','generation','preparation','submission','confirmation'));
ALTER TABLE job_automation_items ADD COLUMN failure_code text CHECK(failure_code ~ '^JOB_[A-Z_]{1,70}$');

UPDATE job_applications a SET origin_conversation_id=c.conversation_id,origin_chat_id=c.chat_id
FROM job_confirmations c WHERE a.confirmation_id=c.id AND a.user_id=c.user_id;
UPDATE job_applications a SET origin_connection_revision=d.connection_revision
FROM job_drafts d WHERE a.draft_id=d.id AND a.user_id=d.user_id AND a.resume_id=d.resume_id;
-- Legacy origin is backfilled only from the exact consent revision, never the
-- latest search chat or an unrelated new activation.
UPDATE job_applications app SET origin_conversation_id=a.conversation_id,origin_chat_id=a.chat_id
FROM job_automations a WHERE app.user_id=a.user_id AND app.automation_revision=a.revision
  AND app.resume_id=a.resume_id AND app.origin_connection_revision=a.connection_revision
  AND a.conversation_id IS NOT NULL AND a.chat_id IS NOT NULL;

-- A personal off clears the current consent scope. Its already-persisted
-- attention delivery still identifies the original scope, when unambiguous.
WITH saved_origins AS (
  SELECT app.id,min(c.id::text)::uuid AS conversation_id,min(c.external_chat_id) AS chat_id
  FROM job_applications app JOIN job_deliveries d ON d.user_id=app.user_id AND d.vacancy_id=app.vacancy_id
  JOIN conversations c ON c.user_id=app.user_id AND c.channel='telegram'
    AND c.id::text=d.payload->>'conversationId' AND c.external_chat_id=d.payload->>'chatId'
  JOIN user_identities ident ON ident.user_id=c.user_id AND ident.provider='telegram'
    AND ident.external_id=c.external_chat_id
  WHERE app.origin_conversation_id IS NULL AND app.automation_revision IS NOT NULL
    AND d.payload->>'reason' IN ('HH_AUTO_ATTENTION','HH_AUTO_MANUAL')
    AND d.payload->>'automationRevision'=app.automation_revision::text
    AND d.payload->>'vacancyId'=app.vacancy_id::text
  GROUP BY app.id HAVING count(DISTINCT c.id::text||':'||c.external_chat_id)=1
)
UPDATE job_applications app SET origin_conversation_id=s.conversation_id,origin_chat_id=s.chat_id
FROM saved_origins s WHERE app.id=s.id;

-- Only conclusive legacy validation failures with no draft/application can be
-- labelled a non-send. They are not silently regenerated or retried.
UPDATE job_automation_items i SET status='manual_required',failure_phase='generation',
  failure_code='JOB_LETTER_VALIDATION_REVIEW'
FROM job_tasks t WHERE t.user_id=i.user_id AND t.request_id=i.draft_request_id AND t.status='failed'
  AND t.payload->>'modelValidationFailure' IN ('schema','json','size','facts','truncated','filtered')
  AND i.status='unknown' AND i.operation_id IS NULL AND i.draft_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM job_applications app WHERE app.user_id=i.user_id AND app.vacancy_id=i.vacancy_id);
CREATE INDEX job_applications_reconcile_due_idx ON job_applications(reconciliation_after)
  WHERE status='unknown' AND automation_revision IS NOT NULL AND reconciliation_attempts<6;
