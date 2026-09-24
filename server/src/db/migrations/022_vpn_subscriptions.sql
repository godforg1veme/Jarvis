CREATE TABLE IF NOT EXISTS vpn_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    client_id_de TEXT,
    client_id_nl TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vpn_subscriptions_token_hash 
    ON vpn_subscriptions(token_hash) 
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vpn_subscriptions_user 
    ON vpn_subscriptions(user_id, created_at DESC);
