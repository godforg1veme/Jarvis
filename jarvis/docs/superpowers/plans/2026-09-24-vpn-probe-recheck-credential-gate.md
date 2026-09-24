# VPN probe recheck credential gate

Status: implementation deployed on DE and NL on 2026-09-24; one of four owner-approved probe bindings accepted, timer activation pending.

## Evidence and scope

The owner selected Germany → Netherlands VLESS at 02:26 Moscow time. The
durable `probe.recheck` row targets `nl` from runner `de`, while the only
installed test credential is for the opposite direction (`de` from `nl`). On
the DE runner, `jarvis-vpn-probe@nl.service` exited with systemd
`CREDENTIALS (243)` at the same time. The NL result file on DE does not exist;
the expected credential source on DE is absent. The action became `unknown`
with `PROBE_RUN_UNKNOWN`, which says nothing about tunnel health.

## Design

1. The owner-only Telegram external-check menu offers `Проверить ключ` only
   for a fixed binding with a completed `probe.install` or `probe.rotate`
   attempt by that owner. A stale or handcrafted callback is checked again
   before a confirmation record is created. Existing callback bytes and the
   private, conversation-bound confirmation remain unchanged.
2. An owner-confirmed recheck sends the fixed protocol alongside the target
   node to Host Agent. The Host Agent checks only root-owned file metadata for
   the requested credential, its required counterpart, and the public probe
   environment before starting systemd. It never reads or returns a URI.
   Missing requested credentials fail with a closed `failed` code; unsafe or
   incomplete file setup fails closed separately. Older target-only requests
   remain accepted during rollout.
3. The server maps the missing-credential code to a clear Telegram answer and
   records the attempt as `failed`, with no probe execution. Unknown systemd
   outcomes still remain `unknown` and are never automatically retried.
4. Tests cover the correct and reverse directions, stale callbacks, absent and
   unsafe files, no systemd call on preflight failure, wire validation, and
   preserved one-shot confirmation. Update the menu contract and current
   status records. Deploy agents before the server, verify production health
   and disabled timers, then ask the owner to confirm only the installed
   Netherlands → Germany VLESS recheck in private Telegram.

## Acceptance

- The reverse direction has no recheck button and its old callback creates no
  confirmation.
- Missing requested credential returns a closed failure without starting the
  probe service; no credential bytes enter logs, database, or Telegram.
- The installed direction remains available and still requires one fresh
  owner confirmation. A healthy `vless_tcp_8443` result, not code deployment,
  is required for acceptance. The owner subsequently completed that result
  through a new confirmed installation at 03:00 Moscow. The other three
  bindings and timer approval remain separate.

## Rollout result

The local server suite passed 561 tests. Windows Host Agent tests passed 119
(3 Linux-only checks skipped); staged Linux suites passed 114 on DE and 113 on
NL. The production candidate image passed all 52 targeted VPN tests. Full
image suite failures were unrelated fixture/environment mismatches, including
missing deployment templates in the runtime image; they are not acceptance
evidence. Preflight, public smoke, readiness, and container health passed.
Both Host Agents, Xray, and Hysteria2 are active; both probe timers remain
disabled/inactive. The existing NL runner credential has correct root-only
metadata. No probe or credential mutation was run during deployment. See
`docs/updates/2026-09-24-vpn-probe-recheck-gate-rollout.md`.
