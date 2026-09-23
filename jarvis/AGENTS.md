# AGENTS.md

This file is the authoritative project context for every coding agent. Read it
before editing code. `CLAUDE.md` and `gemini.md` point here and must not define a
different architecture.

## Product

Jarvis is a hybrid personal and family AI-assistant platform:

- the always-on cloud control plane owns identity, conversations,
  memory/knowledge retrieval, model routing, Telegram access, and device
  orchestration;
- the Electron application is the Windows client and execution edge for local
  voice, apps, files, windows, and approved remote actions;
- Telegram is the first cloud client, not the whole product;
- PWA remains planned. Server ASR is deployed as a private GigaAM
  `v3_e2e_rnnt` ONNX worker on DE-4. Allowlisted Telegram `voice` notes route
  through it, persist only a `voice_transcript`, and retain no raw audio.
  The deployed synthetic OGG service-to-worker contract and a real inbound
  owner Telegram voice were verified on 2026-09-23; paired-Desktop voice remains
  a manual client acceptance check. Telegram `audio` and other media retain attachment
  ingestion. The first camera/screen
  Vision vertical slice is implemented locally and in the control plane: explicit
  local leases, Camo-compatible camera discovery, a two-display workspace,
  change-filtered temporal sampling, bounded Scene State, provider-neutral
  analysis, encrypted owner-scoped visual memory, and remote
  observation through an already active lease. Real two-display capture is
  verified, including a live Camo 1280x720 frame on 2026-09-09; deployed-provider
  acceptance remains unfinished. Semantic
  retrieval and the confirmed remote-command path are implemented. Production
  embeddings and single-device Desktop/Telegram-origin confirmation were
  verified live on 2026-09-02; live multi-device acceptance remains unfinished.

The short product model is: **cloud brain and memory, local hands on devices**.
See `docs/README.md` for current implementation status and historical records.

## Current Architecture

### Cloud control plane

- `server/` is a Node.js 20+, CommonJS, Fastify service.
- `server/src/telegram/` handles allowlisted Telegram users, update
  deduplication, persistent role-aware bottom navigation, bounded inline
  controls, PostgreSQL-backed guided text input, and a native hierarchical
  Life OS control surface covering Mission, Timeline, projects, commitments,
  proposals, reminders, people/relationships/family grants, modes,
  preferences, sources, and Context Recovery. Life callbacks use a closed
  grammar under 64 UTF-8 bytes; guided mutations are owner/conversation/chat
  scoped, revision-aware, and consumed before execution. Family sharing adds
  a second explicit confirmation and changing recovery continues through the
  existing origin-bound proposal path. Migration 019 and this Telegram surface
  were deployed on 2026-09-15; automated production-image button coverage
  passed, while taps from real owner/member Telegram clients remain manual
  acceptance. The same subsystem also provides an owner-scoped paginated
  gallery that can transiently deliver uploaded documents and readable retained
  Visual Memory frames before a separate keep/delete choice. Gallery callbacks
  carry only closed source identifiers and bounded page state; bytes, storage
  keys, and paths must not enter callbacks or conversation history. Owner-only
  VPN and Operations entries remain authorization-checked on every action; menu
  labels are presentation, not authority. Telegram update diagnostics may
  retain only a closed update kind, outcome, and failure code; dialogue text,
  callback payloads, exception details, and credentials are forbidden in update
  diagnostics and Operations logs. Navigation, migration 015, the VPN
  owner-context fix, and the memory gallery were deployed on 2026-09-14; live
  owner/member media and deletion acceptance remains manual.
- PostgreSQL with pgvector is the source of truth for cloud identity,
  conversations, memory, private document metadata/chunks, and device domains.
- `server/src/prompts/` builds the versioned Jarvis persona and keeps trusted
  policy separate from user-controlled content.
- `server/src/assistant/` invokes a provider and validates policy-sensitive
  output with at most one corrective retry.
