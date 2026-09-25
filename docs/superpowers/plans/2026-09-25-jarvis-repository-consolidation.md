# Jarvis GitHub and workspace consolidation Implementation Plan

> **For agentic workers:** Execute inline, one task at a time. Keep the temporary worktree and local-only branch until the completed `main` has been pushed and verified, then remove both.

**Goal:** Leave one clear Jarvis project at the root of `godforg1veme/Jarvis`, with `main` as its only permanent branch and `F:\test\jarvis` as the canonical local checkout.

**Architecture:** Preserve the existing repository history and promote the tracked contents of `jarvis/` to the repository root. Reconcile GitHub, local refs, documentation, and workspace state only after each source change has been checked.

**Tech Stack:** Git, GitHub CLI, Windows PowerShell, Markdown, Node.js 20+.

**Spec:** `docs/superpowers/specs/2026-09-25-github-jarvis-cleanup-design.md`

**Status:** GitHub consolidation, branch cleanup, and canonical checkout are complete (2026-09-25). The duplicate source files in `F:\test` were removed. Its hidden outer `.git` metadata remains because the local execution policy rejected the final recursive deletion; `F:\test\jarvis` is the canonical repository.

## Global constraints

- `main` is the only permanent shared branch; do not force-push.
- Preserve `.env`, `data/`, models, voices, backups, local state, and uncertain operation markers outside Git.
- Never delete a branch, worktree, stash, or source directory before comparing it with the verified `main` and checking for active users.
- Keep historical specifications and rollout records; update their index instead of rewriting history.
- Keep the Telegram menu labels, row order, callback grammar, and visibility unchanged.
- Do not add a production dependency.

---

### Task 1: Recheck branch, stash, worktree, and GitHub state

**Files:** No source files. Inspect Git refs, worktrees, stashes, GitHub open PRs, and workspace folders.

- [x] Fetch current refs and compare every remote/local topic branch against `origin/main`.
- [x] Confirm the five remote topic branches have no commits ahead of `origin/main`; confirm the local `codex/telegram-dialog` commit is patch-equivalent to `origin/main`.
- [x] Inspect both stashes and the June backup refs. The workspace stash is based on an ancestor of `origin/main`; its snapshot omits later code and many current documents, so do not apply it wholesale.
- [x] Confirm current Git worktrees are clean. Their branches remain attached; check Codex task usage before removal.
- [x] Check open PRs and the GitHub branch list: no PRs are open; the remote has only `main` plus the five listed topic branches. Repeat this check immediately before deleting remote branches:

```powershell
gh pr list --repo godforg1veme/jarvis-fix-bug --state open --json number,title,headRefName,baseRefName
```

Expected: no open PR depends on a topic branch, or any open PR is resolved before that branch is removed.

### Task 2: Prepare one isolated consolidation worktree

**Files:** Git worktree metadata only.

- [x] Confirm `F:\test` `main` was clean and pointed to approved spec/plan commit `5c5374e`.
- [x] Use the native Codex worktree tool, then create the planned local-only branch at that exact commit. The actual worktree is `C:\Users\maxob\.codex\worktrees\jarvis-consolidation\test`; do not push this temporary branch:

```powershell
git -C C:\Users\maxob\.codex\worktrees\jarvis-consolidation\test switch -c codex/jarvis-consolidation
git -C C:\Users\maxob\.codex\worktrees\jarvis-consolidation\test status --short --branch
```

Expected: the new worktree is clean and its `HEAD` equals the current local `main`.

### Task 3: Promote Jarvis source files to the repository root

**Files:** Move tracked paths from `jarvis/` to repository root. Reconcile `.gitignore`, `README.md`, `AGENTS.md`, `CLAUDE.md`, and `gemini.md` explicitly. Update active references in documentation, package/deploy scripts, and `server/test/telegramArchitectureContract.test.js`.

- [x] Inventory top-level collisions and capture the full inner `.gitignore` before moving files:

```powershell
Get-ChildItem -LiteralPath .\jarvis -Force | Select-Object Name,Mode
Get-Content .\.gitignore
Get-Content .\jarvis\.gitignore
```

- [x] Merge the inner ignore rules into the root `.gitignore`, retaining `.worktrees/` and every rule that excludes secrets, generated state, user data, build output, and downloaded assets.
- [x] Replace the outer pointer `AGENTS.md` and wrapper `README.md` with the authoritative root files. Keep `CLAUDE.md` and `gemini.md` as thin pointers to root `AGENTS.md`.
- [x] Move the tracked project entries from `jarvis/` to the root. No unexpected path collision was found.
- [x] Remove the empty wrapper directory after confirming every tracked source path is at the root.
- [x] Search active source and docs for stale `jarvis/` root assumptions and update them. Historical records remain unchanged.
- [x] Update `server/test/telegramArchitectureContract.test.js` to require root `AGENTS.md` and the root-level `docs/telegram-menu-contract.md` path.
- [x] Run the architecture contract and migration/Telegram contract tests from the new root layout as part of the complete server suite:

```powershell
Push-Location .\server
node --test test/telegramArchitectureContract.test.js test/migrations.test.js test/telegramInteractionRepository.test.js
Pop-Location
```

Expected: all selected tests pass, and no secret or generated data file is staged.

