# Desktop EXE update reminder design

Date: 2026-09-12

## Goal

Keep the installed Windows application visibly synchronized with Desktop code
changes. After an update that affects the Windows client, the coding agent must
check whether the installed EXE is older than the current sources and offer to
build and install an up-to-date EXE.

## Documentation structure

- `AGENTS.md` contains the complete authoritative rule.
- `CLAUDE.md` and `gemini.md` point agents to that rule without creating a
  second source of truth.
- `README.md`, `docs/README.md`, and `deploy/README.md` contain concise
  operational reminders.
- Historical specifications, plans, and update records remain unchanged.

## Required behavior

After changing Windows-client code, the agent checks whether the installed
Jarvis Desktop EXE matches the current sources. If it does not, the final answer
offers to run `npm run dist:win` and install the resulting current EXE. Building
or installing is not automatic and still requires a user request.

Documentation-only, server-only, and deployment-only updates do not trigger the
offer unless they also change the Windows client or its packaged resources.

## Verification

- The full rule appears once in `AGENTS.md`.
- Every current instruction/documentation entry point references the rule or
  carries the concise reminder.
- No file under `docs/superpowers/plans/`, existing historical specifications,
  or `docs/updates/` is modified.