- `server/src/orchestrator/` owns versioned action manifests, executor routing,
  owner-scoped workflows, strict tool planning, bounded continuation, and
  asynchronous result delivery. Desktop is the first executor; future server
  workers and account connectors must implement the same registry contract.
- `server/src/providers/` contains OpenAI-compatible and fallback adapters.
  Provider/model selection is configuration, not Jarvis identity.
- `server/src/knowledge/` owns owner-scoped attachment storage, bounded ingest
  jobs, text/metadata retrieval, and citations. Never treat document content as
  trusted instructions or expose the private storage volume.
- `server/src/life/` owns the owner-scoped Life OS Event Spine, bounded reply
  context, areas, projects, typed links, commitments, reminders, people,
  explicit family grants, modes, inspectable preferences, explainable priority,
  proposals/evidence, Timeline, recovery plans, bounded proactivity, and the
  provider-neutral Life Source Adapter contract. The eight current external
  adapters are fixture-only until a real provider is explicitly configured.
  Source adapters may store only safe summaries and identifiers; raw audio,
  images, OCR, document bodies, local paths, storage keys, credentials, and
  provider cursors in public output are forbidden by schema.
  Life OS v2 migrations 016–018 and the server runtime were deployed on
  2026-09-15. The exact Russian phrase completed the isolated real-PostgreSQL
  cycle through Action Orchestrator and the real Tool Gateway contract exactly
  once; its verified workflow completed the linked proposal and commitment and
  appeared in Timeline/Context Recovery. Authenticated read-only Desktop
  bootstrap/Mission Control/Timeline requests, Compose health, and public smoke
  also passed. The native Telegram Life OS control surface was deployed later
  the same day; live external providers, real-client Telegram taps, and
  interactive changing recovery on a paired Desktop remain manual acceptance.
- The deployed text model is currently configured through OpenRouter. Do not
  hard-code a provider or model into product behavior.

### Windows execution edge

- Target OS: Windows; runtime: Electron + Node.js CommonJS.
- `main.js` owns Electron lifecycle, tray, shortcuts, windows, and IPC wiring.
- `preload.js` exposes explicit renderer capabilities.
- `renderer/` contains the launcher, task UI, voice overlay, and Voice Lab.
- `renderer/life-os/` is the Desktop-first Mission Control surface. Its preload
  bridge exposes only bounded Life OS operations; proposal payloads do not
  expose frozen action arguments or owner identifiers. Local workspace paths
  remain in `tools/workspaceRegistry.js`; cloud recovery plans refer only to
  project IDs and opaque resource references, and execute through Tool Gateway.
- `voice/` owns Desktop microphone capture, the local Vosk wake-word worker,
  cloud-voice transport, quality monitoring, and calibration. The default
  family client uses a bundled Node runtime only for the Vosk wake word; legacy
  `stt_runtime/`/Faster Whisper remains a development-only local subsystem.
- `tts/` keeps Silero/Piper behind `tts/ttsService.js`.
- tools/ and actions/ implement bounded local operations. tools/appResolver.js
  and tools/appIndexer.js index Start Menu and UWP apps with UTF-8 encoding and
  support Russian inflection/stemming. When local resolution fails or is ambiguous,
  agents/toolGateway.js falls back to tools/appRecoveryService.js for AI-assisted
  candidate discovery and ranking, recording confirmed launches in apps.learned.json.
- `renderer/quantumCore.js` provides procedural 3D WebGL (Three.js r160) avatar
  («Quantum Holographic Core 2.0»), integrated into Cloud Chat sidebar, floating
  Voice Overlay, and a dedicated desktop companion widget (`renderer/quantum-widget.*`)
  with full state/emotion IPC sync.
- `vision/` owns explicit local Vision Leases, hidden camera capture, protected
  screen checks, two-display composition, intent routing, and cloud transport.
  Camera media permission is restricted to the hidden capture renderer. Telegram
  and future PWA clients may observe only through an already active owner lease;
  they cannot start, add, or extend local capture sources.
