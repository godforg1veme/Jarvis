# Проверки перед выпуском

Выбирай проверки по изменённым компонентам. Начинай с узкого набора, затем
проверяй соседние сценарии. Команды ниже не означают, что проверки уже выполнены.
Результаты запусков и развёртывания хранятся в [updates](updates/), прежняя
подробная хроника — в [архиве](history/2026-10-23-verification.md).
Порядок публикации: [release-workflow.md](release-workflow.md).

## Выбор проверок

### Shared instructions and Tavily MCP

Проверки новой функциональности запускаются без настоящих ключей и отправки
отклика. MCP transport проверяется с настоящим SDK и локальными сетевыми
ответами, чтение резюме с локальным Edge/Chromium fixture. PostgreSQL URL ниже
нужно задать только для изолированной тестовой базы.

```powershell
node --test server/test/instructionFiles.test.js server/test/sharedInstructions.test.js server/test/tavilyMcpClient.test.js server/test/webSearchService.test.js server/test/telegramManualText.test.js
node --test server/test/searchPrivacy.test.js
node --test server/test/jobResumeContext.test.js server/test/jobDraftAcceptance.cjs server/test/jobLetterModesAcceptance.cjs server/test/jobTelegramAcceptance.cjs
node --test job-browser/test/hhResumeReader.test.js
npm test --prefix server
npm test --prefix job-browser
```

Поведение `job_draft_manual_edit` проверяется через настоящие message/menu
handlers и PostgreSQL CHECK 046: сохранение полного текста, invalid retry,
scope, expiry, single consumption, stale confirmation и отсутствие AI-вызова.
Фикстуры не подтверждают реальный Tavily аккаунт, страницу HH или нажатие
Telegram. Живой поиск допускается после настройки бесплатного ключа без
PAYGO; значение ключа и содержимое ответа не выводятся в diagnostics.

Один живой basic-запрос к Tavily после настройки бесплатного аккаунта:
`node server/scripts/tavilySmoke.cjs --key-file deploy/secrets/tavily-api-key`.
Файл ключа игнорируется Git. Скрипт выводит только статус, число источников
и длительность; пустой ключ возвращает `key_required` без сетевого обращения.

### Остальные компоненты

