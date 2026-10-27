CREATE TABLE mini_app_personal_operations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  section text NOT NULL CHECK (section IN ('documents','devices','life')),
  kind text,
  request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('completed','cancelled')),
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,operation_id),
  CHECK ((status='completed' AND kind IS NOT NULL AND request_hash IS NOT NULL)
    OR (status='cancelled' AND kind IS NULL AND request_hash IS NULL))
);
CREATE INDEX mini_app_personal_operations_user_created ON mini_app_personal_operations(user_id,created_at);
