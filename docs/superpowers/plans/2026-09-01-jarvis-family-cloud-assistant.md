# Jarvis Family Cloud Assistant Implementation Plan

Status: active roadmap, partially implemented as of 2026-09-01.

Current execution: the shared policy/protocol foundation, Compose/PostgreSQL
control plane, Telegram text slice, OpenRouter-compatible provider gateway, and
canonical prompt pipeline exist. Remote device networking, memory retrieval,
document ingestion, server ASR, Salad runtime, backups, PWA/vision, and full
acceptance remain incomplete. Production runs Ubuntu 24.04 with Cloudflare
Tunnel because Xray owns port 443; older Ubuntu 22.04/Caddy steps below are
historical plan text, not current operations.

Design: `docs/superpowers/specs/2026-09-01-jarvis-family-cloud-assistant-design.md`

## Outcome

Deliver an always-on family Jarvis on a DE-4-class VPS. The first client
is Telegram. Each allowed user has isolated conversations, memories, documents,
and devices. Voice is transcribed on the server. Complex requests use Gemma 4
12B Q4 on Salad or OpenRouter through a switchable model gateway. An online
Windows Jarvis instance can execute bounded tool calls for its owner through an
outbound secure WebSocket connection.

This plan deliberately delivers useful vertical slices. Do not start remote PC
mutation or PWA/camera work before text chat, identity isolation, persistence,
backup, and provider fallback are verified.

## Implementation Constraints

- Keep the existing Electron project CommonJS.
- Keep Python LangGraph in `agent_runtime/` as the only stateful AI planning
  layer.
- Keep the Node Tool Gateway as the only authority that executes Windows tools.
- Do not allow LLM-generated shell or PowerShell.
- Do not put API keys, Telegram tokens, or device tokens in git.
- Do not commit generated state, downloaded models, document contents, or
  backups.
- Preserve current local voice and desktop-agent behavior while adding remote
  connectivity.
- Add production dependencies only after the user approves the dependency
  checkpoint below, as required by `AGENTS.md`.
- Work around the current dirty worktree and never overwrite unrelated local
  changes.

## Required User Inputs

Collect these before the corresponding deployment milestone, not in source
control:

1. DE-4 public IP and root/initial SSH access.
2. A domain or subdomain whose DNS can point to DE-4.
3. Telegram bot token from BotFather.
4. Initial allowed Telegram numeric IDs.
5. OpenRouter API key and selected fallback model.
6. Salad account, endpoint credentials, and container registry choice.
7. An off-server restic-compatible backup destination.

## Dependency Approval Checkpoint

Before implementation, ask the user to approve these new production
dependencies. Keep them isolated from the root Electron `package.json` where
possible.

Server Node package (`server/package.json`):

- `fastify` for the server application and health/internal APIs;
- `@fastify/websocket` for Device Agent sessions;
- `grammy` for Telegram long polling and inline confirmations;
- `pg` for PostgreSQL;
- `zod` for boundary and protocol validation.

Python runtime (`agent_runtime/requirements.txt` and a server worker requirements
file if isolation proves necessary):

- `langchain-openai` for OpenAI-compatible Salad/OpenRouter chat endpoints;
- `qwen-asr` plus its supported CPU runtime for the official ASR benchmark;
- an approved quantized CPU runtime only after validating its source and
  license;
- `sentence-transformers` for the first multilingual embedding worker;
- `pypdf` and `python-docx` for PDF/DOCX ingestion.

Host tools installed outside npm/pip:

- Docker Engine and Compose plugin;
- Caddy;
- PostgreSQL client utilities;
- restic;
- ffmpeg.

Do not silently replace these choices during implementation. Record any
dependency change in the plan or a follow-up decision.

## Target Repository Layout

Add a server package without moving the Electron application:

```text
server/
  package.json
  src/
    app.js
    index.js
    config/
    db/
    telegram/
    users/
    conversations/
    memory/
    knowledge/
    voice/
    models/
    devices/
    agents/
    commands/
    confirmations/
    audit/
  test/

server_runtime/
  requirements.txt
  asr_worker.py
  embedding_worker.py
  document_worker.py
  worker_protocol.py
  tests/

deploy/
  docker-compose.yml
  Caddyfile
  env.example
  postgres/
  systemd/
  backup/
  scripts/
```

Extend, rather than duplicate, these existing areas:

- `agent_runtime/` for the cloud LangGraph and model provider routing;
- `agents/` for shared tool schemas and Windows Device Agent connectivity;
- `main.js`, `preload.js`, and a small renderer settings surface for device
  pairing/status;
