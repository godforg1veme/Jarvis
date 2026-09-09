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
- PWA and server ASR remain planned or in progress. The first camera/screen
  Vision vertical slice is implemented locally and in the control plane: explicit
  local leases, Camo-compatible camera discovery, a two-display workspace,
  change-filtered temporal sampling, bounded Scene State, provider-neutral
  analysis, encrypted owner-scoped visual memory, and remote
  observation through an already active lease. Real two-display capture is
  verified; live Camo and deployed-provider acceptance remain unfinished. Semantic
  retrieval and the confirmed remote-command path are implemented. Production
  embeddings and single-device Desktop/Telegram-origin confirmation were
  verified live on 2026-09-02; live multi-device acceptance remains unfinished.

The short product model is: **cloud brain and memory, local hands on devices**.
See `docs/README.md` for current implementation status and historical records.

## Current Architecture

### Cloud control plane

- `server/` is a Node.js 20+, CommonJS, Fastify service.
- `server/src/telegram/` handles allowlisted Telegram users and update
  deduplication.
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
- The deployed text model is currently configured through OpenRouter. Do not
  hard-code a provider or model into product behavior.

### Windows execution edge

- Target OS: Windows; runtime: Electron + Node.js CommonJS.
- `main.js` owns Electron lifecycle, tray, shortcuts, windows, and IPC wiring.
- `preload.js` exposes explicit renderer capabilities.
- `renderer/` contains the launcher, task UI, voice overlay, and Voice Lab.
- `voice/` owns Desktop microphone capture, the local Vosk wake-word worker,
  cloud-voice transport, quality monitoring, and calibration. The default
  family client uses a bundled Node runtime only for the Vosk wake word; legacy
  `stt_runtime/`/Faster Whisper remains a development-only local subsystem.
- `tts/` keeps Silero/Piper behind `tts/ttsService.js`.
- `tools/` and `actions/` implement bounded local operations.
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
  `history.json`, `settings.json`, `app-index.json`, `apps.user.json`,
  `file-index.json`, `agent-history.json`) route through `getWritableDataPath`:
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
- Host Agent mutation claims are persisted before execution. An interrupted
  command has an unknown outcome and is reconciled; never retry it under a new
  identifier merely because its connection was lost. Discovery is read-only.
- Operations log archives contain bounded severity/lifecycle summaries only;
  raw parser findings, family content, SQL values and credentials are excluded.
- Backup scheduling and real backup/restore acceptance are deferred by the
  owner as of 2026-09-06. Do not enable the timer as part of panel maintenance.

- The current VPS runs Ubuntu 24.04 LTS, not the original planned 22.04.
- Docker Compose runs `server` and private `postgres`; `cloudflared` is the
  intended public ingress because host port 443 is occupied by Xray.
- The current public Tunnel hostname is `jarvis.rilora.ru`; `/health/ready` was
  verified through Cloudflare on 2026-09-02 after the Action Orchestrator
  migration. `cloudflared` runs as root only
  inside its isolated container to read its read-only file-backed secret; the
  VPS token file must remain mode `0600`.
- `deploy/docker-compose.yml` also retains an optional Caddy profile for hosts
  where 80/443 are available. Do not start both ingress modes accidentally.
- PostgreSQL must never be published publicly.
- The current small host may run the control plane and cloud-model client, but
  local LLM/ASR workers require a measured capacity decision after the DE-4
  upgrade.

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

## Commands and Verification

Windows client:

```powershell
npm start
node scripts/ensureTts.js
node scripts/ensureStt.js
node scripts/testEverythingSearch.js
node scripts/testFileCommands.js
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
node scripts/testVisionTransport.js
node scripts/testVisionRuntime.js
node scripts/testVisionIpc.js
node scripts/testVisionMediaPermission.js
node scripts/testObjectReconciler.js
node scripts/testSceneState.js
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

## Documentation Policy

- `README.md` is the product entry point and reports only verified current
  capabilities plus clearly labelled roadmap items.
- `docs/README.md` is the documentation index and status authority.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` are decision and
  implementation history. Preserve them; add a status/supersession note rather
  than rewriting history as if an old plan had always described the new system.
- Update this file whenever runtime ownership, safety boundaries, verification
  commands, or product status materially changes.
