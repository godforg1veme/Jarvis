# Jarvis documentation map

This file is the status authority for project documentation. Specifications and
plans under `docs/superpowers/` are preserved as decision history; their old
future-tense wording does not override the current architecture in `AGENTS.md`.

Status snapshot: 2026-09-14.

App resolution & AI recovery update, 2026-09-14: Start Menu indexing was fixed
to use UTF-8 encoded PowerShell invocations, Cyrillic inflection stemming was added
to appResolver, and AI-assisted candidate recovery via AppRecoveryService was wired
into ToolGateway for local and remote command execution.

Life OS update, 2026-09-13: Core v1 is implemented and production-enabled across
the Event Spine, projections, explainable proposals, context recovery,
authenticated API, Telegram commands, and responsive Desktop Mission Control.
Migration 013, an isolated real-PostgreSQL acceptance, VPS health/smoke, the
installed Desktop package, and paired WSS reconnect were verified. Deterministic
proactivity is enabled; optional model enrichment remains disabled. Details are
recorded in `updates/2026-09-13-life-os-core-v1.md`.

Happ VPN update, 2026-09-13: dedicated VLESS + REALITY + XTLS Vision Xray is
deployed on port 443, externally accepted through the production client URI,
and monitored by Operations. Owner-only Telegram/Desktop commands use
origin-bound confirmation and one-time credential delivery. See
`updates/2026-09-13-happ-vpn-rollout.md`.

Hysteria2 fallback update, 2026-09-14: the isolated service is production-active
on `87.120.187.109:443/udp` behind the DNS-only `vpn.rilora.ru` hostname.
Strict ACME TLS, authenticated proxy traffic to YouTube, independent Xray
health, Host Agent operations, Telegram profile delivery, Compose health, and
the public smoke test were verified. Real iPhone Wi-Fi/LTE acceptance remains.
See `updates/2026-09-14-hysteria2-fallback-rollout.md`.

Operations update, 2026-09-06: see
`updates/2026-09-06-operations-verification.md` for the corrective rollout,
verified checks, and the owner's decision to defer backups. The earlier
2026-09-04 rollout overestimated readiness and is superseded for Operations
acceptance by this record.

## Product position

Jarvis is a hybrid personal/family AI-assistant platform: an always-on cloud
control plane provides identity, Telegram access, persistent user-scoped data,
and model routing; Windows clients provide local voice, a procedural 3D
holographic avatar («Quantum Core 2.0»), a floating desktop companion widget,
and bounded device execution. Telegram is the first client. PWA and production
acceptance of multi-device control remain roadmap work. The first Vision vertical
slice is implemented but not yet deployed: local explicit camera/screen leases,
two-display composition, provider-neutral analysis, encrypted owner-scoped visual
memory, and remote observation through an already active lease. Live Camo capture
at 1280x720 was accepted on 2026-09-09; deployed-provider acceptance is still
pending. The Telegram-first private knowledge base accepts bounded
attachments, indexes supported text formats with PostgreSQL full-text search,
extracts PDF text with page metadata, keeps unsupported files searchable by
metadata, and uses production hybrid embeddings retrieval with FTS fallback.
The server ASR interface is deployed with a private Russian-only GigaAM
`v3_e2e_rnnt` ONNX worker on DE-4. Allowlisted Telegram `voice` notes are
bounded, transcribed through that private worker, and saved only as
`voice_transcript`; a deployed synthetic OGG service-to-worker contract is
accepted. Real inbound owner Telegram voice and paired-Desktop client
acceptance remain manual checks. Telegram `audio` and other media remain
attachment ingestion.

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
| `specs/2026-09-01-jarvis-family-cloud-assistant-design.md` | Partially implemented: control plane, DB, Telegram/Desktop text, provider gateway, safe text fallback, prompt pipeline, user-scoped memory, Telegram-first attachment ingestion plus voice-note transcription, production hybrid knowledge retrieval, the confirmed remote-command path, and the first Vision vertical slice are implemented and tested. Live Camo was accepted on 2026-09-09. PWA, deployment of Vision, and live multi-device acceptance remain operational work. |
| `superpowers/specs/2026-09-09-jarvis-vision-design.md` | Implemented first vertical slice with accepted live Camo and dual-display capture; see `updates/2026-09-09-vision-implementation.md` for verified boundaries and remaining provider/Telegram acceptance |
| `superpowers/specs/2026-09-10-gigaam-v3-e2e-rnnt-rollout-design.md` | Deployed private DE-4 server ASR worker; ONNX cache, live server contract, queue, restart, health, and capacity checks verified. Superseded for Telegram routing by the 2026-09-11 record. |
| `superpowers/specs/2026-09-11-telegram-voice-asr-design.md` | Implemented and enabled on DE-4: allowlisted Telegram `voice` → private GigaAM → owner-scoped `voice_transcript`, with synthetic OGG live-contract acceptance and explicit bounds. Real inbound owner Telegram acceptance remains manual. |
| `superpowers/specs/2026-09-12-jarvis-managed-happ-vpn-design.md` | Implemented and deployed: dedicated Xray, closed Host Agent operations, owner-only confirmed Telegram/Desktop control, one-time Happ export, recovery, Operations monitoring, and external exit-IP acceptance. Final import in the user's Happ app remains manual. |
| `superpowers/plans/2026-09-12-jarvis-managed-happ-vpn.md` | Implemented and production-verified on 2026-09-13; retained as rollout history. |
| `superpowers/specs/2026-09-13-jarvis-managed-hysteria2-fallback-design.md` | Implemented and production-active with isolated Hysteria2 state, owner-only protocol-aware controls, pinned deployment, separate monitoring, and verified authenticated proxy traffic. Real iPhone Wi-Fi/LTE acceptance remains. |
| `superpowers/plans/2026-09-13-jarvis-managed-hysteria2-fallback.md` | Implemented and production-verified on 2026-09-14; retained as rollout history. |
| `superpowers/specs/2026-09-12-jarvis-life-os-core-v1-design.md` | Implemented and production-enabled: owner-scoped Event Spine, projections, Timeline, context recovery, explainable proposals, Telegram commands, and Desktop Mission Control. Optional model enrichment remains disabled. |
| `superpowers/plans/2026-09-12-jarvis-life-os-core-v1.md` | Implemented, packaged, installed, and production-verified on 2026-09-13; retained as execution history. |
| `superpowers/plans/2026-09-09-jarvis-vision.md` | Execution plan adapted to the current cloud-brain/local-hands architecture; first camera + two-display + memory slice implemented and locally accepted |
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
| `2026-09-12-desktop-writable-data-path-design.md` | Implemented and regression-tested: packaged Desktop runtime data is centrally redirected from `Program Files` to Electron `userData` |

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
6. After Windows-client or packaged-resource changes, follow the authoritative
   `Desktop EXE Update Reminder` in `AGENTS.md`: check the installed build and
   offer to build and install a current EXE when it is stale.
