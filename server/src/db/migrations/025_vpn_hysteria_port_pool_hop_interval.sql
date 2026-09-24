-- Happ's multi-port import does not accept a per-URI hop interval. Keep the
-- public pool probe aligned with the Hysteria/Happ 30-second default instead.
UPDATE vpn_hysteria_port_pools
SET hop_interval_seconds = 30,
    revision = revision + 1,
    changed_at = NOW(),
    changed_by = 'migration-025'
WHERE generation IN (
  'd8cbe2ba-f23b-45d1-91d6-9c9da9e0ce11',
  '2c1e053c-5c70-4a1f-8d9b-5c1da159ce92'
) AND hop_interval_seconds = 15;
