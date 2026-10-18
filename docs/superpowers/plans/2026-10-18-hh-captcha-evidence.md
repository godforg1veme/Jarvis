# HH CAPTCHA evidence implementation plan

**Goal:** preserve private image/answer evidence and explain early handover.
**Architecture:** bounded owner-scoped file store, automatic coordinator hooks,
closed browser receipt metadata and local-only export CLI.
**Tech Stack:** existing CommonJS Node.js and Linux private profile volume.
**Spec:** ../specs/2026-10-18-hh-captcha-evidence-design.md

Execute sequentially in this task; no delegation is needed.

- [ ] Add secure bounded atomic store and local export; test scope, retention,
  symlinks, permissions, oversized files and round-trip image/answer.
- [ ] Persist image before OCR and answer before submit; record outcomes and
  closed HTTP/receipt/verifier metadata. Preserve unknown and three-attempt rules.
- [ ] Test write failures before/after submit, restart evidence and actual browser
  fixtures; run browser, Telegram contract and server gates.
- [ ] Document both languages, inspect diff and release only within authorization;
  verify Linux image, private volume, source parity and service health.