- `agents/toolGateway.js` is the execution authority for agent-requested OS
  mutations. `agents/toolPolicy.js` and `agents/toolSchemas.js` are shared
  policy/validation contracts.
- `agents/remoteProtocol.js` validates the Desktop WSS wire contract. Pairing,
  owner-scoped device sessions, presence, confirmed command dispatch, and
  Tool-Gateway execution are implemented. File search results use local,
  short-lived opaque candidates before subsequent actions. Production
  multi-device acceptance and broader client UX remain unfinished.
- `agent_runtime/` is the existing Python/LangGraph planner for complex local
  Desktop Agent tasks. It is no longer the only stateful AI-related component
  in the overall product because the cloud server persists conversations.
- Writable local state, settings, and generated indexes (`ui-state.local.json`,
  `history.json`, `settings.json`, `ai-settings.json`, `ai-cache.json`,
  `app-index.json`, `apps.user.json`, `apps.learned.json`, `file-index.json`,
  `agent-history.json`) route through the shared
  `runtimeDataPath.js` policy:
  when packaged (`app.isPackaged`), they are safely redirected from read-only
  install folders (`C:\Program Files\...`) to `%APPDATA%\jarvis\data\`
  (`app.getPath('userData')/data/`). Development continues using repository `data/`.
  Write operations catch filesystem errors to prevent unhandled `EPERM` crashes.

### Deployment

- `server/src/operations/` owns the owner-only Operations panel, Telegram
  browser approval, metadata-only family/device administration, telemetry,
  incidents, and durable fixed service operations. `ops-ui/` is its React/Vite
  client; `host-agent/` is the Python standard-library Unix-socket execution
  boundary. The application container has neither a Docker socket nor sudo.
- Operations checks track actual Telegram poll completion, database migrations,
  stuck jobs, and a configured primary-model probe. The model probe uses only
  a synthetic health message and a PostgreSQL-backed six-hour schedule.
- VPN Supervisor is production-deployed across the DE and NL nodes. Host Agent
  deterministically classifies one primary cause from the bounded
  `vpn.health.snapshot`; Jarvis Server cross-validates and debounces it, then an
  isolated planner may use the configured Jarvis model path with sanitized,
  bounded node-local logs. One `need_observation` response can trigger exactly
  one closed read-only `vpn.health.snapshot` against the same node; a changed
  incident revision, invalid snapshot, or second request stops planning. The
  response must match a strict seven-field schema and a closed playbook catalog.
  The current local source enables only `restart_xray` and
  `restart_hysteria2`, only for their matching service-failure incidents with
  healthy host/network, valid target config, and a healthy opposite stack.
  A fresh private Telegram owner confirmation is required. Execution rechecks
  the incident, claims one durable request ID, invokes only the closed restart
  operation, and verifies both stacks. Uncertain outcomes reconcile by that
  same ID and are never retried; restore playbooks remain disabled. This
  real-restart source was deployed on 2026-09-23 with migration 026, but no
  real restart has yet been accepted during a live incident.
  Cross-node probe units and the owner-confirmed transient credential handoff
  are deployed, but no test credential is installed and both timers remain
  disabled until four successful owner-approved one-shot checks. The already
  accepted `supervisor_acceptance_noop` never calls Host Agent. Before changing
  this production boundary, verify the running playbook flags and owner
  acceptance record; readiness alone does not prove a real repair.
- Cross-node client probe code, root-only credential installer and disabled
  units are deployed on DE and NL. A one-time URI may travel only through the
  authenticated Host Agent socket; it is neither journaled nor returned to
  Telegram, PostgreSQL, logs, prompts or telemetry. Telegram offers only four
  fixed test-device bindings and an origin-bound owner confirmation for each.
  `/vpn_health` reports results separately and treats missing, stale, mismatched,
  or ambiguous checks as unknown. External probe failures do not authorize an
  LLM repair or key rotation.
- Host Agent mutation claims are persisted before execution. An interrupted
  command has an unknown outcome and is reconciled; never retry it under a new
  identifier merely because its connection was lost. Discovery is read-only.
- `host-agent/jarvis_host_agent/vpn_manager.py` owns the root-only Xray state
  and generated config. Jarvis exposes only closed `vpn.*` operations;
  mutations require an owner confirmation bound to the originating
  Telegram/Desktop client. VLESS URIs are one-time response artifacts and must
  never be persisted in PostgreSQL, conversations, telemetry, or logs.
- `host-agent/jarvis_host_agent/hysteria_vpn_manager.py` independently owns the
  root-only Hysteria2 state and generated config. Its closed
  `vpn.hysteria2.*` operations use the same owner-confirmation boundary, while
  one-time `hy2://` exports follow the same non-persistence rule.
