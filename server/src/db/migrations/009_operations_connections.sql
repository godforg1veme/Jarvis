CREATE TABLE device_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pairing_code_id uuid UNIQUE REFERENCES device_pairing_codes(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending_claim', 'claimed', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  cancelled_at timestamptz,
  audit_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audit_metadata) = 'object' AND octet_length(audit_metadata::text) <= 2048)
);

CREATE INDEX device_reassignments_target_status_idx
  ON device_reassignments (target_user_id, status, created_at DESC);

ALTER TABLE devices
  ADD COLUMN device_kind text NOT NULL DEFAULT 'computer'
    CHECK (device_kind IN ('computer', 'mobile', 'web'));

ALTER TABLE device_pairing_codes
  ADD COLUMN source_device_id uuid REFERENCES devices(id) ON DELETE SET NULL;

CREATE INDEX device_pairing_codes_source_device_idx
  ON device_pairing_codes (source_device_id, expires_at DESC)
  WHERE consumed_at IS NULL;
