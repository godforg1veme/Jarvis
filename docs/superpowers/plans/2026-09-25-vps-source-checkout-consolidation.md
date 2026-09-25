# VPS Source Checkout Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put GitHub `main`, the Windows checkout, and both VPS source directories on one verified commit while preserving operational state and preventing future deployment from a stale checkout.

**Architecture:** Add one Python standard-library preflight with `source` and `release` modes, call it before deployment scripts can mutate a host, and document the canonical source workflow. Publish those safeguards on `main`, then stage fresh single-branch checkouts on each VPS and promote only after state, Compose, and service checks pass.

**Tech Stack:** Git, Python 3 standard library, PowerShell, Bash, SSH, Docker Compose, systemd.

**Spec:** `docs/superpowers/specs/2026-09-25-vps-source-checkout-consolidation-design.md`

## Global Constraints

- `main` is the only permanent shared branch; do not force-push it.
- Both VPS source paths remain `/home/deploy/apps/jarvis`.
- Do not expose or log contents of `.env`, deploy secrets, VPN credentials, operation markers, or rendered Compose configuration.
- Do not restart or recreate application, database, VPN, Host Agent, probe, or ingress services for source-tree normalization.
- Preserve `.env`, `.backups`, `.deploy-backups`, deployment staging artifacts, `pendingCommandId`, local data, user data, ownership, and restrictive permissions.
- Do not delete existing backup, database, environment, credential, pending-operation, active-release, or rollback artifacts.
- Stop before promotion if state checks, permissions, checksums, source SHA, service health, or Compose parity fail.
- Do not change Telegram, VPN, database, or other product behavior.

---

### Task 1: Add and exercise the canonical checkout preflight

**Files:**
- Create: `deploy/scripts/verify-source-checkout.py`
- Create: `host-agent/tests/test_source_checkout_guard.py`

**Interfaces:**
- CLI source check: `python3 deploy/scripts/verify-source-checkout.py source <repository-path>`
- CLI immutable release check: `python3 deploy/scripts/verify-source-checkout.py release <recorded-40-character-sha> <release-path>`
- Both successful checks print only the verified commit SHA; failures return nonzero with a safe reason that does not include environment values or secret contents.
- Both modes require `origin` to be exactly `https://github.com/godforg1veme/Jarvis.git`, fetch and prune `origin/main`, and verify the requested directory is the Git worktree root.
- `source` requires a clean worktree including untracked non-ignored files, checked-out `main`, only local branch `main`, only remote-tracking ref `origin/main`, `HEAD == origin/main`, and no root `jarvis/` directory.
- `release` requires `HEAD` to equal the supplied full SHA and be an ancestor of the fetched `origin/main`; it rejects modified tracked or untracked non-ignored files.

- [ ] **Step 1: Write failing tests using temporary local Git repositories**

Create bare `main` remotes and worktrees under `tempfile.TemporaryDirectory`. Set their configured `origin` URL to the canonical GitHub URL and use a process-local Git `url.<temporary-bare-remote>.insteadOf` rewrite so fetches remain local. Cover: a current clean `main` succeeds; a dirty file fails; an untracked file fails; a nested `jarvis/` directory fails; a checked-out topic branch fails; an extra local branch fails; a stale local `main` fails after the bare remote advances; a wrong origin fails; a valid recorded ancestor release succeeds; an unrecorded SHA and a commit outside fetched `main` fail.

Run: `py -m unittest discover -s host-agent/tests -p test_source_checkout_guard.py -v`

Expected: FAIL because `deploy/scripts/verify-source-checkout.py` does not exist.

- [ ] **Step 2: Implement the guard with closed modes and safe output**

Implement a `main(argv)` CLI in `deploy/scripts/verify-source-checkout.py` using `argparse`, `subprocess.run`, `pathlib.Path.resolve`, and full SHA validation. Read the configured remote with `git config --get remote.origin.url` so Git URL rewrite rules do not change the value being checked. Run preliminary local checks before fetching; then run `git fetch --quiet --prune origin main`. Use `git for-each-ref` to enumerate local and remote-tracking refs. Compare exact path and SHA values. Convert expected Git and OS failures into one-line safe diagnostics and a nonzero exit; never print command output that may contain secret values.

- [ ] **Step 3: Run the focused guard tests**

Run: `py -m unittest discover -s host-agent/tests -p test_source_checkout_guard.py -v`