- VPN control is multi-node: `de` uses the local Host Agent socket and `nl`
  uses the authenticated StreamLocal-forwarded
  `/run/jarvis-host-agent/agent-nl.sock`. Telegram requires a country choice
  before protocol actions. Pending and recovery records retain the closed node
  code so an uncertain NL action is never reconciled against DE. Operations
  stores both hosts and runs a VPN-only collector and separate incident/advisory
  path for NL.
- Operations log archives contain bounded severity/lifecycle summaries only;
  raw parser findings, family content, SQL values and credentials are excluded.
- Backup scheduling and real backup/restore acceptance are deferred by the
  owner as of 2026-09-06. Do not enable the timer as part of panel maintenance.

- The production VPS (`87.120.187.202`) runs Ubuntu 24.04 LTS (SSH host `jarvis-vps`).
- The new VPS (`94.183.208.56`) runs Ubuntu 24.04.4 LTS; passwordless sudo user `deploy` and SSH access are configured via host alias `jarvis-vps-new` in `~/.ssh/config` using `~/.ssh/gemini_vps2`. Remote application root is `/home/deploy/apps/jarvis`.
- Docker Compose runs `server` and private `postgres`; `cloudflared` is the
  intended public ingress because the dedicated `xray.service` owns port 443.
  The deployed VPN is VLESS + REALITY + XTLS Vision for Happ. Xray health and
  client count are monitored by Operations; legacy x-ui is disabled but its
  root-only rollback backup is retained.
- The current public Tunnel hostname is `jarvis.rilora.ru`; `/health/ready` was
  verified through Cloudflare on 2026-09-02 after the Action Orchestrator
  migration. `cloudflared` runs as root only
  inside its isolated container to read its read-only file-backed secret; the
  VPS token file must remain mode `0600`.
- `deploy/docker-compose.yml` also retains an optional Caddy profile for hosts
  where 80/443 are available. Do not start both ingress modes accidentally.
- Xray keeps the original VLESS + REALITY + XTLS Vision listener on TCP 443 and
  a managed TCP 8443 fallback. Happ exports prefer 8443 with bounded client-side
  compatibility parameters after live owner-route diagnostics found repeated
  SYN retransmission on 443. Do not add forced ClientHello fragmentation to a
  single-node export: it caused multi-second iOS Happ connection checks. Both
  listeners use the same validated root-only client state; Host Agent changes
  must preserve them together.
- Hysteria2 v2.12.2 is deployed as an isolated fallback on the second address,
  `87.120.187.109:443/udp`, with the DNS-only hostname `vpn.rilora.ru`, strict
  ACME TLS, dynamic HTTP authentication via Host Agent (`127.0.0.1:3211/vpn/hysteria2/auth`),
  and Salamander obfuscation. Key issuance, rotation, and revocation update
  `hysteria2-state.json` without restarting `hysteria-server.service`, preserving
  active QUIC streams and game sessions with zero downtime. Xray retains
  TCP 443/8443. Operations monitors `hysteria-server.service` separately, and
  rollback may remove only Hysteria2 plus its exact UDP 443 and ACME TCP 80
  firewall rules.
