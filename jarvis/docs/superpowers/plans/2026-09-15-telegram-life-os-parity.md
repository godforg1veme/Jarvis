# Telegram Life OS Functional Parity Implementation Plan

**Date:** 2026-09-15

**Design:** `docs/superpowers/specs/2026-09-15-telegram-life-os-parity-design.md`

**Status:** Completed and production-deployed on 2026-09-15; retained as execution history

## Goal

Turn the existing `🎯 Life OS` Telegram entry into a complete hierarchical,
button-driven adapter over the implemented Life OS v2 services while preserving
owner scope, origin confirmation, callback bounds, and ordinary bot behavior.

## Checkpoint 1 — Telegram adapter boundary

- Add `server/src/telegram/telegramLifeOsService.js`.
- Move Life OS rendering and callback handling out of `TelegramMenuService`.
- Define closed callback parsing, pagination, navigation, formatting, and public
  error handling.
- Expand the central callback allowlist without accepting arbitrary actions.
- Add callback length/coverage unit tests.

Verification: Telegram Life service, menu, bot callback tests.

## Checkpoint 2 — Read-only parity

- Implement Life home, Mission, Timeline, Projects, Commitments, Proposals,
  Reminders, People, Mode, Preferences, Sources, and Recovery screens.
- Add bounded pages and object details.
- Guarantee parent and Life-home navigation for every rendered state.
- Preserve public DTOs and exclude frozen arguments and private fields.

Verification: recursive button walk, owner isolation, empty/error/pagination
tests, message-service regressions.

## Checkpoint 3 — Guided mutations

- Add PostgreSQL-backed interaction kinds for project/person creation and edit,
  commitment reschedule, reminder creation/reschedule, preference changes,
  source creation/scope changes, relationships, project links, and family
  grants.
- Add revision-aware direct buttons for mission state, commitment lifecycle,
  reminders, modes, preferences, sources, feedback, and recovery proposal.
- Atomically consume replay-sensitive guided flows.
- Route proposal and recovery changing actions through existing origin-bound
  services only.

Verification: validation, revision conflict, replay, origin conversation,
cross-owner, and changing-action tests.

## Checkpoint 4 — Runtime and compatibility

- Inject existing Life repositories/services into the Telegram adapter.
- Delegate legacy `/life`, `/life_confirm`, and `/life_dismiss` behavior to the
  same implementation where practical.
- Keep Life-disabled, member-role, VPN, Operations, memory, documents, devices,
  voice, and ordinary conversation behavior unchanged.

Verification: full Telegram tests, Life OS tests, full server suite, adjacent
Desktop/Voice/Vision/Tool Gateway/remote protocol regressions.

## Checkpoint 5 — Production acceptance and documentation

- Run preflight and candidate tests.
- Deploy only the server after successful verification.
- Run public smoke and a read-only production Telegram-menu contract probe.
- Verify PostgreSQL remains private and Xray, Hysteria2, GigaAM, Cloudflare,
  Host Agent, and Operations remain healthy/active.
- Update `AGENTS.md`, `CLAUDE.md`, `gemini.md`, `README.md`, `docs/README.md`,
  deployment documentation, and a dated verification record.
- Commit and push all final changes; verify clean tree and 0/0 upstream state.

No Desktop EXE rebuild is required unless a packaged client file changes.
