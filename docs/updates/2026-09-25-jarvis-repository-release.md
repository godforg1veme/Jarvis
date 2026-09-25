# Jarvis repository and subscription release

Date: 2026-09-25

## Repository

The existing GitHub repository is now [`godforg1veme/Jarvis`](https://github.com/godforg1veme/Jarvis). The project files live at the repository root, and `main` is the only remaining branch on GitHub. The About description names the cloud service, Telegram access, and Windows desktop client. The README was rewritten in plain Russian and checked against the implemented features and recorded test results.

The following branches were reviewed and folded into `main` before deletion:

- `fix/telegram-subscription-interactions`: guided Happ profile creation and rename.
- `codex/vpn-supervisor-integration`: VPN Supervisor integration and its acceptance record.
- `codex/telegram-dialog-release`: Telegram menu tap acceptance documentation.
- `feat/happ-resilient-subscription`: Happ port-hopping defaults.
- `dev/local-testing`: Quantum Core and companion widget documentation.

The remote branch tips were ancestors of the published `main`. No open pull request depended on them. Stale local branches, temporary worktrees, and audited pre-consolidation stashes were removed after the clean canonical checkout was verified.

## Happ subscription profile fix

The guided profile creation and rename flows now use interaction kinds accepted by the Telegram repository and migration 028. The rename context validates the subscription UUID. The automated Telegram-handler E2E exercises creation, invalid-name retry, client binding, rename, owner and chat scoping, and token redaction.

The production server was built from clean GitHub checkout `eeb1c210d53b08cc0b322243998add8e63a2ffe6` in `/home/deploy/releases/jarvis-eeb1c210`. The previous mixed checkout at `/home/deploy/apps/jarvis` was left intact to preserve its environment file, backups, staging data, and pending-operation marker. Its `origin` URL now points to the renamed repository.

Before deployment, a one-time PostgreSQL custom-format backup was written to:

`/home/deploy/apps/jarvis/.deploy-backups/jarvis-eeb1c210-20260925/postgres.dump`

The file is mode `0600`, 4,659,284 bytes, and has SHA-256 `4e0770b26ea273359748da4ad86a8477ed090b2babcfe909f2582c1da433d897`. `pg_restore --list` validated the archive inside the PostgreSQL container. The previous server image remains tagged `jarvis-family-server:rollback-before-eeb1c21` (`sha256:c95cc41d1b4fdcd17a14c881d498ae029a11b912ba2de28ac2570b6caf5afccb`).

Only the Compose `server` service was rebuilt and recreated under project `jarvis-family`. PostgreSQL, GigaAM ASR, Cloudflare Tunnel, Xray, Hysteria2, and both Host Agent services were left running. Migration `028_telegram_subscription_interaction_kinds.sql` is recorded in production PostgreSQL, and the live constraint accepts both guided subscription label kinds. The server is healthy, the public readiness endpoint returned HTTP 200, the deployment smoke script passed, and the bounded post-release error count was zero.

The real owner-approved VPN Supervisor acceptance state was rechecked before deployment and left unchanged. The synthetic acceptance flag is off, the two matching service-restart playbooks are enabled, restore playbooks are disabled, and the previously recorded owner-approved NL Xray drill remains in the database.

## Verification

- Full server suite: 590 passed, 0 failed.
- Focused migration and Telegram guided-flow suite: 27 passed, including profile creation, binding, and rename.
- Operations UI: 1 unit test passed; production build passed; browser coverage passed for nine screens at widths 1440, 390, and 320 pixels.
- Host Agent Python suite: 123 passed, 3 skipped. Both VPS installations contain the same 16 Python modules; content and systemd unit match the reviewed source after line-ending normalization. No Host Agent restart was needed.
- Desktop cloud tests: 20 passed.
- The additional desktop script `node scripts/testFileCommands.js` still fails for `покажи config.json в документах`: the parser returns `visual_analyze` instead of `reveal_file`. This unrelated behavior was not changed.
- The Operations UI dependency audit reports two moderate Vitest-related advisories. They were not upgraded as part of this release.
- A clean root `npm ci` still fails while building the transitive `ffi-napi`/libffi dependency on Windows (`call` is reported as unavailable). The verified existing dependency tree had the exact locked direct package versions, and electron-builder successfully rebuilt both native modules for Electron 42.4.0.

## Windows desktop

The installed app was version 1.0.0 and registered as a machine-wide installation under `C:\Program Files\Jarvis Desktop`. Package version 1.0.1 was built as an all-users NSIS installer to keep the update in the same location; electron-builder reported `perMachine=true`. The installer file is `dist/Jarvis-Desktop-1.0.1-Setup.exe` (183,689,844 bytes, product version 1.0.1).

The first silent machine-wide upgrade attempt was cancelled at the Windows UAC prompt. The installed application therefore remains at version 1.0.0; no installation success is claimed. The 1.0.1 installer and old installed application are retained until an administrator approves the upgrade and the installed-version/start checks pass.

## Outstanding checks

- A real owner Telegram phone tap through create, bind, and rename remains manual acceptance. The automated E2E and production database constraint passed, but they do not prove a real Telegram client tap.
- A live systemd check found `jarvis-vpn-probe@de.timer` disabled/inactive and `jarvis-vpn-probe@nl.timer` enabled/active. This differs from the 2026-09-24 rollout record. No timer or credential was changed during this release; reconcile that state separately.
- The duplicate source files at `F:\test` were removed after verifying `F:\test\jarvis` and GitHub `main`. Local execution policy rejected deletion of the old parent `.git` metadata, so it remains with staged source deletions. Use `F:\test\jarvis` as the project root and do not commit from `F:\test`.
