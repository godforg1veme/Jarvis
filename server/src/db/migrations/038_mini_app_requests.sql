CREATE TABLE mini_app_requests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed')),
  answer text CHECK (char_length(answer) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id),
  CHECK ((status='processing' AND answer IS NULL) OR (status='completed' AND answer IS NOT NULL))
);
