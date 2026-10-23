# Automatic job model implementation plan

**Goal:** Remove all manual job-model selection and route letters automatically.
**Spec:** [Approved scope](../specs/2026-10-22-jobs-automatic-model-design.md).
**Architecture:** Reuse the existing persistent FreeFirstProvider in JobModelAdapter;
remove preference/config paths and migrate legacy settings. CommonJS, PostgreSQL,
existing Telegram scope and final application confirmation remain.

- [x] Remove model from settings controls, legacy input and guided field allowlist.
- [x] Remove model schema/default/config/runtime paths; route through existing queue.
- [x] Add forward-only cleanup preserving filters and collection progress.
- [x] Add automatic free/paid routing and usage tests using a fake provider transport.
- [x] Verify full server unit suite and focused PostgreSQL panel/draft/migration cases.
- [x] Independently review complete removal, stale paths and accounting invariants.
- [x] Update bilingual current docs and report local status separately from deployment.