- `server/src/vpn/vpnRoutingService.js` provides domestic Russian split-routing
  rules for Happ. Russian services (`geosite:category-ru`, `geoip:ru`, `.ru`,
  `.su`) route directly via physical client IP using Yandex DNS `77.88.8.8` with
  `IPIfNonMatch`; all remaining traffic routes via the active Happ VPN profile
  (Hysteria 2 or VLESS). A dedicated
  public endpoint `GET /happ-routing` (`https://jarvis.rilora.ru/happ-routing`) serves
  a 1-click HTML redirect bridge to the `happ://routing/onadd/...` deeplink, avoiding
  Telegram Bot API deep link URL limitations and Base64 chat pollution. The routing
  profile contains only public routing/DNS rules and zero credentials or tokens.
  The Telegram bot `/vpn` menu exposes the profile directly in the Hysteria 2 tab
  alongside a 2-step setup guide.
- `server/src/vpn/vpnSubscriptionService.js` and `server/src/vpn/vpnSubscriptionRepository.js`
  provide dynamic multi-node subscriptions for Happ / Sing-box. A single subscription
  profile aggregates four endpoints; explicit Sing-box JSON includes client-side
  `url-test` failover, while the default Happ-compatible Base64 response is a list
  of four URIs and does not itself guarantee automatic failover:
  (1) 🇩🇪 DE Hysteria 2, (2) 🇳🇱 NL Hysteria 2, (3) 🇩🇪 DE VLESS 8443, and (4) 🇳🇱 NL VLESS 8443.
  Both DE and NL nodes run UDP port hopping across `20000:50000` via iptables NAT PREROUTING
  DNAT to port 443 (`deploy/vpn/setup-port-hopping.sh`), mitigating observed
  UDP 443 blocking without guaranteeing reachability on every client network.
  PostgreSQL migration `022_vpn_subscriptions.sql` stores only SHA-256 token hashes
  (`token_hash`) for strict zero raw secret persistence. `GET /sub/:token` dynamically generates
  Sing-box JSON (or Base64 for legacy clients) demoting probe-degraded nodes via `ExternalProbeMonitor`.
  `GET /happ-sub/:token` provides a 1-click HTML landing bridge to the Happ
  subscription deeplink for that same URL.
  Telegram `/vpn` offers «📲 Подписки (Happ)» with creation, token rotation, and revocation.
  Initial binding of the four client identities is a separate owner-confirmed
  `subscription.repair` action (migration 023); an already bound or uncertain
  repair is blocked rather than overwriting clients or issuing another access set.
  The binding response delivers a one-time Happ URL and import button. A bound
  profile can rotate its token to obtain a new URL; the previous URL then stops
  working on every device. Telegram conversation history stores only a redacted
  delivery status, never the raw subscription token. Subscription revocation
  disables the URL but does not revoke already issued node credentials.
  The owner names a profile before creation and may rename an active profile in
  Telegram without rotating its token or changing bound clients. Successful
  ordinary Happ refreshes receive the documented Base64 `profile-title` and a
  one-hour `profile-update-interval`; the label visible in Happ remains a
  client acceptance check when a refresh itself fails.
  Hysteria 2 Host Agent exports connect to each node's `address` while retaining
  its certificate `serverName` as SNI. The current deployed subscription revision
  publishes only a validated finite public port pool in the URI authority and
  uses Happ's 30-second multi-port default rather than an undocumented URI
  interval parameter. A two-request
  cross-node hopping probe is required before Hysteria is considered healthy;
  host data-plane checks and phone-side Happ traffic remain separate acceptance
  evidence. Probe timers remain disabled.
  NL currently uses a `vpn.rilora.ru` certificate, but public DNS for that name
  points to DE. The existing NL certificate expires on 2026-12-12; unattended
  HTTP-01 renewal on NL is not established. Provision a distinct DNS-only NL
  hostname and matching certificate before that date. The Hysteria installer
  now rejects DNS/address mismatches even when cached ACME files exist.
