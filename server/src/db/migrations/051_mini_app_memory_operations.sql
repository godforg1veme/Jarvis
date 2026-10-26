-- A memory change and its receipt commit together. A cancelled row is a
-- durable tombstone for a request which may still arrive after a lost reply.
CREATE TABLE mini_app_memory_operations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('completed', 'cancelled')),
  memory_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id),
  CHECK ((status = 'completed' AND request_hash IS NOT NULL)
      OR (status = 'cancelled' AND request_hash IS NULL))
);
