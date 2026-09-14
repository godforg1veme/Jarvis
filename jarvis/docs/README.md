# Jarvis documentation map

This file is the status authority for project documentation. Specifications and
plans under `docs/superpowers/` are preserved as decision history; their old
future-tense wording does not override the current architecture in `AGENTS.md`.

Status snapshot: 2026-09-14.

Happ VPN domestic RU split-routing update, 2026-09-14: domestic Russian traffic
(Gosuslugi, banks, marketplaces, .ru/.su domains) routes directly via the physical
client IP, while Hysteria 2 handles international and blocked traffic. Yandex DNS
`77.88.8.8` with `IPIfNonMatch` prevents domestic resolution failures. Telegram
bot provides `🇷🇺 Обход РФ` (/vpn_routing) with a 1-click web activation endpoint
`https://jarvis.rilora.ru/happ-routing`, bypassing Telegram's custom deep link
restrictions without raw Base64 clutter. Deployed, verified on VPS, and covered
by 357 server tests. See `updates/2026-09-14-happ-vpn-ru-routing.md`.

Telegram navigation update, 2026-09-14: button-first control is implemented
and covered by the full server suite. The server image and migration 015 are
deployed on the VPS; preflight, Compose health, public HTTPS smoke, and migration
registration passed. Telegram installs a persistent role-aware bottom keyboard;
dynamic object choices and policy-required confirmations stay inline. Guided
PostgreSQL-backed input replaces command composition for VPN labels, pairing
names, memory changes, and selected-Desktop instructions. The owner receives a
separately authenticated Operations link. Live owner/member Telegram client
acceptance remains manual. See
`updates/2026-09-14-telegram-button-navigation.md`.

Telegram memory gallery and VPN fix, 2026-09-14: the bottom-menu dispatcher now
preserves the authenticated canonical user UUID, so the existing VPN service can
perform its owner check instead of rejecting a valid owner as
`VPN_OWNER_REQUIRED`. `🧠 Память` now includes an owner-scoped, paginated
`🖼 Файлы и кадры` gallery over uploaded documents and readable retained Visual
Memory frames. A selection sends transient photo/file content first, then offers
separate delete, keep, and back controls; callbacks and conversations contain no
bytes or storage internals. The complete 261-test server suite passed. The
server-only production rebuild, Compose health, public smoke, sanitized log
review, actual VPN-menu service call, and gallery query against production data
passed. Real Telegram taps, media delivery, and deletion of a disposable item
remain manual client acceptance. See
`updates/2026-09-14-telegram-memory-gallery-vpn-fix.md`.

App resolution & AI recovery update, 2026-09-14: Start Menu indexing was fixed
to use UTF-8 encoded PowerShell invocations, Cyrillic inflection stemming was added
to appResolver, and AI-assisted candidate recovery via AppRecoveryService was wired
into ToolGateway for local and remote command execution.

Life OS update, 2026-09-15: v2 is implemented in code and locally verified across
bounded ordinary-reply context, cautious communication guidance, explainable
priority, people/family grants, modes/preferences, reminders, recovery plans,
actionable proactivity, eight fixture-only source adapters, authenticated API,
and responsive Desktop Mission Control. It has not been deployed or checked
against a real PostgreSQL instance; installed Desktop executables are stale.
Core v1 remains the production-enabled baseline. Details are recorded in
`updates/2026-09-15-jarvis-life-os-v2.md`.

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
| `updates/2026-09-14-telegram-button-navigation.md` | Production rollout record for button-first navigation in Telegram |
| `updates/2026-09-14-telegram-memory-gallery-vpn-fix.md` | Production rollout record for the VPN owner-context fix and unified Telegram memory gallery |
| `updates/2026-09-14-hysteria2-fallback-rollout.md` | Production rollout record for isolated Hysteria2 service |
| `updates/2026-09-14-happ-vpn-ru-routing.md` | Production rollout record for Happ domestic RU split-routing and 1-click web activation |
| `updates/2026-09-15-jarvis-life-os-v2.md` | Local implementation and verification record for Life OS v2, including the evidence matrix and outstanding PostgreSQL/live acceptance |
| `VPN_PC_SETUP.md` | Руководство по настройке Hysteria 2 и VLESS на ПК (Windows / macOS) и устранению неполадок |
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
| `superpowers/specs/2026-09-14-telegram-human-button-navigation-design.md` | Implemented and deployed with persistent role-aware navigation, guided input, inline confirmations, and an owner-only Operations link; live owner/member Telegram acceptance remains. |
| `superpowers/plans/2026-09-14-telegram-human-button-navigation.md` | Implemented, covered by the complete server test suite, and production-deployed on 2026-09-14; retained as execution history. |
| `superpowers/specs/2026-09-14-telegram-unified-memory-gallery-vpn-owner-fix-design.md` | Implemented and production-deployed; automated owner-context, gallery-query, health, smoke, and 261-test acceptance passed. Real Telegram media/delete acceptance remains manual. |
| `superpowers/plans/2026-09-14-telegram-unified-memory-gallery-vpn-owner-fix.md` | Implemented and production-deployed on 2026-09-14; retained as execution history with manual Telegram acceptance explicitly outstanding. |
| `superpowers/specs/2026-09-12-jarvis-life-os-core-v1-design.md` | Implemented and production-enabled: owner-scoped Event Spine, projections, Timeline, context recovery, explainable proposals, Telegram commands, and Desktop Mission Control. Optional model enrichment remains disabled. |
| `superpowers/plans/2026-09-12-jarvis-life-os-core-v1.md` | Implemented, packaged, installed, and production-verified on 2026-09-13; retained as execution history. |
| `superpowers/specs/2026-09-14-jarvis-life-os-v2-design.md` | Implemented in code and locally verified on 2026-09-15; real PostgreSQL, live connector, installed-Desktop, Telegram, and production acceptance remain outstanding. |
| `superpowers/plans/2026-09-14-jarvis-life-os-v2.md` | All code checkpoints and local checks completed; real-PostgreSQL and live acceptance portions remain outstanding. No v2 deployment, EXE build/install, or external account connection was performed. |
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