- PostgreSQL must never be published publicly.
- The DE-4 runs the private `gigaam-asr` service for Russian server ASR with a
  four-CPU/8-GiB cap and no host port. Its observed steady-state RSS is about
  1.2 GiB. `JARVIS_TELEGRAM_VOICE_ENABLED=true` enables only allowlisted
  Telegram `voice` notes, bounded to 5 MiB, 120 seconds, and three per owner
  per minute before download; OGG/Opus is decoded only in the worker's tmpfs.
  Qwen remains a stopped benchmark profile. Local LLM deployment still requires
  its own measured capacity decision.

## Safety and Trust Boundaries

- Never add API keys, Telegram tokens, Cloudflare tokens, device
  tokens, or database passwords to Git, tests, logs, prompts, or chat output.
- Use environment variables and ignored files under `deploy/secrets/`.
- Never expose PostgreSQL, worker internals, Docker control endpoints, or a
  local Windows inbound control port to the public internet.
- Models may select only declared tool actions with validated structured
  arguments. Do not implement arbitrary model-generated shell or PowerShell.
- `observe` and `low_risk` map to user-visible `safe`; confirmation policies
  map to `changing`. Changing remote actions require confirmation in the client
  from which the request originated.
- Never claim an OS action succeeded without a successful Tool Gateway result.
- Scope cloud data by user before retrieval/ranking. One user may own multiple
  devices, but users must never share conversations, memory, documents, or
  device authority implicitly.
- Do not weaken these boundaries because the deployment is currently private.
- Treat uploaded files as hostile: bound bytes before buffering, use opaque
  storage keys, never unpack archives automatically, and do not log Telegram
  file URLs because they contain the bot token.
- Telegram `voice` raw bytes are request-temporary only: never place them in
  document storage, memory, conversation content, telemetry, or logs.
- VPN routing profiles and landing endpoints (such as `/happ-routing`) are
  public and must contain only public routing/DNS rules; never embed
  credentials, user UUIDs, tokens, or secret keys.

## Generated and Local State

Do not edit or commit unless the task explicitly requires it:

