# Telegram Button Architecture Adoption Plan

> **For agentic workers:** Implement inline in this task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved Telegram button architecture discoverable, enforceable in repository checks, and verifiable without changing the shipped menu.

**Architecture:** Keep the current menu layout and callback grammar in `docs/telegram-menu-contract.md`; put stable routing, authorization, failure, and change-control rules in `docs/telegram-button-architecture.md`. A small dependency-free Node check validates document links, required sections, and the exact persistent keyboard against source; existing Telegram tests cover runtime behavior.

**Tech Stack:** Node.js 20+ CommonJS, built-in `node:test`, PostgreSQL-backed Telegram server, Markdown.

**Spec:** `docs/superpowers/specs/2026-09-23-telegram-button-architecture-design.md`.

## Global Constraints

- Do not change any menu label, row, visibility, callback grammar, route, or confirmation boundary without explicit approval in this task.
- Do not add production dependencies or expose Telegram content, tokens, credentials, or callback payloads in diagnostics.
- Preserve owner/user/conversation/chat scope, closed callback grammar, update deduplication, and origin-bound confirmation.
- Work in the isolated Telegram worktree and preserve the concurrent Supervisor changes in the main checkout and VPS.

---

### Task 1: Adopt the architecture and menu documents

**Files:** Create `docs/telegram-button-architecture.md` and `docs/telegram-menu-contract.md`; modify `AGENTS.md` and `docs/README.md`.

- [x] Compare the current menu source and live Supervisor state to the existing untracked menu contract before adopting it; correct any source drift without changing runtime behavior.
- [x] Write the architecture guide from the approved spec with explicit inbound, callback, guided-input, authority, delivery, failure, and agent change-control boundaries.
- [x] Add reciprocal links and ownership rules to the menu contract, `AGENTS.md`, and documentation index.
- [x] Review all changed Markdown for unintended claims about deployed state, then commit this documentation unit.

### Task 2: Make drift detectable

**Files:** Create `server/test/telegramArchitectureContract.test.js`; possibly modify `server/package.json` only if the existing test command does not discover the new test.

- [x] Write a Node test that asserts exact owner/member keyboard rows against the documented current contract.
- [x] Add tests for architecture/menu reciprocal links and the mandatory AGENTS entry.
- [x] Run the focused test to a pass without loosening the asserted menu layout.
- [x] Run the documented focused Telegram suite and commit the test unit.

### Task 3: End-to-end verification and rollout decision

**Files:** Create `docs/updates/2026-09-23-telegram-dialogue-acceptance.md`; update `docs/README.md` status only after evidence.

- [x] Run focused Telegram tests, full `server/npm test`, and targeted security cases: denied identity, foreign scope, replay, stale confirmation, voice failure, fallback delivery, and no secret-bearing diagnostics.
- [x] Verify live owner text and voice metadata already observed on 2026-09-23 and check fresh production health, migrations, closed outcomes, and both VPS units without printing private content.
- [ ] Compare production source and the current Supervisor rollout before deciding whether a server deploy is needed; never overwrite newer Supervisor changes with a stale branch image.
- [ ] If a safe deploy is needed, use deployment preflight, Compose health, public readiness/smoke, and a real owner test; otherwise document precisely what remains undeployed.
- [ ] Give the owner a short ordered Telegram tap-through checklist; mark every item as automated, production-observed, or still requiring a real client.
