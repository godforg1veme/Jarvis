CREATE TABLE IF NOT EXISTS vpn_hysteria_port_pools (
    node_code TEXT PRIMARY KEY CHECK (node_code IN ('de', 'nl')),
    generation UUID NOT NULL UNIQUE,
    ports INTEGER[] NOT NULL,
    hop_interval_seconds SMALLINT NOT NULL CHECK (hop_interval_seconds BETWEEN 5 AND 45),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by TEXT NOT NULL CHECK (char_length(changed_by) BETWEEN 1 AND 120)
);

-- Public-only initial pools. They remain inside the pre-existing 20000:50000 UDP
-- allowlist/DNAT range and do not contain a hostname, URI, client, or credential.
INSERT INTO vpn_hysteria_port_pools
  (node_code, generation, ports, hop_interval_seconds, changed_by)
VALUES
  ('de', 'd8cbe2ba-f23b-45d1-91d6-9c9da9e0ce11', ARRAY[20011, 22229, 26549, 30013], 15, 'migration-024'),
  ('nl', '2c1e053c-5c70-4a1f-8d9b-5c1da159ce92', ARRAY[20117, 23483, 27611, 31829], 15, 'migration-024')
ON CONFLICT (node_code) DO NOTHING;
