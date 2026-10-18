# Проверки перед выпуском

Более новая проверка browser от 18 октября:
[приватный журнал попыток](updates/2026-10-18-hh-captcha-evidence.md), Linux 62/62,
все шесть browser/broker/worker сценариев с архивом PNG/ответов. Приведённое ниже
описание первоначального этапа с двумя попытками сохраняет историю.

Newer browser verification on 18 October:
[private attempt evidence](updates/2026-10-18-hh-captcha-evidence.md), Linux 62/62
and all six browser/broker/worker scenarios with persisted PNG/answer evidence.
The initial two-attempt stage below is retained as history.

## Дообученный OCR HH: локальные проверки 18 октября 2026

Этот раздел описывает локальный этап. Более новый результат —
[Linux установка и живая попытка](updates/2026-10-18-hh-trained-ocr-release.md):
browser 56/56 без skips, OCR worker 10/10, изолированный UNIX socket и ресурсы
проверены; текущая реальная попытка остановилась после unknown с отправкой фото.
Release-status с Compose overlays проверен 15 тестами.

This section records the local stage. The newer linked release covers Linux
browser 56/56 without skips, OCR worker 10/10 and isolated socket/resource checks.
The actual attempt stopped as unknown and sent a human photo. Compose-overlay
release verification passed 15 tests.

```powershell
npm test --prefix job-browser
npm test --prefix server
python deploy/scripts/test-job-captcha-config.py
& 'F:/OCR Learning/PaddleOCR/.venv/Scripts/python.exe' -m unittest discover -s job-ocr -p 'test_*.py' -v
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:JARVIS_FROZEN_TEST_PYTHON='F:/OCR Learning/PaddleOCR/.venv/Scripts/python.exe'
$env:JARVIS_FROZEN_TEST_PNG='F:/test/jarvis/data/hh-ocr-evaluation/transport.png'
node --test job-browser/test/captchaAutomaticAcceptance.cjs
```

Последняя команда всегда проверяет browser/broker/photo-worker на фикстурах;
при указанных двух переменных дополнительно использует настоящий CPU recognizer
и PNG, извлечённый canvas браузера. До запуска подготовь bundle по
[`job-ocr/README.md`](../job-ocr/README.md), исходный PNG должен быть локальным
примером 250×90. Контекст браузера принудительно offline; ответы HH и Bot API
подменены. Успехи с первой/второй попытки, два отказа, unknown/redirect и одна
доставка фото проверяются через настоящий broker/client/worker. Unit tests
покрывают durable restart, повтор картинки, лимит, старые states, scope,
предварительное отсутствие уведомления и исключение общего OCR backend.

[`Результаты`](updates/2026-10-18-hh-trained-ocr-development.md) отделяют GPU
оценку 1 709 изображений и CPU PNG parity 73/73 от ещё не выполненных Linux
сборки, resource-limit/socket/metadata проверок и реальной приёмки Telegram/HH.
Новые production зависимости не установлены. Desktop не затронут.

The last command always exercises browser/broker/photo-worker fixtures and,
when both variables are provided, also the real CPU recognizer on browser-canvas
PNG pixels. Prepare the ignored bundle first and supply a local 250×90 PNG.
The browser context is forcibly offline; HH responses and Bot API delivery are
synthetic. Tests cover first/second success, two rejections, unknown/redirect
stop and one photo, with unit coverage for durable restart, repeated images,
budgets, legacy state, scopes, early-notification suppression and model identity.
The linked record distinguishes 1,709-image GPU evaluation and 73/73 CPU PNG
parity from pending Linux build/resource/socket checks and live Telegram/HH
acceptance. Production dependencies are not installed; Desktop is unaffected.

Выбирай проверки для изменённых компонентов. Результаты реального клиента записывай отдельно от тестов. Порядок публикации находится в [руководстве по выпуску](release-workflow.md).

## Commands and Verification

Audit remediation F01–F13 (local development, 2026-10-17):

```powershell
npm test --prefix server
node --test cloud/*.test.js voice/cloudVoiceService.test.js tts/windowsSapiService.test.js
$env:PYTHONPATH='host-agent'
$env:PYTHONDONTWRITEBYTECODE='1'
python -m unittest discover -s host-agent/tests
node scripts/testDesktopIpcBoundary.js
node scripts/testVoiceOverlayContract.js
node scripts/testToolGateway.js
node scripts/testVisionIpc.js
node scripts/testVisionMediaPermission.js
node scripts/checkCloudPackageAssets.js
$env:PLAYWRIGHT_CHANNEL='msedge'
node scripts/testLifeDialogCancellation.cjs
node scripts/testOperationsServiceDialog.cjs
node scripts/testOperationsBootstrap.cjs
npm test --prefix ops-ui
npm run build --prefix ops-ui
```