Expected: all guard mode tests pass, including negative cases; no test contacts GitHub or requires a running service.

- [ ] **Step 4: Review the diff and commit the guard**

Run: `git diff --check; git diff -- deploy/scripts/verify-source-checkout.py host-agent/tests/test_source_checkout_guard.py`

Expected: only the preflight and its focused tests are added; no generated files or secrets are present.

Commit: `feat: guard VPS deployments against source drift`

### Task 2: Place the guard before every existing source deployment mutation

**Files:**
- Modify: `deploy/host-agent/deploy.sh`
- Modify: `deploy/vpn/install-probe-units.sh`
- Modify: `scripts/deployHostAgent.ps1`
- Modify: `host-agent/tests/test_host_agent_deploy_script.py`

**Interfaces:**
- Linux scripts invoke `python3 "${app_root}/deploy/scripts/verify-source-checkout.py" source "${app_root}"` before testing, installing, copying, reloading systemd, or restarting a service.
- The Windows script resolves its repository root from `$PSScriptRoot`, invokes `py deploy/scripts/verify-source-checkout.py source <root>`, and stops before local tests, archive creation, SSH, or SCP if verification fails.

- [ ] **Step 1: Add ordering assertions**

Extend `HostAgentDeployScriptTests` to assert the guard call precedes Host Agent tests, file copy, and service restart. Add checks that the VPN unit installer checks source before `install` and `systemctl daemon-reload`, and that the PowerShell script checks its resolved repository root before tests, tar, SSH, and SCP.

Run: `py -m unittest discover -s host-agent/tests -p test_host_agent_deploy_script.py -v`

Expected: FAIL because the deployment entrypoints do not yet invoke the guard.

- [ ] **Step 2: Wire preflight into deployment entrypoints**

Add the Python guard as the first validation in each entrypoint, before any mutation or upload. Preserve existing Host Agent test-before-copy behavior and existing deployment arguments. In PowerShell, anchor all newly added guard paths to `$PSScriptRoot`; do not change package contents or remote target defaults.

- [ ] **Step 3: Run deployment-script and guard tests**

Run: `py -m unittest discover -s host-agent/tests -p test_*deploy_script.py -v; py -m unittest discover -s host-agent/tests -p test_source_checkout_guard.py -v`

Expected: every ordering and preflight case passes.

- [ ] **Step 4: Commit the deployment gate**

Run: `git diff --check`

Commit: `fix: verify source before deployment mutations`

### Task 3: Make the single-source rule clear to maintainers

**Files:**
- Modify: `AGENTS.md`
- Modify: `deploy/README.md`
- Modify: `docs/superpowers/specs/2026-09-25-vps-source-checkout-consolidation-design.md`

**Interfaces:**
- `AGENTS.md` remains the authoritative contributor instruction; `deploy/README.md` is the operator runbook.
- Both documents name `F:\test\jarvis` as the Windows working copy, `/home/deploy/apps/jarvis` as the source staging path on both VPSs, the canonical GitHub remote, and `main` as the only permanent source branch.
- Deployment docs show the preflight invocation and explain that server release directories must identify an explicit commit reachable from `main`.

- [ ] **Step 1: Add the concise canonical-source rule to `AGENTS.md`**

Update the existing deployment and branch-policy sections, rather than adding a conflicting second architecture description. State that agents start from current `main`, use short-lived task branches only for isolated work, merge verified changes to `main`, and remove task branches after confirmed merge. Require preflight before VPS source staging and forbid nested `jarvis/` repository copies.

- [ ] **Step 2: Update the operator runbook in plain, direct language**

Add a “Canonical source and VPS checkouts” section to `deploy/README.md` with both SSH aliases and roles (primary Jarvis server; secondary VPN/Host Agent node), the one canonical remote and path, the source and release preflight commands, and a concise recovery rule: stop on SHA/config mismatch; do not use `git reset --hard` or `git clean` to repair a production checkout. Make no claims that services were deployed or restarted by this source-only procedure.

- [ ] **Step 3: Mark the approved spec status and review documentation consistency**

Change the spec status to “approved; implementation in progress” and verify that all preservation, rollback, acceptance, and out-of-scope rules remain present. Read `AGENTS.md`, `deploy/README.md`, and the spec together; confirm paths, branch policy, service roles, and preflight syntax agree.

- [ ] **Step 4: Run text and whitespace checks, then commit**

