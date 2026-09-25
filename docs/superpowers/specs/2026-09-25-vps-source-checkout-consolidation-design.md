# VPS source checkout consolidation

Date: 2026-09-25

Status: approved; implementation in progress.

## Context

GitHub and the Windows workspace now use the flattened Jarvis repository with
`main` as the only shared branch. The Windows checkout is clean at
`e35b295ac1fc802db13952dab42052eb4910eeac`.

Both VPS paths `/home/deploy/apps/jarvis` still have an older Git commit from
2026-09-16 whose tracked application files are nested under `jarvis/`. Newer
root-level source copies are untracked and do not match consistently between
the two hosts. Their cached `origin/main` refs are also stale. The old root
directory contains operational files that must be preserved, including
environment configuration, deployment backups and staging files, and a
pending-operation marker.

Comparing the old tracked tree with current `main` after removing the legacy
`jarvis/` prefix found 822 shared paths: 741 blobs are identical and 81 differ;
current `main` has 70 additional paths. Selected root-level Telegram source
files also differ between the VPSs, and migration 028 is missing from both
untracked root-level source copies. The active server release is separate from
these mixed working directories.

The primary VPS runs the Jarvis Server from a separate immutable release
directory. Its running Compose services still refer to
`/home/deploy/apps/jarvis/deploy/docker-compose.yml` and its environment file.
The second VPS runs the installed Host Agent, Xray, Hysteria2, and cross-node
probe units; it has no Compose application containers. The source tree is used
as deployment material, so it must be complete and canonical before future
Host Agent changes are staged.

## Goal

Make the Git source tree at `/home/deploy/apps/jarvis` a clean checkout of the
same GitHub `main` on both VPSs, preserve operational state and existing service
paths, and add checks that prevent deployments from nested, stale, dirty, or
wrong-remote checkouts.

## Design

1. Use the latest observed GitHub `main` SHA as the promotion target. Resolve it
   again immediately before each VPS promotion. If `main` moves during the
   rollout, stop and restart verification against the new SHA rather than
   mixing revisions.
2. Prepare a fresh, single-branch clone in a sibling staging directory on each
   VPS. Do not run `reset`, `clean`, or checkout operations inside the existing
   mixed tree.
3. Inventory operational and generated files by path, size, permissions, and
   checksum without printing their contents. Preserve them outside tracked
   source or restore them to their required ignored paths. This includes
   `.env`, `.backups`, `.deploy-backups`, deployment staging artifacts,
   `pendingCommandId`, local data, and user data. Keep file ownership and
   restrictive permissions. Do not copy secrets into Git or logs.
4. Keep the canonical application path and Compose paths stable. On the primary
   VPS, render the current and staged Compose configurations and compare them
   without displaying resolved secrets. If service definitions, mounts,
   environment-file paths, or other runtime settings differ unexpectedly,
   do not switch the checkout or recreate containers; report the difference
   first. No database, VPN, Host Agent, or application service restart is part
   of source-tree normalization.
5. Promote the staged checkout to `/home/deploy/apps/jarvis` only after the
   state inventory and path checks pass. Retain a clearly named, access-limited
   rollback copy of operational state until post-promotion verification passes;
   do not retain an extra Git checkout as a second development base.
6. Verify both checkouts resolve to the same expected SHA, have `main` as their
   only local branch, have no stale remote-tracking branches after pruning
   against GitHub, have no nested `jarvis/` source tree, and show a clean
   `git status --short`. Confirm required Compose paths on the primary VPS and
   installed Host Agent/Xray/Hysteria2/probe health on both nodes. Check the
   public readiness endpoint after the operation.

## Future drift prevention

Update `AGENTS.md` and `deploy/README.md` to name the canonical Windows and VPS
paths and state that VPS deployment source must come from the flattened GitHub
repository. Add a deployment preflight that verifies the canonical remote,
`main` for source staging, a clean source worktree, and the absence of a nested
`jarvis/` project directory. For an immutable release directory, allow only an
explicitly recorded commit that is reachable from GitHub `main`. The preflight
prints the selected source SHA and fails before any deployment action when a
check does not pass.

## Failure and rollback behavior

- Any failed state inventory, permission check, checksum check, Compose
  comparison, source-SHA check, or service precheck stops the promotion before
  the existing checkout is moved.
- If post-promotion source checks fail, restore the prior checkout from the
  local rollback copy without changing database or VPN state.
- Do not retry uncertain service mutations under a new operation identifier.
- Do not remove existing backups, database files, environment files, VPN
  credentials, or pending-operation markers as part of this work.

## Out of scope

- Changing Telegram, VPN, database, or other application behavior.
- Fixing the separately reported file-intent test or dependency advisories.
- Rotating VPN keys, changing systemd timer state, or changing Compose service
  configuration.
- Removing the active release or existing rollback artifacts.

## Acceptance criteria

- GitHub `main`, the Windows checkout, and both VPS source checkouts report the
  same recorded source SHA after promotion.
- Each VPS source checkout has a clean status and no nested project copy.
- Each VPS has only local `main` and only the live `origin/main` remote-tracking
  ref after pruning stale refs.
- Environment files, backups, staging state, and pending-operation markers are
  preserved and their contents remain private.
- The primary VPS Compose configuration resolves to the same runtime settings
  as before promotion; no service was recreated for checkout normalization.
- Both Host Agent services and VPN stacks remain healthy, and the public
  readiness check passes.
- Future deployment preflight rejects dirty, stale, wrong-remote, and nested
  source checkouts before making changes.
