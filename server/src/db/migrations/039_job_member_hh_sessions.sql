CREATE TABLE job_hh_login_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  ticket_hash text UNIQUE CHECK (ticket_hash IS NULL OR ticket_hash ~ '^[a-f0-9]{64}$'),
  guest_token_hash text UNIQUE CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[a-f0-9]{64}$'),
  membership_revision integer NOT NULL CHECK (membership_revision > 0),
  role_id uuid REFERENCES access_roles(id) ON DELETE SET NULL,
  role_revision integer NOT NULL CHECK (role_revision >= 0),
  status text NOT NULL CHECK (status IN ('pending','claimed','authenticated','confirmed','cancelled','expired','revoked','failed')),
  resume_id text CHECK (resume_id IS NULL OR char_length(resume_id) <= 128),
  ticket_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id),
  CHECK (ticket_expires_at <= expires_at)
);

CREATE UNIQUE INDEX job_hh_login_one_active_per_user
  ON job_hh_login_sessions(user_id)
  WHERE status IN ('pending','claimed','authenticated');
CREATE INDEX job_hh_login_expiry_idx
  ON job_hh_login_sessions(expires_at)
  WHERE status IN ('pending','claimed','authenticated');
