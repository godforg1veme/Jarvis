ALTER TABLE telegram_interactions DROP CONSTRAINT telegram_interactions_kind_check;

ALTER TABLE telegram_interactions ADD CONSTRAINT telegram_interactions_kind_check CHECK (kind IN (
  'vpn_access_label',
  'device_pairing_name',
  'device_instruction',
  'memory_add',
  'memory_correct_replacement',
  'life_project_create',
  'life_project_update',
  'life_person_create',
  'life_person_update',
  'life_relationship_create',
  'life_project_link_create',
  'life_family_grant_create',
  'life_family_grant_confirm',
  'life_reminder_create',
  'life_reminder_reschedule',
  'life_source_create',
  'life_source_update',
  'life_preference_set'
));