- `.gitignore` for server local state and device identity files.

## Milestone 0: Baseline and Contracts

### Task 0.1: Record the existing baseline

Read and run the existing relevant tests before touching code:

```powershell
node scripts/testIntentRouter.js
node scripts/testVisualIntent.js
node scripts/testDesktopAgentClient.js
node scripts/testToolGateway.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testSttSettings.js
```

Also run the Python protocol tests with the configured agent venv. Record
environment-only failures instead of changing code to hide them.

### Task 0.2: Define shared wire contracts

Create pure, Electron-free contract modules:

- `agents/toolSchemas.js`: allowed actions and argument schemas;
- `agents/toolPolicy.js`: internal policy and two user-visible categories;
- `agents/remoteProtocol.js`: device hello, capability, command, result,
  heartbeat, and cancellation message schemas;
- `server/src/contracts/agentProtocol.js`: server validation facade.

Refactor `agents/toolGateway.js` and `agents/planNormalizer.js` to consume the
shared schemas without changing behavior. Preserve the current four internal
policies, but map them for remote UI as follows:

```text
observe + low_risk                         -> safe
requires_confirmation + requires_strong_confirmation -> changing
```

A Telegram confirmation of an exact normalized changing action satisfies the
remote user-visible confirmation. The Device Agent still passes the correct
internal confirmation flag to the existing Tool Gateway.

Tests:

- extend `scripts/testToolGateway.js`;
- add `scripts/testRemoteProtocol.js`;
- add `scripts/testToolPolicyMapping.js`;
- rerun plan normalizer and Desktop Agent tests.

Exit criterion: current local commands behave exactly as before, and remote
protocol data can be validated without importing Electron.

## Milestone 1: DE-4 Infrastructure

### Task 1.1: Create deployment definitions

Add:

- `deploy/docker-compose.yml` with `postgres`, `server`, and optional worker
  profiles; do not add Redis, RabbitMQ, Qdrant, or MinIO;
- `deploy/postgres/001-extensions.sql` enabling pgvector;
- `deploy/Caddyfile` exposing only HTTPS/WSS application routes;
- `deploy/env.example` listing variable names with empty/example values;
- health checks and bounded container memory/CPU settings;
- named volumes for PostgreSQL and document storage.

PostgreSQL is never published on a public host port. Use a local directory or
Docker volume for documents; metadata and ownership stay in PostgreSQL.

### Task 1.2: Add Ubuntu 22.04 bootstrap documentation/scripts

Add idempotent or check-before-change scripts under `deploy/scripts/` for:

- system update;
- non-root deploy user and SSH-key-only access;
- Docker repository and Compose plugin;
- Caddy;
- ffmpeg, PostgreSQL client, and restic;
- UFW rules for SSH and HTTP/HTTPS;
- unattended security updates;
- swap as an emergency buffer, not normal model memory.

Do not run these scripts against the server until the exact DE-4 IP is verified
and the user explicitly begins deployment.

### Task 1.3: Add operations checks

Add `deploy/scripts/preflight.sh` and `deploy/scripts/smoke.sh` to verify CPU,
RAM, disk, DNS, TLS, container health, database connectivity, and that
PostgreSQL is not publicly reachable.

Exit criterion: a clean Ubuntu 22.04 test host can start PostgreSQL and a stub
health endpoint, and restart them without losing data.

## Milestone 2: Server Skeleton, Database, and Telegram Text Slice

### Task 2.1: Create the CommonJS server package

Add:

- `server/src/config/loadConfig.js` with strict environment validation;
- `server/src/app.js` building Fastify without listening, for tests;
- `server/src/index.js` handling start, signals, and graceful shutdown;
- `/health/live` and `/health/ready` endpoints;
- structured logs with token/secret redaction.

Keep startup free of model downloads and database-destructive actions.

### Task 2.2: Implement SQL migrations

Create a minimal migration runner and migrations for:

- users and external identities;
- conversations and messages;
- devices, capabilities, sessions, and pairing codes;
- commands, steps, confirmations, and audit events;
- memories and memory versions;
- documents and document chunks;
- PostgreSQL-backed jobs.

Use database constraints, foreign keys, and user-scoped indexes. Store hashes of
device tokens, never plaintext tokens. Add migration tests against disposable
PostgreSQL.

### Task 2.3: Add Telegram identity and text handling

Add modules under `server/src/telegram/` for:

- long-polling lifecycle;
- allowlist enforcement before any persistence or model call;
- Telegram identity to internal user mapping;
- `/start`, `/help`, `/devices`, `/memory`, and text message handling;
- typing/error states without leaking provider details.

