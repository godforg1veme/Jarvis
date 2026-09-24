# VPN Operations Documentation and Publication Plan

> **For agentic workers:** Execute this plan inline in the current task. Preserve unrelated changes; do not alter runtime behavior.

> **Execution note:** Completed on 2026-09-24. Documentation reconciled against production code and acceptance; the complete server suite passed 587/587. The local Windows Python launcher was unavailable, so the Host Agent Python suite was not rerun here; the prior production rollout passed staged Host Agent suites on both nodes. Commit `6dc0409` was published to `origin/codex/vpn-supervisor-integration`. The complete Markdown tree was copied without overwriting existing files to `/home/deploy/apps/jarvis/docs/releases/vpn-ops-2026-09-24/`; file count and key hashes matched.

**Goal:** Publish an accurate operational description of VPN monitoring, alerts, owner-confirmed repair scope, and unhandled failures to the project Markdown authorities, production DE checkout, and GitHub.

**Architecture:** Reconcile the owner-facing runbook and Supervisor guide against the deployed code and verified live acceptance. Keep external path probes, Operations incident notifications, and Supervisor restart proposals as separate mechanisms. Publish the completed current VPN worktree on its existing feature branch and copy only the finalized Markdown files to the production DE checkout after a read-only cleanliness check.

**Tech Stack:** Markdown, Git, SSH/SCP, existing Node.js/Python verification suites.

**Spec:** `AGENTS.md`, `docs/README.md`, `docs/VPN_RESILIENCE_RUNBOOK.md`, `docs/VPN_SUPERVISOR_REPAIR_GUIDE.md`, `server/src/operations/incidents/vpnIncidentAdapter.js`, `server/src/operations/vpnSupervisor/playbookCatalog.js`, and `server/src/operations/vpnSupervisor/policy.js`.

## Global Constraints

- Do not add credentials, connection URIs, tokens, user IDs, or raw logs to documentation.
- Do not imply that a periodic external probe failure automatically triggers a service restart or proactive Telegram alert.
- Describe real repairs as owner-confirmed; do not claim autonomous repair or 99.9% availability.
- Preserve Telegram callback grammar, labels, row order, and confirmation boundaries.
- Upload documentation to the production application VPS (`jarvis-vps`) only after confirming the exact destination and preserving its existing state.
- Publish without force-pushing or rewriting history.

---

### Task 1: Reconcile operational Markdown

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/README.md`
- Modify: `docs/VPN_RESILIENCE_RUNBOOK.md`
- Modify: `docs/VPN_SUPERVISOR_REPAIR_GUIDE.md`
- Modify: `docs/telegram-menu-contract.md`
- Modify: `docs/updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md`

- [x] State the two runner directions and four protocol/direction bindings, with checks for VLESS 443/8443 and Hysteria2 fixed 443/hopping.
- [x] Distinguish external probe visibility/subscription demotion from Operations alerting; say explicitly that timer probe failures do not currently feed the Telegram incident notifier.
- [x] Document alert debounce (three consecutive matching VPN observations; default Operations polling interval 30 seconds) and enumerate diagnostic-only failure classes.
- [x] Document only the `XRAY_SERVICE_FAILURE` and `HYSTERIA2_SERVICE_FAILURE` owner-confirmed limited restarts, their preconditions/postchecks, the live-accepted NL Xray case, and untested live cases.
- [x] Preserve the known gaps: unattended DNS-01 certificate renewal has not been witnessed; 99.9% availability is not established.

### Task 2: Verify the publication set

**Files:**
- Review the Task 1 Markdown files and existing VPN implementation diff.

- [x] Run `git diff --check` and the full server test suite (587/587).
- [x] Check for stale claims that the live NL Supervisor restart has not been tested; remaining older descriptions are explicitly dated historical snapshots.
- [x] Verify no credential-pattern matches or unrelated/generated paths are in the staged set; all 50 staged files belong to the current VPN acceptance scope.
- [x] Inspect `jarvis-vps` repository status, current branch, and HEAD without modifying it; its checkout is dirty, so publication will use a new dated no-overwrite docs directory.

### Task 3: Publish

**Files:**
- Commit the complete in-scope VPN acceptance worktree and this documentation update.

- [x] Create one descriptive Conventional Commit including a body explaining the distinction between monitoring, alerting, and owner-confirmed repair.
- [x] Push the feature branch to the sole configured remote `origin` without force.
- [x] Copy the finalized Markdown files to the verified production DE checkout without overwriting unrelated user changes.
- [x] Verify the remote commit, server-side file hashes/status, and public service health; do not rebuild/restart the already healthy production service for Markdown-only changes.