Run: `git diff --check; rg -n "TODO|TBD|jarvis-fix-bug|nested" AGENTS.md deploy/README.md docs/superpowers/specs/2026-09-25-vps-source-checkout-consolidation-design.md`

Expected: no placeholders; any `nested` match describes a prohibited nested checkout. Existing historical statements elsewhere are not broadened or silently rewritten.

Commit: `docs: define canonical VPS source workflow`

### Task 4: Merge and publish the source-drift safeguards on `main`

**Files:**
- No additional source files; publish the commits from Tasks 1–3.

**Interfaces:**
- The task branch must be a fast-forward descendant of the fetched GitHub `main`.
- Deployment target is the exact `origin/main` SHA observed immediately before preparing each VPS.

- [ ] **Step 1: Run the complete Host Agent suite and review branch history**

Run: `py -m unittest discover -s host-agent/tests -v`, `git diff --check`, `git status --short --branch`, and compare task-branch commits with freshly fetched `origin/main`.

Expected: all Host Agent tests pass; task branch contains only this plan/spec and source-consolidation guard/docs; no unrelated user changes are included.

- [ ] **Step 2: Fast-forward local `main`, publish, and confirm GitHub state**

Fetch `origin`; verify no one moved `main` beyond the reviewed base; push the reviewed task-branch tip to `main` without force; query GitHub refs again and record the exact new `main` SHA. Fast-forward the clean `F:\test\jarvis` checkout to that pushed SHA. Delete the local task branch only after the push is confirmed. Do not delete any unrelated remote branch unless its merge into this `main` is verified from its actual diff and history.

- [ ] **Step 3: Verify preflight on the Windows checkout**

On the canonical clean `F:\test\jarvis` `main` checkout, run `py deploy/scripts/verify-source-checkout.py source F:\test\jarvis`.

Expected: success prints exactly the published main SHA.

### Task 5: Inventory and stage fresh VPS source checkouts without touching live services

**Files:**
- Remote operations on `jarvis-vps` and `jarvis-vps-new`; do not edit service configuration or persistent volumes.

**Interfaces:**
- Target: `/home/deploy/apps/jarvis` on both hosts.
- Staging: a sibling directory named `/home/deploy/apps/jarvis.stage.<full-main-sha>`.
- Preserve a private, clearly named temporary rollback directory until all post-promotion checks pass.
- All inventory reports contain only relative paths, sizes, modes, owner/group, and checksums; they never contain file contents, env values, VPN artifacts, or the content of `pendingCommandId`.

- [ ] **Step 1: Reconfirm GitHub target and capture read-only host/service baselines**

Read the exact published `origin/main` SHA immediately before beginning. On both VPSs record hostname, current checkout SHA/branch/remotes/status counts, ownership and modes for preserved operational paths, installed Host Agent service state, Xray/Hysteria2 state, and probe timer state. On the primary host record Compose project/service/container IDs and health, active release SHA, and public `/health/ready` result. Do not print env files, key material, pending marker contents, or rendered Compose output.

Expected: both SSH connections and all bounded read-only baseline checks succeed; otherwise stop before staging.

- [ ] **Step 2: Inventory operational state and compare checksums**

For `.env`, `deploy/secrets`, `.backups`, `.deploy-backups`, each `.deploy-stage-*` path, `pendingCommandId`, and local/user data, record path, file count, byte count, mode, owner/group, and SHA-256 manifest. Identify the exact config files consumed by live Compose and Host Agent services. Keep this manifest outside the Git worktree with restrictive permissions. Never use recursive deletion or copy over an existing secret without comparing its metadata and checksum.

Expected: every operational/generated item is either explicitly retained at the same required path or preserved outside the checkout; all required permissions and checksums are known.

- [ ] **Step 3: Clone current `main` into a fresh sibling staging directory on both VPSs**

Use the exact full GitHub SHA, `--single-branch --branch main`, and the canonical GitHub URL. Verify the clone SHA, remote, clean status, one local branch, only `origin/main`, and no nested `jarvis/`. Re-resolve GitHub `main` before preparing each host; if its SHA changed, stop both promotions and restart verification at the new SHA.

Expected: staged clones on both hosts are byte-identical in Git object revision and have not altered the existing checkout or any service.

- [ ] **Step 4: Restore required operational files into staging and verify manifests**