Persist the incoming message before dispatch and the final answer after
completion. Deduplicate Telegram update IDs so restart/retry cannot execute an
action twice.

### Task 2.4: Add a temporary deterministic echo/provider stub

Implement a fake model adapter for tests and a simple echo response in local
development. Do not require OpenRouter to test identity and persistence.

Tests:

```text
server/test/config.test.js
server/test/migrations.test.js
server/test/telegramAllowlist.test.js
server/test/telegramDeduplication.test.js
server/test/userIsolation.test.js
server/test/conversationPersistence.test.js
```

Exit criterion: two test Telegram identities receive separate persistent text
conversations, and a third identity is rejected without a database user.

## Milestone 3: Model Gateway and Basic Answers

### Task 3.1: Extend the Python provider abstraction

Modify/add:

- `agent_runtime/llm/agent_provider.py` to preserve the current Gemini desktop
  provider while delegating new providers;
- `agent_runtime/llm/openai_compatible_provider.py` for Salad/OpenRouter;
- `agent_runtime/llm/provider_router.py` for `salad`, `openrouter`, `auto`, and
  `manual` modes;
- `agent_runtime/llm/provider_capabilities.py` for text, vision, thinking,
  tools, and context metadata;
- `agent_runtime/tests/test_provider_router.py`.

All secrets come from environment variables. Provider configuration contains
endpoint URL, model name, timeouts, retry count, and capability flags, but no
key values.

### Task 3.2: Add cloud chat protocol messages

Extend `agent_runtime/client_protocol.py` and `agent_runtime/server.py` with a
backward-compatible cloud chat request carrying:

- task and conversation IDs;
- system instructions;
- recent messages;
- retrieved memories/documents;
- available tools/device context;
- selected provider policy.

Extract the reusable subprocess mechanics from `agents/desktopAgentClient.js`
into a pure client module only if tests show this can be done without altering
the existing Desktop Agent contract. Otherwise add a server-specific client
that speaks the same JSON-lines protocol.

### Task 3.3: Connect OpenRouter first

Wire Telegram text messages through the Python runtime and Model Gateway to
OpenRouter. Enforce timeouts, one bounded retry, response length limits, and a
friendly failure result. Keep conversation state in PostgreSQL; provider calls
remain stateless.

Tests cover missing key, bad endpoint, timeout, malformed response, provider
selection, and successful fake transport. A configured-key smoke test is
manual and must not run in CI.

Exit criterion: an allowed Telegram user receives a real model answer through
OpenRouter, and provider failure does not lose the incoming message.

## Milestone 4: Layered Memory and Private Knowledge Base

### Task 4.1: Implement conversation context assembly

Add `server/src/conversations/contextBuilder.js` with explicit token/character
budgets for:

- recent verbatim messages;
- current conversation summary;
- durable profile facts;
- episodic memories;
- retrieved document chunks.

Never load another user's rows before ranking. Add tests that plant similar
documents for two users and prove retrieval remains isolated.

### Task 4.2: Implement memory extraction and versioning

Add:

- `server/src/memory/memoryService.js`;
- `server/src/memory/memoryExtractor.js`;
- `server/src/memory/conversationSummarizer.js`;
- `server/src/memory/memoryCommands.js`.

Support explicit remember, forget, correct, and list operations. Automatic
promotion accepts only structured model output and stores source references,
confidence, and validity. A correction supersedes a prior value rather than
silently deleting history. Add a denylist/classifier for authentication and
financial secrets before persistence.

### Task 4.3: Add document ingestion

Telegram accepts an initial bounded set: TXT, Markdown, PDF, and DOCX. Enforce
per-file and per-user size limits before download. Store files under opaque IDs,
not user-provided paths.

The document worker:

- extracts text;
- normalizes encoding;
- chunks with source/page metadata;
- produces multilingual embeddings using `BAAI/bge-m3` as the initial model;
- writes vectors to pgvector;
- records failed/unsupported files without exposing another user's data.

Use PostgreSQL full-text search plus vector similarity and reciprocal-rank
fusion. OCR and image-only PDFs remain out of scope.

### Task 4.4: Add citations and deletion

Answers based on documents include document name and page/chunk references.
Deleting a document removes its chunks, vector rows, and stored file through a
transactional job. Add `/documents` and document-delete confirmation in
Telegram.

Exit criterion: two users can upload identically named private documents and
receive only their own sourced answers; memory survives a server restart and a
conversation-context rollover.

## Milestone 5: Server Voice

