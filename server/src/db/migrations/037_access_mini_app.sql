CREATE TABLE access_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 bootstrap_key text UNIQUE CHECK(bootstrap_key IS NULL OR bootstrap_key='legacy')
);
CREATE TABLE access_role_permissions (
 role_id uuid NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
 permission text NOT NULL CHECK(permission IN ('assistant','jobs','life','memory','documents','devices','vpn','operations')),
 PRIMARY KEY(role_id,permission)
);
CREATE TABLE access_memberships (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 telegram_id text NOT NULL UNIQUE CHECK(telegram_id ~ '^[1-9][0-9]{0,19}$'),
 level text NOT NULL DEFAULT 'member' CHECK(level IN ('member','admin')),
 role_id uuid REFERENCES access_roles(id),
 blocked boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE TABLE access_user_overrides (
 user_id uuid NOT NULL REFERENCES access_memberships(user_id) ON DELETE CASCADE,
 permission text NOT NULL CHECK(permission IN ('assistant','jobs','life','memory','documents','devices','vpn','operations')),
 effect text NOT NULL CHECK(effect IN ('allow','deny')),
 PRIMARY KEY(user_id,permission)
);
CREATE TABLE access_operations (
 actor_id uuid NOT NULL REFERENCES users(id),
 operation_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(pg_column_size(result)<32768),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,operation_id)
);
CREATE TABLE access_audit (
 id bigserial PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES users(id),
 operation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('user.create','user.update','role.create','role.update')),
 target text NOT NULL CHECK(char_length(target)<=100),
 changes jsonb NOT NULL CHECK(pg_column_size(changes)<32768),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mini_app_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES access_memberships(user_id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mini_app_sessions_expiry_idx ON mini_app_sessions(expires_at);