### Task 4: Write and humanize the public project description

**Files:** Root `README.md`, `docs/README.md`, root `AGENTS.md`; GitHub About text and topics.

- [x] Read the current product entry point and documentation index after the move. Retain only claims supported by current source or verified deployment records.
- [x] Rewrite root `README.md` in Russian with the project purpose, cloud service, Telegram entry point, Windows client, current verified capabilities, a short local quick start, and links to architecture and documentation status.
- [x] Apply the `humanizer` skill to root `README.md` in file mode. Preserve technical facts, commands, paths, code, and link targets; remove generic promotional wording and repeated claims.
- [x] Update `docs/README.md` and active `CLAUDE.md` status only where they contained stale layout or status wording. Historical records remain intact.
- [x] Add this approved specification and the three execution plans to the `docs/README.md` tables with their current status.
- [x] Add the permanent branch rule to root `AGENTS.md`. The existing Telegram guided-input invariant already requires repository, context, PostgreSQL, and E2E contract parity, so it was retained rather than duplicated.
- [x] Run `git diff --check`, inspect the Markdown structure, and search active root docs for the obsolete nested-project wording.

### Task 5: Verify the flattened source and commit repository changes

**Files:** All moved/edited root paths and the root-level server contract tests.

- [x] Run the complete cloud-server suite:

```powershell
Push-Location .\server
npm test
Pop-Location
```

Expected: zero failed tests. Record any skipped tests and their reasons.

- [x] Run `git diff --check`, `git status --short`, and a secret/state path audit before staging.
- [x] Review rename detection and all deletions with `git diff --summary` and `git diff --name-status`; only the old wrapper files were deleted as they were replaced at the root.
- [x] Commit the verified root move and documentation as focused Conventional Commits. The main consolidation commit is `eeb1c210`; the final release-record/installer-policy commit is recorded in GitHub `main` after publication.

### Task 6: Publish `main`, rename the repository, and set the branch policy

**Files:** GitHub repository settings and local Git remote.

- [x] Verify the current remote `main` is an ancestor of the finished local `main`, then push normally:

```powershell
git merge-base --is-ancestor origin/main main
if ($LASTEXITCODE -ne 0) { throw 'Remote main diverged; stop before push.' }
git push origin main
```

- [x] Verify the remote commit and root listing before changing repository settings.
- [x] Confirm `godforg1veme/Jarvis` is available, then rename the existing repository while preserving history.
- [x] Set the humanized About description and accurate topics: `ai-assistant`, `personal-assistant`, `telegram-bot`, `electron`, `windows`.
- [x] Enable GitHub's delete-branch-on-merge setting. Keep `main` as default and do not introduce another permanent branch.
- [x] Change local `origin` to `https://github.com/godforg1veme/Jarvis.git` and verify `git ls-remote origin refs/heads/main` matches the published commit.

### Task 7: Remove only verified stale branch references

**Files:** GitHub refs, local refs, worktree metadata, and stashes.

- [x] Re-fetch branches and recheck open PRs after the rename. All reviewed topic tips were ancestors of published `main` and no open PR depended on them.
- [x] Remove the five reviewed remote topic branches after proving their contents were in `main`.
- [x] Check task usage for non-main worktrees; remove only clean, inactive worktrees.
- [x] Remove stale local topic and backup refs and the temporary consolidation branch after worktrees were removed.
- [x] Drop the two audited stashes after comparing their contents with the published tree.
- [x] Verify the only remote branch is `main`, no stale topic branch remains locally, and no abandoned worktree remains.

### Task 8: Rebuild the canonical local project folder

**Files:** `F:\test\jarvis` and the old wrapper repository at `F:\test`.

- [x] Record resolved absolute paths and sizes for ignored `.env`, `data/`, `models/`, `voices/`, required `build/` assets, deployment secrets, and local backups without printing their contents.
- [x] Clone the published repository to a staging sibling and verify its `main` commit before updating `F:\test\jarvis`.
- [x] A directory move was blocked by an open Windows handle, so the verified clone was copied into the exact path `F:\test\jarvis` without mirroring or deleting ignored user state.
- [x] Restore ignored runtime assets after confirming the root `.gitignore` excludes them. A clean `npm ci` attempt failed in transitive `ffi-napi`/libffi build; the existing exact-lock dependency tree was retained and the Windows installer build succeeded.
- [x] Run `git status --short --branch`, `git ls-files`, README/AGENTS path checks, and relevant smoke tests from `F:\test\jarvis`.
- [x] Confirm `.env`, user data, model/voice assets, and local backups remain present and untracked. The duplicate source files were removed after verification; the parent `.git` metadata remains because the local execution policy rejected its deletion.

### Task 9: Update origin URLs and close the local workspace cleanup

**Files:** `jarvis-vps` Git config, `jarvis-vps-new` Git config, old outer checkout metadata.

- [x] On each VPS, update only the `origin` URL to the renamed repository; do not reset, clean, or pull over the dirty production checkout.
- [ ] Remove the parent `F:\test\.git` metadata after verifying there are no local-only commits or worktrees. The deletion was rejected by local execution policy; do not use `F:\test` as the active project root while that metadata remains.
- [x] Verify GitHub, local `F:\test\jarvis`, and both VPS remotes all name the same repository and point to the intended `main` history.
