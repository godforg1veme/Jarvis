# VPN external-probe credential path and recheck design

Status: approved conversational design on 2026-09-23; implementation pending written-spec review.

## Problem and observed evidence

The owner confirmed the first fixed binding, NL runner to DE VLESS. The
credential file exists on NL under `/etc/jarvis-vpn/probes`, but the one-shot
unit exited with systemd `243/CREDENTIALS` before its runner started. The unit
looks one directory higher and requires both VLESS and Hysteria2 files even
though the owner installs one protocol at a time. The server correctly recorded
this `probe.install` attempt as `unknown` with `PROBE_RUN_UNKNOWN`. It must not
be replayed or retroactively marked successful.

## Unit and credential boundary

- Keep the Host Agent's configured root-only credential directory as the single
  source of truth. The deployed unit and its installer use
  `/etc/jarvis-vpn/probes/probe-%i.env` and matching per-protocol URI paths.
- Each owner-confirmed credential install ensures the other protocol's URI
  file exists as an empty root-owned mode-0600 placeholder, without replacing
  an existing regular file. The real credential is validated and atomically
  installed by the existing Host Agent path. Refuse symlinks and irregular
  files; do not read or echo credential contents in diagnostics.
- The runner's existing empty-file behavior is `NOT_CONFIGURED`. A placeholder
  cannot constitute an installed credential or a healthy protocol check.
- For the already installed first binding, deployment may create only its
  missing empty counterpart after verifying path/type/mode. Never copy,
  regenerate, rotate, or print the installed VLESS URI. Timers remain disabled.

## Owner-confirmed recheck

- Add one closed `probe.recheck` action and callback for each of the four
  existing fixed source/protocol bindings in the owner-only Telegram external
  checks screen. The visible label is `Проверить установленный ключ:` followed
  by the existing direction/protocol. No free-form target or credential enters
  callback data.
- Require a fresh origin-bound confirmation in the owner's private Telegram
  chat. Reject member, foreign conversation/chat, expired, stale, duplicate,
  malformed, and oversized callbacks using the existing action framework.
- The recheck invokes one closed `vpn.external_probe.run` on the opposite node.
  It does not export, issue, rotate, install, delete, or reveal a credential.
  Validate target, runner, timestamp, and the relevant check: VLESS requires
  `vless_tcp_8443`; Hysteria2 requires `hysteria2_udp_hop`. A missing, failed,
  mismatched, stale, or ambiguous check cannot pass.
- Persist only the closed binding and proof fields already used for acceptance.
  Keep the original `probe.install` row `unknown`; a successful recheck creates
  its own auditable `probe.recheck` row. No URI, password, raw command output,
  or unchecked error text reaches PostgreSQL, Telegram history, logs, prompts,
  or telemetry.
- The timer gate considers the latest owner-confirmed attempt for each fixed
  binding across install, rotate, and recheck. All four distinct latest attempts
  must have succeeded within 24 hours with node/protocol-matched proof. Any
  later failed or unknown attempt blocks that binding. An accepted recheck does
  not authorize service repair, key rotation, or a timer by itself.

## Delivery and verification

- Add focused Host Agent tests for first-protocol install, placeholder safety,
  missing credential, and irregular paths; static unit checks assert aligned
  paths and retained sandboxing. Test the NL-to-DE first-install case.
- Add server tests for callback grammar and scopes, confirmation, no duplicate
  run, recheck-only operation, relevant-check validation, and the four-proof
  timer gate. Run the required Telegram focused suite, full server suite, and
  Host Agent suite.
- Update the Telegram menu contract, AGENTS.md status, and rollout record.
  Verify the running restart-playbook flags and owner acceptance record before
  changing production. Deploy unit files and server source with backups;
  run preflight, Compose health, public smoke, and unit verification. Confirm
  both probe timers stay disabled and both VPN stacks stay healthy.
- The owner then confirms the new NL-to-DE VLESS recheck from Telegram. Only a
  fresh successful result counts as first proof. Repeat separately for the
  other three bindings. Enable the 15-minute timers only after all four proofs
  and another explicit owner confirmation. Real phone/Happ behavior and a real
  repair acceptance remain separate manual checks.

## Rollback

Restore the previous backed-up unit and server image/source, leave timers
disabled, and retain existing credential files and audit rows. Do not replay
the unknown install or attempt to reconstruct one-time URIs.