Copy only the verified current `deploy/.env`, `deploy/secrets`, and any runtime data whose exact path is consumed by the application. Preserve owner, group, mode, timestamps when required, and checksums. Keep old backup/staging artifacts and marker data safe outside tracked source or at explicitly ignored runtime paths; add no secret or state file to Git. Ensure the staged tree can be made clean without discarding any state.

Expected: restored state matches its pre-staging manifest; unneeded old source overlays are not copied into the new project tree.

- [ ] **Step 5: Prove primary Compose parity before promotion**

Render both current and staged Compose configurations with the same project name, explicit project directory `/home/deploy/apps/jarvis`, exact env file and secrets. Compare normalized full configuration hashes in private temporary storage; normalize no differences except staging path prefixes. Confirm service definitions, images/build contexts, mounts, env-file/secret paths, profiles, and network/volume names are identical. Delete private render artifacts after comparison.

Expected: same effective runtime configuration and same required Compose paths. If any field differs or config rendering fails, stop without changing the active checkout.

### Task 6: Promote the two checkouts and verify the final common state

**Files:**
- Remote path swap only after Task 5 acceptance checks; no database schema or application migration operation.

**Interfaces:**
- Promotion order: secondary VPN/Host Agent host first, primary Jarvis host second.
- Both promoted source trees must resolve to the recorded published GitHub `main` SHA.
- Existing immutable server release and all running services remain unchanged.

- [ ] **Step 1: Promote the secondary VPN/Host Agent node**

Reconfirm GitHub `main` SHA and Host Agent/Xray/Hysteria2/probe service baselines. Move the legacy checkout to its temporary rollback path, move the verified staged clone into `/home/deploy/apps/jarvis`, then run the source preflight and state-manifest checks. Do not restart Host Agent, Xray, Hysteria2, or timers.

Expected: source checks pass; every service state equals its recorded baseline.

- [ ] **Step 2: Promote the primary Jarvis node**

Reconfirm GitHub `main` SHA and service baseline. Render Compose config once more from the promoted root and compare to the pre-promotion hash. Move the legacy source checkout to rollback, install the verified staged clone at `/home/deploy/apps/jarvis`, and restore required state with verified permissions/checksums. Do not run `docker compose up`, restart containers, or run database migrations.

Expected: source preflight succeeds; Compose hash and required paths match; existing container IDs and health remain unchanged.

- [ ] **Step 3: Verify both VPSs and public readiness**

On each VPS run source preflight, check exact SHA, only local `main`, only `origin/main`, clean status, and absence of nested source. Recheck Host Agent/Xray/Hysteria2 and probe timer states against their baselines. On primary recheck `docker compose ps` from the canonical path and query `https://jarvis.rilora.ru/health/ready`.

Expected: Windows `main`, GitHub `main`, and both VPS source checkouts report the same SHA; all service states remain healthy and unchanged; public readiness succeeds.

- [ ] **Step 4: Release temporary rollback copies only after checks pass**

After all four source copies and service/readiness checks pass, remove only the temporary obsolete Git/source checkout copies created by this operation. Keep the original backup directories, deployment artifacts, `.env`, secrets, local/user data, pending marker, active release, and all pre-existing rollback artifacts intact. Verify preserved-state checksums once more. If any post-promotion check fails, restore that host's old checkout from the temporary rollback copy before removing anything.

- [ ] **Step 5: Record completion and close the task branch**

Update the spec status and add a dated factual deployment note with the final SHA and checks performed; include only metadata and service outcomes, never secrets or marker content. Run documentation/whitespace checks, confirm `main` is clean and pushed, confirm no task branch remains locally or remotely, and provide the user a plain-language report of changed docs/guards, exact source SHA, preservation checks, VPS results, and any failed or deferred checks.

## Self-Review

- Spec coverage: tasks 1–2 implement future drift prevention; task 3 documents it; task 4 publishes on `main`; task 5 inventories and stages without mutation; task 6 promotes, verifies, rolls back on failure, and removes only the temporary obsolete source copies.
- Preservation rules, Compose parity, deployment immutability, no-restart constraints, exact-SHA agreement, and final report are explicitly covered.
- The guard interface is consistent everywhere: `source <repo>` and `release <full-sha> <repo>`.
- Tests are local and deterministic; remote operations are separate from unit tests and have fail-closed checkpoints.
- No placeholder steps or unapproved product changes are included.
