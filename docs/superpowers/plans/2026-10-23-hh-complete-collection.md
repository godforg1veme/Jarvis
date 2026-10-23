# HH complete collection implementation plan

**Goal:** All permitted users receive complete, resumable HH collection and safe CAPTCHA handover; recover Senya's backlog without duplicates.

**Spec:** [Approved design](../specs/2026-10-23-hh-complete-collection-design.md).

**Architecture:** Keep scoped repositories/outbox and durable progress. Add verified Moscow calendar windows and bounded collector slices; preserve current confirmation and unknown protections. No production dependency additions.

### 1. Browser collection contract

- [ ] Write failing tests for cropped pager/next-link bounds, capped metadata, wrong-page redirect and dotted calendar ranges.
- [ ] Update hhBrowser/reader and browser client capabilities; admit legacy and new strictly bound CAPTCHA target shapes.
- [ ] Verify real Chromium fixtures, date boundary conversion and legacy CAPTCHA compatibility.

### 2. Shared collector and access

- [ ] Add tests for Moscow-day splitting, single-day saturation, retained legacy progress, independent windows, bounded yields, 404 and exact checkpoint.
- [ ] Implement collector continuation with unchanged access/lease/revision/dedup boundaries.
- [ ] Align CAPTCHA active user selection with collector eligibility, testing owner/admin/member and revoked/foreign/paused scopes using PostgreSQL.

### 3. Notification and recovery

- [ ] Add one scoped, deduplicated incomplete-collection notice through the existing attention outbox and job:menu.
- [ ] Test message safety, unknown delivery, current access checks and no duplicates.
- [ ] Prepare a read-only status and idempotent scheduling path for Senya's retained backlog; never clear deliveries or progress to force a retry.

### 4. Acceptance and release

- [ ] Independently review ready diff and fix confirmed findings.
- [ ] Run full server/browser, required Telegram gate and isolated PostgreSQL/Chromium integration; record evidence and limitations in Russian/English docs.
- [ ] Re-audit branches/worktrees/PRs, merge current origin/main safely, source guard, publish approved main and immediately synchronize both VPS.
- [ ] Build/install only changed server/collector/browser preserving environment/profile/mounts; verify health and actual active-user outcomes.
- [ ] Resume Senya's existing search through retained progress, monitor new matching/delivery counters and remaining windows; report exact complete/partial result.
