# Проверки перед выпуском

Выбирай проверки для изменённых компонентов. Результаты реального клиента записывай отдельно от тестов. Порядок публикации находится в [руководстве по выпуску](release-workflow.md).

## Commands and Verification

Windows client:

Use Node.js 22.12+ (verified on 24.14.1). For a fresh dependency installation,
use `npm run setup`: it performs locked `npm ci`, handles the Windows ffi-napi
installer probe, and separately verifies native module loading and Electron.
Do not replace this with globally disabled dependency scripts or copied native
binaries. Both the installed client and its wake-word Node runtime must be
checked when updating Electron or native dependencies. Electron Builder must keep
`npmRebuild: false`: Vosk runs in the bundled Node process, so rebuilding its
native modules for Electron targets the wrong runtime.

```powershell
npm run setup
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

Job browser collector integration (opt-in, isolated PostgreSQL fixture only):

```powershell
npm ci --prefix job-browser
# Set JARVIS_JOB_TEST_DATABASE_URL to the dedicated local test cluster.
# Optional PLAYWRIGHT_CHANNEL=msedge uses installed Edge in headless mode.
npm run test:jobs:browser --prefix server
```

This test runs the real Chromium reader, authenticated HTTP RPC and collector
against a unique PostgreSQL fixture schema. HH pages are intercepted fixtures;
no live HH requests, model calls, Telegram messages or applications are sent.
Pinned DE Chromium/runtime acceptance commands are in
[job-browser/README.md](../job-browser/README.md).

HH captcha recovery adds Linux-only `captchaRecoveryAcceptance.cjs` and
`captchaHttpsAcceptance.cjs` in `job-browser/test`. Run them with the pinned
Chromium image, sandbox and disposable tmpfs, never with the owner's profile.
The HTTPS test uses `--network none --add-host hh.ru:127.0.0.1` and an ephemeral
fixture certificate; it exercises actual route.fetch, cookies and 307/308 handling.
The worker is tested separately without network or credentials; see
[job-ocr/README.md](../job-ocr/README.md). Real PostgreSQL coverage is
`node --test test/jobCaptchaAcceptance.cjs` inside `server`, with a dedicated
local test database. It applies the forward-only attention migration and checks
delay, checkpoints, deduplication and owner/private-chat delivery.

Confirmed browser applications require Linux durable-file semantics. Run the
disposable test-only stack, which builds from both lockfiles and uses an internal
network, tmpfs PostgreSQL and HH-shaped intercepted pages:

```powershell
docker compose -p jarvis-job-apply-acceptance -f deploy/job-browser/compose.acceptance.yml up --build --abort-on-container-exit --exit-code-from acceptance
docker compose -p jarvis-job-apply-acceptance -f deploy/job-browser/compose.acceptance.yml down
```

It exercises the real Telegram job handler, server runtime, PostgreSQL intent,
authenticated write RPC, Chromium native-form driver and Linux journal. A lost
acknowledgement is reconciled after restart against the original exact letter.
It has no production env file, account volume, host ports or live HH application.

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