### Task 5.1: Define the ASR worker protocol

Create `server_runtime/worker_protocol.py`, `asr_worker.py`, and a Node client
under `server/src/voice/`. Protocol operations include ready, transcribe,
health, cancel, result, and error. Limit the initial worker to one active
transcription and a bounded PostgreSQL job queue.

Telegram audio is downloaded to a restrictive temporary path, normalized with
ffmpeg to mono 16 kHz, transcribed, and deleted in a `finally` path. Store the
transcript, not raw audio.

### Task 5.2: Benchmark before selecting the runtime

Add `server_runtime/bench_asr.py` and a fixed manifest format for the user's
Russian samples. Benchmark on the actual DE-4:

- Qwen3-ASR 1.7B official BF16/CPU path;
- an approved Q4 CPU build if licensing and integrity checks pass;
- Faster Whisper Medium INT8 CPU as fallback;
- optionally Qwen3-ASR 0.6B if 1.7B misses latency targets.

Measure model-load RAM, peak RAM, cold/warm latency, real-time factor, command
word error, names/application aliases, noise, and two queued requests.

Acceptance target for the selected MVP ASR:

- median post-utterance latency no more than 3 seconds for 3-7 second commands;
- p95 no more than 6 seconds with no competing system load;
- server total memory stays below 85%;
- no cross-job audio/result mix-up;
- accuracy is acceptable on the user's command corpus.

If Qwen3-ASR 1.7B misses the target, keep the interface and select the measured
fallback. Do not hide the benchmark result.

### Task 5.3: Add optional server TTS

Adapt the existing Silero/Piper provider boundary for Linux or add a narrow
server worker. Telegram users can select text-only or voice response. TTS jobs
must not block text delivery or ASR.

Exit criterion: a voice message is transcribed and answered while the owner's
PC is off; temporary audio is absent after success, timeout, and cancellation.

## Milestone 6: Salad Gemma Provider

### Task 6.1: Build the Salad inference image

Add a separate deployment directory, for example `deploy/salad/`, containing:

- a pinned container definition;
- Gemma 4 12B Q4 model/runtime configuration;
- an OpenAI-compatible text/vision endpoint;
- health and readiness endpoints;
- conservative context, concurrency-one, and memory limits;
- no database, user documents, or long-term state inside the GPU container.

Pin model revision and runtime versions. Model licensing acceptance and
registry credentials happen outside source control.

### Task 6.2: Implement Salad health and switching

Add owner-only Telegram settings to display and change provider mode without
showing secrets. `auto` mode tries Salad first and falls back to OpenRouter only
for retry-safe model calls. A tool mutation is never automatically replayed on
another provider.

### Task 6.3: Verify model behavior

Create an evaluation set for Russian answers, memory grounding, document
citations, strict JSON plans, tool selection, refusals, and image input. Record
Gemma context limits and cold-start behavior in deployment docs.

Exit criterion: manual switching and safe automatic fallback preserve the
conversation and produce valid tool plans; provider changes never duplicate a
device action.

## Milestone 7: Windows Device Enrollment and Presence

### Task 7.1: Add generated device identity state

Add:

- `agents/deviceIdentity.js` for pairing state and token persistence;
- `agents/deviceConnection.js` for outbound reconnecting WSS;
- `agents/deviceCapabilities.js` derived from the local Tool Gateway;
- `data/device-identity.local.json` to `.gitignore`.

Use exponential backoff with jitter, heartbeat, server certificate validation,
and explicit token-revoked handling. Do not open an inbound PC port.

### Task 7.2: Add server enrollment and socket hub

Add modules under `server/src/devices/` for:

- one-time pairing codes with short expiry and single use;
- hashed long random device tokens;
- authenticated WSS upgrade;
- one live session per device identity;
- capabilities, heartbeats, last-seen, and disconnect reason;
- owner-only list, rename, default, and revoke commands in Telegram.

### Task 7.3: Add minimal Electron pairing UI

Add a small settings section through explicit preload/IPC contracts. It shows
unpaired, connecting, online, revoked, and error states; accepts only the
pairing code and device name; and never renders the stored token.

Keep `main.js` changes to lifecycle wiring. Put connection behavior in focused
modules. Verify the renderer visually.

Exit criterion: a Windows PC pairs to one user, reconnects after Electron and
server restarts, appears online in Telegram, and becomes unusable immediately
after revocation.

## Milestone 8: Remote Agent Orchestration and Commands

### Task 8.1: Add a cloud assistant LangGraph

Add:

