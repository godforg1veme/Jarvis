# VPN external-probe credential recheck rollout

Date: 2026-09-23

## Deployed change

Release `a9046d5` is a direct descendant of the integrated production release
`f7af2a7`. It adds a private-chat Telegram button for one owner-confirmed,
read-only recheck of an already-installed probe credential. It does not replay
the previous request, install or rotate a credential, or enable a timer.

The Host Agent credential helper and systemd template now use the same
root-only `/etc/jarvis-vpn/probes` directory. The missing protocol counterpart
is created only as an empty root-owned mode-0600 file; an existing file is
never overwritten. Production backups are retained on each VPS at
`/root/jarvis-vpn-probe-recheck-a9046d5/`.

## Verified

- Local full server tests passed 558/558; Host Agent tests passed 111/111 on
  Linux, including the root-only symlink rejection case.
- Production preflight passed before the image switch. Public
  `/health/live` and `/health/ready` checks passed afterward.
- The candidate container loaded both recheck modules and migration 027. The
  production server runs image
  `sha256:591d90f4f9c03915f2c6fb56098f11a74f4d7a8cb8b3f114d98d56ef025b2ca9`,
  has Docker health `healthy`, and contains the new Telegram recheck action.
  Migration `027_vpn_probe_recheck_action.sql` is registered in PostgreSQL.
- Host Agent, Xray, and Hysteria2 are active on both DE and NL.
  `systemd-analyze verify` passed for both probe-unit instances on both nodes;
  the effective timer cadence is 15 minutes with a two-minute boot delay,
  30-second jitter, and 15-second accuracy, still disabled/inactive.
- On NL, the existing DE-targeted VLESS file was verified by metadata only as
  a regular `root:root` mode-0600 file; its contents were not read or changed.
  Its missing Hysteria2 counterpart is now an empty `root:root` mode-0600 file.
- PostgreSQL still has exactly one `probe.install` row with status `unknown`,
  zero pending/running probe actions, and no `probe.recheck` row yet. That
  unknown result is preserved. The failed systemd attempt was timestamped
  2026-09-23 15:03 UTC (18:03 Moscow), matching the original owner screenshot;
  it was not re-run during deployment.
- Both probe timers remain `disabled` and `inactive` on DE and NL. No external
  probe ran during this deployment. The previous server image is retained as
  `jarvis-family-server:rollback-before-a9046d5`; the deployed image is also
  tagged `jarvis-family-server:release-a9046d5`.

## Owner acceptance still required

Open the VPN external-check section in the owner's private Telegram chat,
select the NL-to-DE VLESS recheck, and confirm its fresh request. This performs
one VLESS TCP 8443 test using the existing test credential. Only its bounded
pass/unknown/fail result is returned. Do not repeat the old installation or
rotate the key if the result is uncertain.

The other three fixed test bindings still need their own owner-confirmed
credential installs and successful one-shot checks. Keep both 15-minute timers
disabled until all four fresh checks succeed and the owner separately confirms
timer activation. This monitoring setup is not a 99.9% uptime guarantee; the
first live probe and timer acceptance are still outstanding.
