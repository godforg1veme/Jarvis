# Remaining Maintenance Implementation Plan

> Execute inline with executing-plans. Steps use checkboxes for progress.

**Goal:** Complete authorized maintenance fixes and leave one synchronized main branch.
**Architecture:** Narrow shared Vision matcher correction, compatible dependency updates, and a verified locked-install wrapper.
**Tech Stack:** Node.js CommonJS, npm, Vitest, PowerShell, Ubuntu systemd.
**Spec:** docs/superpowers/specs/2026-09-29-remaining-maintenance-design.md

## Constraints

No new production dependency, no secrets in output, no source reset/clean on production, no self-target timer activation. Preserve ignored user data. Real client acceptance must be distinguished from handler tests.

- [x] Extend scripts/testVisualIntent.js with file commands that must not trigger Vision and explicit visual targets that must still trigger it; run the test before fixing.
- [x] Narrow the show-command branch in vision/visualIntent.js; run testVisualIntent.js, testFileCommands.js and testIntentRouter.js.
- [x] Add scripts/installDependencies.js and npm setup entry. Run locked installation with FFI_NAPI=1 only on Windows, then verify all native modules and Electron. Run setup from a clean dependency directory.
- [x] Update Operations UI Vitest to 4.1.11 and update audited root dependencies within existing ranges; inspect lockfile diffs. Run Operations UI tests/build and both audits.
- [x] Run focused Telegram subscription handler/migration tests and adjacent Desktop tests. Inspect any failure rather than hiding it.
- [x] Write the dated result record and update current instructions for installation and host-to-peer timer directions.
- [ ] Commit reviewed changes, fast-forward main and publish. Synchronize both VPS source checkouts without restarting unchanged server code, remove task worktree/branch, and run the source guard everywhere.

- [x] Owner approved Desktop update; build and install 1.0.2, verify packaged/installed Vosk, installed source and application startup.
