# Jarvis documentation map

This file is the status authority for project documentation. Specifications and
plans under `docs/superpowers/` are preserved as decision history; their old
future-tense wording does not override the current architecture in `AGENTS.md`.

Status snapshot: 2026-09-02.

Operations update, 2026-09-06: see
`updates/2026-09-06-operations-verification.md` for the corrective rollout,
verified checks, and the owner's decision to defer backups. The earlier
2026-09-04 rollout overestimated readiness and is superseded for Operations
acceptance by this record.

## Product position

Jarvis is a hybrid personal/family AI-assistant platform: an always-on cloud
control plane provides identity, Telegram access, persistent user-scoped data,
and model routing; Windows clients provide local voice and bounded device
execution. Telegram is the first client. PWA, camera/vision, and production
acceptance of multi-device control remain roadmap work unless explicitly marked
implemented below. The Telegram-first private knowledge base accepts bounded
attachments, indexes supported text formats with PostgreSQL full-text search,
extracts PDF text with page metadata, keeps unsupported files searchable by
metadata, and uses production hybrid embeddings retrieval with FTS fallback.
The server ASR interface is implemented, but a concrete ASR provider remains
deliberately disabled until the DE-4 benchmark selects one.

## Authoritative current documents

| Document | Purpose |
| --- | --- |
| `README.md` | Product overview, current capabilities, architecture, setup |
| `AGENTS.md` | Authoritative runtime, safety, code, and verification rules |
| `deploy/README.md` | Current Ubuntu 24.04 and Cloudflare Tunnel operations |
| `updates/2026-09-01-cloud-desktop-memory-rollout.md` | Итог текущего развёртывания Desktop, памяти, устройств и известных ограничений |
| `CLAUDE.md`, `gemini.md` | Thin pointers to the authoritative agent context |
| This file | Status and supersession index |

## Active cloud specifications

| Document | Status |
| --- | --- |
| `specs/2026-09-01-jarvis-family-cloud-assistant-design.md` | Partially implemented: control plane, DB, Telegram/Desktop text, provider gateway, safe text fallback, prompt pipeline, user-scoped memory, Telegram-first attachment ingestion, production hybrid knowledge retrieval, and the confirmed remote-command path are implemented and tested. Server ASR, PWA/vision and live multi-device acceptance remain operational work. |
| `plans/2026-09-01-jarvis-family-cloud-assistant.md` | Active roadmap; Milestones 0–3 are partial, later milestones are not complete |
| `specs/2026-09-01-jarvis-desktop-cloud-client-design.md` | Implemented and packaged: paired Windows chat, DPAPI device credentials, device-scoped HTTPS/WSS sessions, local wake word, server ASR contract, and NSIS installer. Live VPS configuration and clean-machine acceptance remain operational steps. |
| `specs/2026-09-01-jarvis-system-instruction-design.md` | Implemented and verified for the current Telegram/OpenRouter path |
| `plans/2026-09-01-jarvis-system-instruction.md` | Implemented and verified; retained as execution history |
| `specs/2026-09-02-desktop-natural-tool-orchestrator-design.md` | Implemented in the first Desktop vertical slice; live paired-device acceptance remains |
| `specs/2026-09-02-action-orchestrator-platform-foundation-design.md` | Platform foundation implemented for device executors; server workers, schedules and account connectors remain future modules |
| `plans/2026-09-02-action-orchestrator-foundation.md` | Implemented and deployed to the VPS; final installed-Desktop acceptance is tracked separately |

The cloud design originally selected Ubuntu 22.04 and direct Caddy ingress.
Production reality supersedes those deployment details: the current VPS is
Ubuntu 24.04, Xray owns port 443, and Jarvis uses Cloudflare Tunnel. The exact
OpenRouter model is configuration and may be replaced without changing Jarvis
identity.

The current Tunnel hostname `jarvis.rilora.ru` and `/health/ready` were verified
on 2026-09-02. The assistant receives only owner-scoped device context; direct
attachment questions are answered by the server rather than delegated to a
model.

## Implemented Windows specifications

These records describe shipped or substantially implemented local subsystems:

| Document family | Status |
| --- | --- |
| `2026-06-17-jarvis-assistant-console-b2*` | Implemented and visually verified |
| `2026-06-18-jarvis-file-commands*` | Implemented and verified |
| `2026-06-18-jarvis-desktop-agent*` | Core v1 implemented; Browser Agent remains out of scope |
| `2026-08-23-jarvis-unified-intent-routing*` | Implemented and verified for the local client |
| `2026-08-25-jarvis-unknown-app-recovery*` | Implemented and verified |
| `2026-08-31-jarvis-stt-audio-transport-optimization-design.md` | Binary transport/performance work implemented in the local runtime |
| `2026-08-31-jarvis-windows-autostart-fix-design.md` | Historical targeted design; verify current machine state before applying operational steps |

## Newly verified local subsystems

| Document family | Status |
| --- | --- |
| `2026-08-31-jarvis-everything-file-search*` | Implemented; focused Everything, file-command, and Tool Gateway tests pass |
| `2026-08-31-everything-output-encoding*` | Implemented; UTF-8/CP866/Windows-1251 decoding tests pass |
| `2026-08-31-jarvis-voice-lab*` | Implemented; controller, settings, profiles, advisor, monitor, and renderer contract tests pass; live microphone UX remains a manual check |
| `2026-08-31-voice-false-trigger-filter-design.md` | Implemented; Faster Whisper quality-filter test passes |
| `2026-09-02` semantic knowledge and action-orchestrator rollout | Server tests cover embedding ingestion/query fallback, RRF ranking, strict tool planning, persisted workflows, source-client confirmations, WSS dispatch/continuation, opaque local candidates, Tool Gateway execution, audit/expiry, owner scoping, Desktop replay protection, and seeded varied-name scenarios. Migration 006 and the control plane are deployed. Production OpenRouter embeddings were verified with a real Telegram document and semantic-only query; Desktop execution and Telegram-origin rejection were also verified live. Multi-device acceptance remains pending. |

The commit messages and test report remain the source of truth for exact
verification commands and environment-only limitations.

## Superseded positioning

`specs/2026-08-24-jarvis-portfolio-documentation-design.md` is superseded as a
product-positioning document. It described Jarvis primarily as a public local
Electron portfolio project. It remains useful as historical documentation
design, but new material must use the hybrid cloud/local positioning above.

## Rules for future agents

1. Read `AGENTS.md` before acting.
2. Use this index to distinguish implemented capability from roadmap intent.
3. Preserve historical specs/plans; add status or supersession notes instead of
   silently rewriting past decisions.
4. Update `README.md`, `AGENTS.md`, `deploy/README.md`, and this index together
   when runtime ownership or deployment reality changes.
5. Never infer that a database table, protocol schema, Compose profile, or plan
   means the full user-facing feature is already operational.