| Изменение | Основной маршрут |
| --- | --- |
| Server | `npm test --prefix server`; отдельная PostgreSQL acceptance для затронутого контракта |
| Telegram | [Required regression gate](telegram-menu-contract.md#required-regression-gate), затем полный server suite перед выпуском |
| HH | Нужный раздел ниже, browser suite и изолированная PostgreSQL; Linux нужен для durable-file semantics |
| Desktop | `test:core`, IPC/package/browser проверки, затем живой установленный клиент |
| Mini App / Operations | Tests/build и browser fixtures; реальный вход и права проверяются отдельно |
| Host Agent | Linux unittest из полного source tree; клиентские changing actions отдельно |
| Только документация | Ссылки, anchors, сохранность правил и команд; runtime suite обычно не нужен |

PostgreSQL acceptance использует только отдельную тестовую БД, никогда production.
Переменные подключения задавай приватно. Пропуск теста без БД не считается
успешной проверкой. Fixtures не доказывают работу настоящих HH, Bot API,
Electron, устройств или VPS; эти результаты записывай отдельно.

## Восстановление HH CAPTCHA / HH CAPTCHA recovery

Свежий сбор и ежедневная сверка 25 октября: [выпуск и ограничения](updates/2026-10-25-hh-three-lane-release.md).
Миграции 047/048 входят в job fixture. Проверяй все три прохода, общий lease, pause/revision,
отзыв jobs, приоритет queued карточек, неизменность sent/unknown и сохранность
периодов при head refresh/уплотнении. Chromium/RPC тесты используют локальные
HTML fixtures и отдельную PostgreSQL; они не измеряют нагрузку настоящей HH/VPS.
Ежедневная сверка должна находить старую поздно проиндексированную вакансию,
повторять всю глубину на следующий цикл и сохранять пробелы без успешного checkpoint.

Fresh collection and daily reconciliation, October 25: [release and limitations](updates/2026-10-25-hh-three-lane-release.md).
The job fixture includes migrations 047/048. Verify all three lanes, shared leases,
pause/revision, current jobs access, queued-card priority, sent/unknown preservation
and retained ranges during head refresh/compaction. Chromium/RPC tests use local
HTML fixtures and disposable PostgreSQL; they do not measure live HH/VPS load.
Daily reconciliation must find late-indexed old listings, repeat the full range
on the next cycle and preserve gaps without advancing a successful checkpoint.

```powershell
node --test server/test/jobFreshProgress.test.js server/test/jobCollectionScheduler.test.js
node --test server/test/jobReconciliationProgress.test.js
# JARVIS_JOB_TEST_DATABASE_URL: isolated test database only.
node --test server/test/jobFreshRepositoryAcceptance.cjs server/test/jobFreshCollectionAcceptance.cjs server/test/jobCollectorAcceptance.cjs server/test/jobCollectorAccessPostgresAcceptance.cjs server/test/jobCollectionNoticeAcceptance.cjs
node --test server/test/jobReconciliationRepositoryAcceptance.cjs server/test/jobReconciliationAcceptance.cjs
# Requires job-browser Playwright and installed Chromium or PLAYWRIGHT_CHANNEL=msedge.
node --test server/test/jobFreshBrowserAcceptance.cjs server/test/jobBrowserCollectorAcceptance.cjs
node --test server/test/jobReconciliationBrowserAcceptance.cjs
```

Общий сбор и переход старых курсоров: [ремонт 24 октября](updates/2026-10-24-hh-complete-collection.md).
В отдельной PostgreSQL выполняй `jobCollectorAcceptance.cjs`,
`jobBrowserCollectorAcceptance.cjs`, `jobCaptchaEligibilityAcceptance.cjs`,
`jobCollectionNoticeAcceptance.cjs`, `jobCollectorAccessPostgresAcceptance.cjs`,
`jobCaptchaResilienceAcceptance.cjs` и `jobTelegramCaptchaAcceptance.cjs` из `server/test`.
Browser acceptance включает `hhBrowserAcceptance.cjs` и `captchaTelegramAcceptance.cjs`.
Они проверяют разбиение по МСК, сохранение offsets, роли и неизменность unknown.

Shared collection and legacy cursor migration: [October 24 repair](updates/2026-10-24-hh-complete-collection.md).
Run the seven PostgreSQL acceptance files above in a dedicated database and both
browser acceptance files in Linux. They cover Moscow calendar splits, offsets,
current roles and preservation of uncertain outcomes.

Выпущенный [ремонт 24 октября](updates/2026-10-24-hh-complete-collection.md)
проверяет чтение branded static markup, границы объёма/DOM, отсутствие повторного
ответа после unknown/restart, точный target и закрытые причины ошибок.
Итоговый прогон: server 802/802, Linux browser 103/103, PostgreSQL/RPC 16/16,
Telegram gate 66/66. Проверка eligibility включает 104 активных пользователя;
проверки лимита прохода включают медленный search и медленное чтение карточки.
Linux-прогон выполняется в отдельном контейнере без сети и account volumes;
HTTPS fixture требует только `--add-host hh.ru:127.0.0.1`.

The deployed [October 24 repair](updates/2026-10-24-hh-complete-collection.md)
checks branded static markup, text/DOM bounds, no repeated answer after
unknown/restart, exact target verification and closed error reasons. Linux tests
use a separate networkless container without account volumes; the HTTPS fixture
only needs `--add-host hh.ru:127.0.0.1`.
Final results: server 802/802, Linux browser 103/103, PostgreSQL/RPC 16/16 and
Telegram gate 66/66. Eligibility covers 104 active users; elapsed-time budget tests
cover both a slow search and a slow detail read.

```powershell
node --test job-browser/test/hhBrandedRecovery.test.js job-browser/test/captchaPreparation.test.js
npm test --prefix job-browser
# Linux, isolated container, no production profile; working directory job-browser:
node --test --test-concurrency=1 test/*.test.js test/captchaTelegramAcceptance.cjs
```

## Внутренние экраны Mini App / Mini App interiors

Текущий результат: [выпуск 23 октября](updates/2026-10-23-mini-app-orbital-release.md).
Изменения установлены на DE; Windows, GitHub и оба VPS source сверены.
Живые Telegram/телефон/HH-сценарии остаются отдельным принятием.

Current result: [October 23 release](updates/2026-10-23-mini-app-orbital-release.md).
Deployed to DE; Windows, GitHub and both VPS sources match.
Live Telegram/phone/HH scenarios remain separate acceptance checks.

Локальный этап 23 октября: [результат и таблица покрытия](updates/2026-10-23-mini-app-interiors-development.md).
`testMiniAppInteriors.cjs` проверяет production assets на 320/390/844/1280 px:
диалог, карточки четырёх личных разделов, информационные VPN/Operations,
управление доступом и Jarvis-экраны HH. Пустые списки, фильтры, ошибки,
подтверждения и неизвестный результат проверены с сохранением исходных IDs.
35 PNG остаются в игнорируемой `.superpowers/mini-app-interiors/`.

Local stage, October 23: [results and coverage](updates/2026-10-23-mini-app-interiors-development.md).
The interior suite checks production assets at 320/390/844/1280 px: chat,
four personal lists, informational VPN/Operations, access administration and
Jarvis HH surfaces. Empty lists, filters, errors, confirmations and unknown
outcomes retain original IDs. Thirty-five PNGs remain in ignored local artifacts.

```powershell
npm run build --prefix mini-app
node scripts/testMiniAppInteriors.cjs
node scripts/testMiniAppClient.cjs
node scripts/testMiniAppOrbital.cjs
node scripts/testHhLoginTouch.cjs
npm test --prefix server
```

## Орбитальный Mini App / Orbital Mini App

Локальная реализация 23 октября: [результат и ограничения](updates/2026-10-23-mini-app-orbital-development.md).
Server 792/792 без пропусков, Mini App build, прежние client/preview/HH touch
fixtures и новый орбитальный набор проверяют навигацию, WebGL, движение,
паузу, reduced motion, права, fallback, поиск и панели на 320/390/844/1280 px.
Fixtures не подтверждают настоящий Telegram-вход и FPS физического телефона.

Local implementation, October 23: [results and limits](updates/2026-10-23-mini-app-orbital-development.md).
Server 792/792 without skips, Mini App build and the client/preview/HH touch
and orbital browser suites cover navigation, WebGL, orbital motion, pause,
reduced motion, authorization, fallback, search and panels at 320/390/844/1280 px.
Fixtures do not verify actual Telegram login or physical phone frame rates.

```powershell
npm run build --prefix mini-app
node scripts/testMiniAppClient.cjs
node scripts/testMiniAppOrbital.cjs
node scripts/testHhLoginTouch.cjs
# Existing loopback-only preview: npm run dev --prefix mini-app
node scripts/testMiniAppPreview.cjs
npm test --prefix server
```

## Автоматическая модель писем HH / Automatic HH letter model

Очередь и учёт стоимости, удаление настройки и старого ввода, сохранение фильтров,
генерация и финальное подтверждение письма. [Результат выпуска](updates/2026-10-23-jobs-automatic-model-release.md).

```powershell
npm test --prefix server
# Isolated test PostgreSQL only.
npm run test:jobs:settings --prefix server
node --test server/test/jobDraftAcceptance.cjs server/test/jobLetterModesAcceptance.cjs server/test/jobTelegramAcceptance.cjs
```

## Почасовая история HH / Hourly HH history

Граница часа, все подключённые пользователи с актуальными правами, независимость
от поиска вакансий, checkpoint, архивные/неподтверждённые статусы и исходная дата HH.
[Результат выпуска](updates/2026-10-22-hh-history-hourly-release.md).

```powershell
npm test --prefix server
npm test --prefix job-browser
# JARVIS_JOB_TEST_DATABASE_URL: isolated test database only.
npm run test:jobs:history --prefix server
# Uses the installed Edge on Windows.
$env:PLAYWRIGHT_CHANNEL='msedge'
node --test job-browser/test/historyAcceptance.cjs
```

## HH resume management and default raising

Выбор резюме в боте/Mini App, подтверждение, явный off, unknown и гонки отзыва jobs.
[Результат выпуска](updates/2026-10-22-hh-resume-bot-defaults-release.md).

```powershell
npm test --prefix server
npm run build --prefix mini-app
node scripts/testMiniAppClient.cjs
# JARVIS_JOB_TEST_DATABASE_URL: только отдельная тестовая БД / isolated test DB only.
node --test server/test/jobResumesAcceptance.cjs server/test/jobResumeDefaultsAcceptance.cjs server/test/jobResumeTelegramAcceptance.cjs
```

## Личный вход HH и доступ сборщика

Browser fixtures используют синтетические HH/API и проверяют телефонный ввод.
Отдельная PostgreSQL проверяет роли, персональные allow/deny, блокировку и отзыв.
[Вход](updates/2026-10-21-hh-login-touch-release.md),
[доступ сборщика](updates/2026-10-21-job-collector-access-repair.md).

```powershell
npm run build --prefix mini-app
npm test --prefix server
npm test --prefix job-browser
node scripts/testMiniAppClient.cjs
node scripts/testHhLoginTouch.cjs
# Configure JARVIS_JOB_TEST_DATABASE_URL only for an isolated test database.
node --test server/test/jobMemberConnectionPostgresAcceptance.cjs server/test/miniAppPostgresAcceptance.cjs server/test/miniAppIntegrationAcceptance.cjs
```

```powershell
# Set JARVIS_JOB_TEST_DATABASE_URL privately to an isolated database, never production.
npm run test:jobs:access --prefix server
node --test server/test/jobRuntime.test.js
```

## Operations UI и живой фон

Проверяются девять разделов, WebGL/fallback, CSP и подтверждения сервисов.
Browser fixtures требуют Playwright; FPS физического телефона измеряется отдельно.
[Панель](updates/2026-10-22-orbital-monitoring-release.md),
[фон](updates/2026-10-22-living-sky-release.md).

```powershell
npm test --prefix ops-ui
npm run build --prefix ops-ui
node scripts/testOrbitalOperations.cjs
# Build first; serves production assets under the existing Operations CSP.
node scripts/testOrbitalProduction.cjs
node scripts/testOperationsBootstrap.cjs
node scripts/testOperationsServiceDialog.cjs
# Existing browser suite requires Vite on 127.0.0.1:5179/ops/ and Playwright.
# On Windows: PLAYWRIGHT_CHANNEL=msedge; PLAYWRIGHT_MODULE may select a runtime.
node scripts/testOperationsBrowser.cjs
# Synthetic read-only preview, bound only to loopback:
node scripts/previewOperations.cjs
```

```powershell
node scripts/testLivingSky.cjs
```

## Desktop: core и восстановление

`test:core` использует явный `scripts/coreTestManifest.json`; failed, пустой,
skipped или todo обязательного набора дают ненулевой exit. Новые тесты включаются
в manifest осознанно. PostgreSQL, Linux, browser и live остаются отдельными.
Browser fixtures проверяют 1440×900 и 760×560, доступное имя поля, состояния связи,
восстановление ответа/подтверждения, потерю ack без второго POST, overflow/runtime
errors. Скриншоты идут в игнорируемый `build/desktop-recovery-screenshots/`.
Playwright — тестовая зависимость. [Результат](updates/2026-10-20-desktop-reliability-release.md).

```powershell
npm run test:core
node scripts/testDesktopIpcBoundary.js
node scripts/checkCloudPackageAssets.js
# Uses existing Playwright, with PLAYWRIGHT_CHANNEL=msedge by default:
node scripts/testDesktopRecoveryBrowser.cjs
```

## Московское время и OpenRouter

`JARVIS_MOSCOW_TEST_DATABASE_URL` указывает только на изолированную БД;
fixture создаёт и удаляет собственную схему. Проверяй UI в разных часовых поясах,
а ввод и отображение — по [контракту времени](runtime-context.md#time-display-and-input--отображение-и-ввод-времени).

```powershell
node --test server/test/moscowTimePostgresAcceptance.cjs
```

Для OpenRouter проверяй цены/caps, очередь, квоту, обновление кеша, отсутствие
ключа, подставной transport и запрет повтора action-capable запроса. Живой
контракт проверяется отдельно без вывода секретов; fixtures платного fallback
не подтверждают живую платную генерацию.

```powershell
node --test server/test/openRouterRouting.test.js server/test/providers.test.js server/test/config.test.js
npm test --prefix server
```

## Mini App

Подпись/TTL/membership, отсутствие SDK, успешный fixture-вход и отказ сервера;
[контракт и ограничения](../mini-app/README.md). PostgreSQL tests создают только
свои временные схемы и не обращаются к HH или Bot API. Проверка целевых migrations
не заменяет полный runtime migration check с pgvector.

```powershell
npm run build --prefix mini-app
node scripts/testMiniAppClient.cjs
# Preview server must be running; MINI_PREVIEW_URL may override its address.
node scripts/testMiniAppPreview.cjs
npm test --prefix server
# JARVIS_MINI_TEST_DATABASE_URL must point to an isolated test DB, never production.
node --test server/test/miniAppPostgresAcceptance.cjs server/test/miniAppIntegrationAcceptance.cjs
```

## OCR: изолированные проверки

Подготовь игнорируемый bundle по [job-ocr/README.md](../job-ocr/README.md) и локальный
PNG 250×90. Пути ниже — пример локального тестового окружения. Последняя команда
всегда запускает offline browser/broker/photo-worker fixtures; обе переменные
`JARVIS_FROZEN_TEST_*` добавляют настоящий CPU recognizer на canvas PNG.
HH и Bot API синтетические. Проверяются успехи/отказы, unknown/redirect, одна
доставка фото, restart, повтор изображения, бюджеты, scopes и identity модели;
это не подтверждает прохождение живой CAPTCHA. Linux socket/resource/metadata
проверки описаны отдельно в руководстве worker. [История оценки](updates/2026-10-18-hh-trained-ocr-development.md).

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

Проверки проходят через настоящие message/menu handlers и interaction repository:
готовые/свои значения, списки фраз, добавление/удаление, пагинация, отсутствие
записи до подтверждения, no-op, retry/consumption/expiry/revision, отмена навигацией,
чужие scopes и duplicate update. Пустой список допустим, но поиск без запросов
не включается. Ручного выбора модели нет; старые model callbacks/ввод отклоняются.
Ни AI, ни HH не вызываются; реальный Telegram UI проверяется отдельно.
[Первоначальный этап и migration 036](history/2026-10-23-verification.md),
[текущий выпуск и migration 045](updates/2026-10-23-jobs-automatic-model-release.md).

Checks use actual message/menu handlers and the interaction repository: presets
and custom values, phrase lists, add/remove, pagination, no writes before
confirmation, no-op, retry/consumption/expiry/revision, navigation cancellation,
foreign scopes and duplicate updates. Empty lists are allowed; search cannot
start without queries. Manual model selection is absent, and obsolete model
callbacks/input are rejected. No AI or HH calls occur; live Telegram UI checks
remain separate. The linked archive preserves the original migration 036 stage;
the current release adds migration 045.

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