Browser fixtures используют существующий Playwright из `job-browser/node_modules`
и Edge (либо явно заданный `PLAYWRIGHT_CHANNEL`). Operations tests запускают и
останавливают собственные локальные Vite; все API синтетические, реальные
изменяющие действия не выполняются. Server suite включает регрессии subscription
logs, streaming downloads, journal-to-server unknown, lifecycle и store bounds.
Три Linux filesystem/metadata теста Host Agent пропускаются на Windows.
Полный server suite в Linux image запускается с `TZ=Europe/Moscow`: существующий
тест commitment проверяет локальные часы через `getHours()`. После установки
Host Agent запускай тесты из полного source tree с `PYTHONPATH=/opt/jarvis-host-agent`,
чтобы проверить установленные модули и сохранить доступ к repository fixtures.
Живые Electron/PostgreSQL, production shutdown и клиентские действия проверяются
отдельно после согласованного выпуска. [Результат](updates/2026-10-17-audit-remediation-development.md).

Browser fixtures use the existing Playwright in `job-browser/node_modules` and
Edge (or an explicit `PLAYWRIGHT_CHANNEL`). Operations tests start and stop their
own local Vite servers; all API responses are synthetic and no real mutations
run. The server suite includes subscription logging, streaming downloads,
journal-to-server unknown outcomes, lifecycle and store-bound regressions.
Three Host Agent Linux filesystem/metadata tests skip on Windows. The full
server suite in a Linux image uses `TZ=Europe/Moscow`: an existing commitment
test asserts local hours with `getHours()`. After Host Agent installation, run
tests from the complete source tree with `PYTHONPATH=/opt/jarvis-host-agent`
so installed modules and adjacent repository fixtures are both available. Running
Electron/PostgreSQL, production shutdown and actual client actions require
separate checks after an authorized release. [Results](updates/2026-10-17-audit-remediation-development.md).

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

Button-based job settings (local development, 2026-10-16):

```powershell
node --test server/test/jobSettingsPanel.test.js server/test/migrations.test.js server/test/telegramInteractionRepository.test.js
# Dedicated disposable PostgreSQL only; set JARVIS_JOB_TEST_DATABASE_URL:
npm run test:jobs:settings --prefix server
npm run test:jobs:postgres --prefix server
```

Проверка применяет migration 036 и проходит через настоящие message/menu handlers:
все поля, предустановки/свой ввод, списки моделей и фраз, добавление/удаление,
пагинация, минимум один запрос, предел списка, отсутствие записи до подтверждения,
неизменные значения, retry/consumption/expiry/revision, отмена навигацией,
чужие user/chat/conversation и duplicate update. Старый pending редактор сохранён.
Ни AI, ни HH в этих проверках не вызываются; реальный Telegram UI проверяется отдельно.

The fixture applies migration 036 through actual message/menu handlers and covers
all fields, presets/custom values, configured model choices, phrase lists and
pagination, addition/removal, minimum/maximum list bounds, explicit confirmation,
no-op choices, retry/consumption/expiry/revision, navigation cancellation, foreign
scopes and duplicate updates. Legacy pending editors stay compatible. No AI or HH
calls occur; actual Telegram UI acceptance remains separate.

HH history tracking (local development, 2026-10-16):

```powershell
node --test server/test/jobHistory.test.js
# Requires JARVIS_JOB_TEST_DATABASE_URL pointing to a disposable test PostgreSQL:
npm run test:jobs:history --prefix server
npm run test:jobs:postgres --prefix server
# Headless Chromium fixtures, no live HH calls:
$env:PLAYWRIGHT_CHANNEL='msedge'
npm run test:history --prefix job-browser
```

Реальный PostgreSQL и настоящие Telegram handlers проверяют migration 035,
старую историю, разные резюме, статусы, идемпотентность, lease/restart/CAPTCHA,
неполную пагинацию, чужой scope и сохранение unknown. Chromium fixtures проверяют
закрытое чтение, отсутствие переходов в чаты и изменений HH. Четыре прежних
browser-теста Linux filesystem/durable-state пропускаются на Windows;
их нельзя считать пройденными. Полная проверка runtime migrations требует pgvector.

Real PostgreSQL and actual Telegram handlers exercise migration 035, historical
records, multiple resumes, states, idempotency, leases/restarts/CAPTCHA, incomplete
pagination, foreign scope and preserved unknown operations. Chromium fixtures verify
bounded reads without chat navigation or HH mutations. Four existing Linux filesystem
tests skip on Windows; a full runtime migration check also needs pgvector.

