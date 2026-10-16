ALTER TABLE job_captcha_controls
 ADD COLUMN request_id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN explicit_request boolean NOT NULL DEFAULT true;

ALTER TABLE job_captcha_photos
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=4),
 ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