- `agent_runtime/graphs/cloud_assistant_graph.py`;
- `agent_runtime/schemas/cloud_state.py`;
- protocol events for clarification, tool request, observation, confirmation,
  final answer, and bounded failure;
- per-task maximum eight model/tool steps.

The graph receives already user-scoped context and declared capabilities. It
cannot invent an undeclared tool. Keep desktop-specific local graph behavior
unchanged.

### Task 8.2: Implement server command dispatcher

Add `server/src/commands/` modules to:

- resolve explicit/default devices;
- ask on ambiguity;
- validate ownership and current capabilities;
- normalize exact action arguments;
- persist command and step state before dispatch;
- correlate one device result to one step;
- return observations to LangGraph;
- stop on non-retryable failure;
- never replay a changing step after disconnect/restart.

### Task 8.3: Implement originating-channel confirmation

Add `server/src/confirmations/confirmationService.js` and Telegram inline
buttons. Store a hash over user, chat, command, device, action, normalized
arguments, and two-minute expiry. On approval, atomically mark the confirmation
used before dispatch.

Map both existing confirmation and strong-confirmation Tool Gateway actions to
the single remote `changing` confirmation UX. Preserve the Tool Gateway's
internal policy checks.

### Task 8.4: Add tools incrementally

Release order:

1. device/system observation;
2. file search/list and app/window resolve;
3. safe open/reveal/focus operations;
4. file create/copy/move/rename/delete-to-recycle-bin;
5. app close and window mutation;
6. permanent delete/batch operations only after separate destructive-path
   tests, while still appearing as `changing` to the user.

Each action needs a schema test, ownership test, confirmation test if changing,
device-offline test, and real Windows smoke test before enabling it remotely.

Exit criterion: the acceptance safe and changing commands execute only on the
requesting user's selected PC, with actual results returned to Telegram.

## Milestone 9: Backups and Operations

### Task 9.1: Implement encrypted off-server backup

Add `deploy/backup/` scripts and systemd timer definitions for:

- consistent `pg_dump`;
- document snapshot;
- restic encryption and off-server upload;
- daily/weekly retention;
- success/failure reporting without secrets.

Add a restore script that targets an explicitly named empty test database and
directory. Never make the production restore path the default.

### Task 9.2: Add operational visibility

Expose owner-only health summaries: database, Telegram, ASR queue/worker,
provider health, Device Agent sessions, disk, backup age, and memory pressure.
Set bounded log rotation. Do not add a separate monitoring stack in MVP.

### Task 9.3: Schedule Ubuntu migration

Document an Ubuntu 22.04-to-newer-LTS rehearsal and deadline before standard
support ends in 2027. Validate the full compose stack and restore procedure on
a replacement host rather than relying on an untested in-place production
upgrade.

Exit criterion: backups restore to a clean environment, and model/voice services
remain usable under expected system load.

## Milestone 10: End-to-End Acceptance and Release

Create `server/test/acceptance/` fixtures and a manual release checklist that
demonstrate all ten design acceptance criteria:

1. two users remain isolated;
2. voice works with the owner's PC off;
3. private document answers include sources;
4. safe remote action returns a real result;
5. changing action requires a single-use origin confirmation;
6. offline/ambiguous devices never receive guessed execution;
7. Salad/OpenRouter switching preserves context;
8. server restart preserves state without replaying mutations;
9. encrypted backup restores successfully.

Run the full relevant local Jarvis regression suite, server Node tests, Python
tests, migration tests, container smoke tests, and manual Windows pairing/tool
smoke. Record exact versions and benchmark results in
`docs/operations/family-cloud-assistant-runbook.md`.

Tag the MVP only after the restore test and cross-user isolation tests pass.

## Recommended Commit Boundaries

Use small commits that correspond to verified vertical work:

1. shared tool/protocol contracts;
2. server/infra skeleton;
3. database and Telegram identity;
4. OpenRouter model gateway;
5. memory and document retrieval;
6. ASR benchmark and selected server voice provider;
7. Salad Gemma provider;
8. device enrollment and WSS presence;
9. safe remote tools;
10. changing actions and confirmations;
11. backup operations;
12. acceptance/runbook.

Never mix generated model files, local identities, user documents, secrets, or
unrelated dirty-worktree changes into these commits.

## Immediate Next Action

After approving the dependency checkpoint, begin only Milestone 0 and
Milestone 1 locally. In parallel, the user can purchase/provision DE-4 with
Ubuntu 22.04, point a domain to it, and collect the Telegram/OpenRouter
credentials. Do not deploy remote mutations or copy personal documents until
identity isolation, TLS, backups, and restore are verified.