- `node_modules/`, `server/node_modules/`, `build/`, `models/`, `voices/`;
- `.env`, `.env.*` except committed examples, and `deploy/secrets/*`;
- deployment archives such as `jarvis-server-deploy.zip`;
- `data/app-index.json`, `data/apps.learned.json` and backups/quarantines;
- `data/history.json`, `data/ai-cache.json`, `data/agent-history.json`;
- `data/file-index.json`, `data/ui-state.local.json`, `data/tts-cache/`;
- `data/stt-profiles.json`, preview settings, device identity, logs, temporary
  audio, user documents, database dumps, and downloaded models (in packaged
  execution, stored under `%APPDATA%\jarvis\data\`).

`data/stt-settings.json` is a checked-in default and may be changed deliberately
with its validation tests.

## Code Style

- Keep CommonJS unless a deliberate migration is approved.
- Prefer focused modules over growing `main.js` or `renderer/renderer.js`.
- Keep IPC and remote wire contracts explicit and validated at trust boundaries.
- Keep TTS behind `tts/ttsService.js` and STT settings behind
  `voice/sttSettings.js`.
- Preserve UTF-8 Russian text; fix mojibake deliberately with nearby context.
- Avoid broad refactors during narrow fixes and preserve unrelated dirty-worktree
  changes.
- Ask before adding a new production dependency.

## Telegram Menu Contract

- Before changing any Telegram button, keyboard label or row, callback grammar,
  route, guided input, visibility rule, or confirmation path, read
  `docs/telegram-button-architecture.md` and `docs/telegram-menu-contract.md`
  in full. Send the pre-edit change notice required by the architecture guide.
- Do not change the observable menu/callback contract or a confirmation/security
  boundary without explicit owner approval in the current task, matching tests,
  and synchronized updates to the menu contract. Internal fixes must preserve
  the documented owner/user/conversation/chat scopes, deduplication, closed
  grammar, and origin-bound confirmation.
- Telegram update diagnostics may retain only closed route kind, phase, outcome,
  and failure code. Never log dialogue text, transcripts, callback payloads,
  raw Telegram file URLs, credentials, or exception messages.

## Commands and Verification

Windows client:

```powershell
npm start
node scripts/ensureTts.js
node scripts/ensureStt.js
node scripts/testEverythingSearch.js
node scripts/testFileCommands.js
node scripts/testRuntimeDataPath.js
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
node scripts/testSttSettings.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testVoiceQualityMonitor.js
node scripts/testVoiceLabController.js
node scripts/testGeminiVoiceAdvisor.js
node scripts/testVoiceLabRenderer.js
node scripts/testTrayMenu.js
node scripts/testQuantumCore.js
node scripts/testLifeOsIpc.js
node scripts/testLifeOsRenderer.js
node scripts/testLifeOsBrowser.cjs
node scripts/testLifeOsDesktopAcceptance.js
node scripts/testVisionTransport.js
node scripts/testVisionRuntime.js
node scripts/testVisionIpc.js
node scripts/testVisionMediaPermission.js
node scripts/testObjectReconciler.js
node scripts/testSceneState.js
./scripts/testVpnExternal.ps1 -SharePath ABSOLUTE_VLESS_FILE -ExpectedExitIp VPS_IP
npx electron scripts/probeVisionHardware.js
node scripts/testVisionRendererBrowser.cjs
node scripts/testVisionCaptureRendererBrowser.cjs
node --test cloud/*.test.js voice/cloudVoiceService.test.js tts/windowsSapiService.test.js
npm run dist:win
python scripts/testFasterWhisperQuality.py
```

Cloud server:

```powershell
cd server
npm test
npm start
```

Telegram menu changes: run the focused suite in
`docs/telegram-menu-contract.md`, then full `server/npm test` before deployment.

Run the smallest relevant checks first, then adjacent regression suites. For
configured model changes, test missing-key behavior, fake transport, and a
manual live contract without printing secrets. For deployment changes, use
`deploy/scripts/preflight.sh`, Compose health, and `deploy/scripts/smoke.sh`.

Operations verification: `npm test` and `npm run build` in `ops-ui/`;
`PYTHONPATH=host-agent python3 -m unittest discover -s host-agent/tests` on
Linux. `scripts/testOperationsBrowser.cjs` runs local Playwright fixture checks
at 1440/390/320 px; supply `PLAYWRIGHT_MODULE` for a bundled runtime and
`PLAYWRIGHT_CHANNEL=msedge` when using installed Edge. The explicit integration
script `server/test/operationsPostgresAcceptance.cjs` requires PostgreSQL and a
running Host Agent; it creates only a unique fixture schema and rolls back its
public-table fixtures. Telegram delivery is opt-in via
`JARVIS_ACCEPTANCE_NOTIFY=1`, not part of ordinary test runs.

## Desktop EXE Update Reminder

- After any change that affects the Windows client or its packaged resources,
  compare the installed Jarvis Desktop EXE with the current sources.
- If the installed EXE is stale, explicitly offer in the final response to run
  `npm run dist:win` and install the resulting current EXE.
- Do not build or install the EXE automatically without a user request.
- Documentation-only, server-only, and deployment-only changes do not trigger
  this reminder unless they also affect the Windows client or its package.

## Documentation Policy

- `README.md` is the product entry point and reports only verified current
  capabilities plus clearly labelled roadmap items.
- `docs/README.md` is the documentation index and status authority.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` are decision and
  implementation history. Preserve them; add a status/supersession note rather
  than rewriting history as if an old plan had always described the new system.
- Update this file whenever runtime ownership, safety boundaries, verification
  commands, or product status materially changes.
