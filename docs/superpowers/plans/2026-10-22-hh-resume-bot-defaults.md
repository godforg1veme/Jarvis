# HH Resume Bot Defaults Implementation Plan

**Goal:** default free raising and an equivalent scoped Telegram resume selector.

**Architecture:** reuse JobResumeService and its durable operations. Add a small
Telegram adapter with expiring scoped catalog/confirmation snapshots. Store
explicit preference separately from one-time default policy application.

**Tech Stack:** CommonJS/Fastify, PostgreSQL, native ESM Mini App, node:test.

**Spec:** [design](../specs/2026-10-22-hh-resume-bot-defaults-design.md).

## Constraints

No new production dependencies, paid HH action, profile sharing or unknown replay.
Callbacks <=64 bytes. Current jobs, private scope, revisions, expiry and one-time
confirmation remain mandatory. Development is local until release authorization.

## Tasks

- [x] Default policy: migration042, repository/current, settings explicit preference,
  refresh/worker initialization; PG tests for default/off/unknown/cooldown.
- [x] Telegram adapter: migration043 confirmation kind, strict parser, menu/preview,
  origin-bound consume and original-ID reconciliation, runtime wiring/home button.
- [x] Acceptance: real TelegramMessageService/MenuService, member isolation,
  expiry, cancellation, stale revisions, duplicate and uncertain settings.
- [x] Integration: existing PG tests, Telegram gate, server suite, Mini App build
  and UI fixture; update RU/EN product/status/development notes and menu contract.
- [x] Independent review and correction of confirmed defects where available.
- [ ] Report verified local state and propose the concrete release if needed.
