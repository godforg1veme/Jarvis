# Telegram Life OS Functional Parity Design

**Date:** 2026-09-15

**Status:** Implemented and production-deployed on 2026-09-15; real Telegram client acceptance remains manual

## Objective

Expose the implemented Jarvis Life OS v2 capabilities through a complete,
button-driven Telegram interface. Telegram must remain a native bot experience:
hierarchical inline keyboards, paginated lists, and PostgreSQL-backed guided
text input. It must not open a Web App or duplicate the Desktop renderer.

This work extends the existing persistent `🎯 Life OS` entry. It does not
replace ordinary conversation, legacy commands, Desktop Mission Control, or any
existing Telegram section.

## Product behavior

The Life OS home screen shows a bounded operational summary and links to:

- Mission;
- Timeline;
- Projects;
- Commitments;
- Proposals;
- Reminders;
- People and relationships;
- Life mode;
- Preferences;
- Sources;
- Context Recovery.

Every screen provides a route back to its parent and to Life OS home. Lists use
bounded pagination. Empty, unavailable, expired, conflict, and stale states
return useful text and safe navigation instead of a dead callback.

### Mission

Show the selected mission, its explainable factors, status, next step, and
relevant device state. Allow the user to pin, replace, temporarily hide, or
restore a mission using revision-aware operations. Replacing a mission starts
with a bounded project list.

### Timeline

Show bounded event pages in reverse chronological order. Event details expose
only public DTO fields. The user may hide an event or mark an inferred project
link as incorrect through the existing feedback boundary.

### Projects and Context Recovery

List and inspect projects, including current context, open commitments,
proposals, documents, people, and continuation point. Project creation and
editing use guided text input with strict schemas. Recovery remains two-stage:
preview a plan, then explicitly propose its declared action. Any changing
execution continues through the existing origin-bound Action Orchestrator and
Tool Gateway path.

### Commitments, proposals, and reminders

Commitments can be inspected, completed, dismissed, or rescheduled through
revision-aware operations. Proposals can be confirmed or dismissed only when
their stored origin is Telegram and their conversation matches the current
conversation. Reminders can be listed, created, rescheduled, paused, resumed,
completed, or cancelled using the existing service contracts. Changing actions
retain a separate confirmation step.

### People, relationships, and family access

Allow owner-scoped listing, creation, and editing of people; relationship and
project-link management; and explicit family grant management. Telegram never
creates global shared memory. Member-visible data comes only from an active,
exact grant and uses bounded summary DTOs.

### Modes and preferences

Expose all nine Life modes: Work, Focus, Home, Family, Meeting, Travel, Rest,
Sleep, and Emergency. Manual selection uses the current revision and cannot
weaken privacy or confirmation policy. Preferences can be inspected, set from
closed allowed values, reset to derived behavior, or deleted. No free-form
preference key is accepted from callback data.

### Sources

List the eight provider-neutral source types and their connection state. Allow
creation, enable/disable, bounded scope changes, and manual sync only through
the existing adapter/service contracts. Telegram must not request or display
provider credentials, tokens, cursors, raw payloads, or unsupported live status.

## Architecture

Create a focused `TelegramLifeOsService` under `server/src/telegram/`. It owns
Life OS rendering, callback routing, pagination, and guided-flow completion.
`TelegramMenuService` delegates `life:*` callbacks and its `life` menu action to
this service. `MessageService` keeps authentication, update deduplication,
conversation ownership, legacy command compatibility, and final message
persistence.

The runtime injects existing Life OS repositories and services into the new
Telegram adapter. Business mutations stay in their current domain services;
the Telegram adapter does not reproduce SQL or bypass revision checks.

Guided input continues through `TelegramInteractionRepository`. Interaction
records contain only a closed flow kind, owner/conversation/chat scope, bounded
public IDs, expected revision, and non-secret partial values. Each mutation
consumes its interaction atomically before execution when replay could cause a
duplicate action.

## Callback contract

All callbacks remain below Telegram's 64-byte limit and pass the central
allowlist in `telegram/bot.js`. The grammar uses closed actions:

```text
life:home
life:<section>:p:<page>
life:<section>:view:<uuid>
life:<section>:<closed-action>:<uuid>
life:mode:set:<closed-mode>:<revision>
life:pref:<closed-key-code>:<closed-action>
life:flow:cancel:<uuid>
```

Long preference keys map to fixed short codes in server code. Callback data
never contains names, summaries, local paths, frozen action arguments, owner
IDs, credentials, storage keys, provider cursors, or arbitrary commands.

The existing `life:confirm:<uuid>` and `life:dismiss:<uuid>` callbacks remain
accepted for backward compatibility. Legacy `/life`, `/life_confirm`, and
`/life_dismiss` commands delegate to the same service behavior.

## Security and failure handling

- Resolve the authenticated user and Telegram conversation before callback
  routing.
- Scope every repository/service call by `userId`; scope origin-bound proposal
  confirmation by the current Telegram conversation.
- Keep owner-only mutations and family grants authorization-checked in the
  domain service, not inferred from button visibility.
- Never persist callback labels as authority.
- Never execute a changing action directly from a navigation callback.
- Treat missing, expired, stale-revision, or cross-owner objects as unavailable.
- Return generic public errors without SQL, filesystem, provider, or secret
  details.
- Preserve update deduplication and interaction replay protection.
- Keep Life OS-disabled behavior non-breaking.

## Testing and acceptance

Add an automated button-coverage test that recursively renders every Life OS
screen and verifies that each emitted callback:

1. matches the central Telegram callback allowlist;
2. has a real handler;
3. stays within 64 UTF-8 bytes;
4. returns a non-empty answer or starts a valid guided flow;
5. preserves parent/home navigation;
6. cannot cross owner or conversation scope;
7. preserves revision conflicts and origin-bound confirmation;
8. does not leak forbidden fields.

Add focused tests for every section, guided-flow validation, empty/error/stale
states, pagination boundaries, replay/deduplication, and role differences. Run
Telegram menu, message, callback, Life OS service/repository, full server, and
public deployment regressions. Perform a production read-only menu acceptance;
do not trigger real changing actions or connect external accounts during an
automated deployment check.

## Documentation and rollout

After verification, update `AGENTS.md`, `CLAUDE.md`, `gemini.md`, `README.md`,
`docs/README.md`, deployment documentation, and a dated verification record.
`AGENTS.md` remains authoritative; the provider-specific MD files must point to
it and summarize the newly verified Telegram surface without defining a second
architecture.

This is a server-only change unless Desktop/shared client contracts are changed.
Build and install a new Desktop EXE only if package inputs actually change.
Production deployment requires the already granted user request, preflight,
candidate tests, healthy server replacement, public smoke, and confirmation
that Xray, Hysteria2, PostgreSQL, GigaAM, Cloudflare, and Host Agent remain
healthy or active.

## Completion criteria

- Every implemented Life OS v2 section is reachable and operable through the
  Telegram button hierarchy.
- No emitted button is unhandled, invalid, oversized, or authorized only by its
  visibility.
- Full button coverage and owner/origin/replay tests pass.
- Existing Telegram, Desktop, Voice, Vision, VPN, Operations, and family
  behavior remains intact.
- Documentation distinguishes implemented, automatically verified, deployed,
  and still-manual external acceptance.