Cover-letter modes (local development, 2026-10-16):

```powershell
node --test server/test/jobLetterModes.test.js server/test/jobTelegram.test.js server/test/jobModelAdapter.test.js
# Dedicated disposable PostgreSQL only; no live HH/model/Telegram calls:
node --test server/test/jobLetterModesAcceptance.cjs
npm run test:jobs:postgres --prefix server
```

Проверка применяет migration 034 и настоящие message/menu handlers с interaction
repository: четыре режима, пустой профиль, факты/примеры в обоих AI-режимах,
сохранение/замена базового, отсутствие вызова модели и расходов в ручных режимах,
invalid retry, closed context, single consumption, expiry, чужие scopes,
ревизии и неизменный текст в подтверждении отправки. Unknown не повторяет POST.
Модель и HH в этих проверках подставные; реальные Telegram-нажатия и HH-отклик
проверяются отдельно после разрешённого выпуска.

The fixture applies migration 034 and actual message/menu handlers with the real
interaction repository. It covers all four modes, optional facts/examples,
source-aware AI inputs, base replacement, no model calls or usage in manual modes,
invalid retry, closed contexts, single consumption, expiry, foreign scopes,
revisions, exact-text confirmation and original-ID unknown reconciliation.
Model and HH responses are fixtures; live Telegram/HH acceptance remains separate.

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

Telegram human CAPTCHA checks:

```powershell
npm test --prefix job-browser
py deploy/scripts/test-job-captcha-config.py
node --test server/test/jobTelegramCaptcha.test.js
```

Run browser tests on Linux for durable-file semantics without skips. Explicit
`job-browser/test/captchaTelegramAcceptance.cjs` uses the pinned sandboxed
Chromium image with `--network none --add-host hh.ru:127.0.0.1` and an isolated
profile. It checks image-only bounded PNG, exact form/key binding, stale pictures,
native XHR, durable duplicate/unknown protection and read-only target verification.
`manualRuntimeAcceptance.cjs` checks the headless runtime and persisted pause;
`captchaTelegramRuntimeAcceptance.cjs` proves a fresh CAPTCHA handover delivers
the first human picture without starting legacy OCR or sending an answer POST.
Both runtime helpers require a fresh empty tmpfs at `/home/pwuser/profile`, owned by the browser
user with mode0700, never an account volume. Retain the production seccomp,
capabilities and resource policy. No Xvfb/VNC/noVNC image is needed.

Run `server/test/jobTelegramCaptchaAcceptance.cjs` separately with
`JARVIS_JOB_TEST_DATABASE_URL` pointing to a dedicated test PostgreSQL database.
The unique fixture schema applies the forward-only migration and checks real
message/menu routing, private owner/chat/conversation scope, atomic reply
consumption, expiry/replacement/replay, unknown photo ACK and no AI/history use.
Then run the focused Telegram gate in the menu contract and full server tests.

Resilience regressions (local update, 2026-10-16):

```powershell
node --test server/test/jobCaptchaResilience.test.js server/test/jobTelegramCaptcha.test.js
# Dedicated disposable PostgreSQL only:
node --test server/test/jobCaptchaResilienceAcceptance.cjs server/test/jobTelegramCaptchaAcceptance.cjs
```

The PG fixture applies migration 033 and checks retained/concurrent refresh,
old-photo invalidation, expired send leases, same-row retry, unknown answer,
notification dedup/revoked identity/changed scope and retirement of stale notices.
Browser unit regressions are `browserHealth.test.js` and `captchaPageRecovery.test.js`.
The isolated HTTPS `captchaTelegramAcceptance.cjs` deliberately crashes its own
renderer using a test-only CDP session, verifies `isClosed() === false`, explicit
refresh and a fresh tab with no duplicate POST. This test does not enable a runtime
CDP listener. `manualRuntimeAcceptance.cjs` checks failed Chromium health;
`browserFatalRuntimeAcceptance.cjs` kills only its own fixture Chromium child,
checks main-process exit, restart with the original pause/claims and normal stop.
Each runtime test needs its own fresh private tmpfs profile and no real account.

The normalized Compose policy checker in [deploy instructions](../deploy/README.md)
checks distinct CAPTCHA credentials only on server/browser, explicit flags on
all three jobs services, preserved external profile, and absence of HH gateway,
manual network and host ports. Never print or save secret-bearing Compose JSON.
Release verification checks that only the retired HH Serve handler, proxy units,
gateway container and empty private network were removed; unrelated Tailscale
routes/services remain. Real owner photo delivery/reply and resumed HH reading
are live acceptance, separate from fixtures.

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

