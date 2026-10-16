CREATE TABLE job_captcha_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 conversation_id uuid NOT NULL REFERENCES conversations(id),
 chat_id text NOT NULL CHECK(chat_id ~ '^[0-9]{1,20}$'),
 challenge_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>=0),
 expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','unknown','consumed','stale')),
 telegram_message_id text CHECK(telegram_message_id ~ '^[0-9]{1,20}$'),
 operation_id uuid,
 superseded boolean NOT NULL DEFAULT false,
 outcome text CHECK(outcome IN ('solved','new_challenge','unknown','stale','invalid','already_used')),
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,challenge_id), UNIQUE(chat_id,telegram_message_id)
);
CREATE INDEX job_captcha_photos_reply ON job_captcha_photos(chat_id,telegram_message_id);
CREATE TABLE job_captcha_controls (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 refresh_requested boolean NOT NULL DEFAULT false
);
