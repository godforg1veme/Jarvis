# HH mobile manual access implementation plan

> История, 16 октября 2026: владелец отменил HH-доступ через Tailscale.
> Более новый результат: [капча через Telegram](../../updates/2026-10-16-hh-telegram-captcha.md).
> Описанная здесь web-схема выводится из эксплуатации.

> Execute task by task, review each boundary before integration. Independent
> gateway work may run in parallel; runtime and integration remain sequential.

**Goal:** Постоянная owner-only ссылка Tailscale для ручной капчи с телефона,
без таймера, с проверенным возвратом управления сборщику после «Готово».

**Architecture:** Один headed Chromium под Xvfb хранит прежний HH profile.
Приватный manual broker связывает coordinator с отдельным gateway/noVNC.
Gateway доверяет только Serve identity и использует отдельный manual token.

**Tech Stack:** CommonJS/Node 22+, Playwright 1.64.0, noVNC 1.7.0, ws 8.22.0,
Xvfb/x11vnc из закреплённого Ubuntu образа с зафиксированными apt версиями.

**Spec:** [подтверждённый проект](../specs/2026-10-16-hh-mobile-manual-design.md).
Владелец подтвердил документ 16 октября 2026 в этом чате.

## Общие ограничения

Постоянный адрес `/hh/`; без токенов в URL и без автоматического TTL.
Jarvis owner проверяется до доступа. GET не изменяет manual state.
Один Chromium/profile; no Docker socket/sudo/DB в gateway/browser.
Raw VNC loopback only; gateway host binding loopback only; Funnel запрещён.
Manual credential отличается от read/apply; HH cookies не покидают browser.
Unknown POST не повторяется; finish выполняет только read-only проверку.
Сбор и apply запрещены в pending/active/checking, filters/checkpoint сохраняются.
User-disabled поиск не включается после finish. Код локален до поручения выпуска.

## Task 1: Durable state и coordinator

**Files:** создать `job-browser/src/manualState.js`, `manualCoordinator.js`,
`job-browser/test/manualCoordinator.test.js`.

**Interfaces:**
`ManualState({root,ownerId}).read()/write(state)`; shape version,ownerId,
recoveryId,phase,target,revision. `ManualCoordinator({store,open,verify})`:
`load()`, `pending({target,recoveryId})`, `start(revision)`, `finish(revision)`,
`status()` → только phase/revision, `assertAutomatic()` → закрытый JOB код.
Calls serialized. Transitions persist before effects; checking restart becomes
active without auto-POST. target is canonical HH vacancy/search, max8192.

- [x] Добавить тесты без таймера, чужого owner, закрытого shape, unsafe file,
  concurrent start/finish, stale revision и failed verification:
  ```js
  assert.equal((await manual.finish(revision)).phase, 'active');
  assert.throws(() => manual.assertAutomatic(), { code: 'JOB_HH_MANUAL_ACTIVE' });
  ```
- [x] Реализовать 0700 directory/0600 atomic state с O_NOFOLLOW, fsync и
  ограничением 16KiB; тесты сначала FAIL на отсутствующем модуле, затем PASS.
- [x] `node --test job-browser/test/manualCoordinator.test.js`.

## Task 2: Browser handover, guarded manual captcha и broker

**Files:** `browserMain.js`, `hhBrowser.js`, `captchaRecovery.js`,
создать `manualBrowser.js`, `manualBroker.js` и тесты.

**Interfaces:** broker GET `/status`, POST `/start|finish` с
`{revision:integer}`; auth `Bearer manualToken`, configured owner header.
GET upgrade `/transport` принимает только active/revision и соединяется с
фиксированным VNC loopback port5900. Body4096/maxPayload65536/max2 connections.
Gateway получает только `{phase,revision}` и закрытые failure codes.

- [x] Captcha manual failure сохраняет canonical target + original recoveryId
  в coordinator.pending; automatic methods проверяют mode внутри serial queue.
- [x] `manualBrowser` владеет одной foreground page; читает frozen form/key,
  допускает точный native captcha request и фиксирует challenge до POST.
  Все остальные POST/WS/apply запрещены. Init bound current target/form.
- [x] Finish блокирует input, GET target и штатный search/vacancy reader;
  verify failure возвращает active. Success marks original captcha resolved.
  No CAPTCHA retry during finish. Raw page/URL/text never in result/log.
- [x] Broker constant-time token check before parsing body/upgrade; validate
  owner, closed request, phase/revision; disconnect on phase change.
- [x] Реальные Chromium fixtures: pending blocks reads/apply, manual native
  answer once, unknown restart, redirects, tamper, reader-based finish.
  `node --test job-browser/test/*.test.js`; isolated CAPTCHA/browser acceptance.
- [x] Проверить отсутствие регрессии при disabled feature.

## Task 3: Independent gateway и мобильный UI

**Files:** создать пакет `job-manual/` с package/lock, `src/server.js`,
`src/access.js`, `src/browserClient.js`, `public/`, `test/`, Dockerfile/README.

**Interfaces:** `createManualGateway({origin,ownerLogin,ownerId,token,brokerUrl})`
returns HTTP server. Origin HTTPS exact ts.net; brokerUrl fixed
`http://job-browser:8082`, owner/token only server-to-server.
UI routes `/hh/`, `/hh/app.js`, `/hh/style.css`, pinned `/hh/novnc/…`,
GET `/hh/api/status`, POST `/hh/api/start|finish`, WS `/hh/transport`.

- [x] Добавить tests HTTP/upgrade: identity missing/foreign, Host/Origin,
  CSRF/session, duplicates, body/payload caps, GET no state effects:
  ```js
  assert.equal((await request({ identity:'foreign' })).status, 403);
  assert.equal(startCalls, 0);
  ```
- [x] Secure HttpOnly Strict session cookie Path=/hh; random CSRF held only
  session memory; bounded sessions. Serve identity compared exact configured
  login. No response contains broker credential, ownerId or HH target.
- [x] Auth before all UI/assets and WS; WS upgrades validated with active
  revision, no client-supplied upstream URL, no compression, bounded buffers.
  Control errors closed, no exception/headers/cookie logging.
- [x] Локальный UI с состоянием/Start/Done и noVNC RFB: touch, viewport scale,
  keyboard, русский ввод. Clipboard и file transfer disabled. Finish closes
  transport before read; rejected finish permits reconnect, no expiry timer.
- [x] Static paths allowlisted; realpath stays in public/noVNC directories,
  CSP no CDN, no-store, no framing, Referrer-Policy no-referrer.
- [x] `npm test --prefix job-manual`; audit pinned production dependencies;
  screenshot/input UI fixture and successful/failed finish.

## Task 4: Collector и Telegram integration

**Files:** `server/src/jobs/jobBrowserClient.js`, `jobCollector.js`,
`jobConfig.js`, `jobRuntime.js`, `jobTelegramService.js`, `jobTelegramViews.js`,
`jobDeliveryWorker.js`; focused test files; Telegram menu contract.

**Interfaces:** closed JOB_HH_MANUAL_ACTIVE code propagates browser→RPC→client.
`jobManualAccessUrl` optional HTTPS exact ts.net `/hh/`, no credentials/query/hash;
passed to views/delivery by config, never derived from untrusted payload.

- [x] Add config and views tests:
  ```js
  assert.equal(view.buttons.flat().find(b=>b.text==='Открыть HH').url, configuredUrl);
  ```
- [x] Manual-active schedules next coordinator poll after10s, preserves
  checkpoint/progress/settings. Pending is deduplicated attention with same
  recovery ID; no repeated notice. No HH request while active.
- [x] Owner/private menu + attention include configured URL button; no new
  callbacks or guided kinds. Update notice/contract before edits.
- [x] Real handlers cover foreign scope/member, disabled config, delivery
  unknown/replay, previews disabled. Full `npm test --prefix server`.
- [x] Current docs point to the measured development result.

## Task 5: Images, Compose и installation preparation

**Files:** browser Dockerfile, new display entrypoint, gateway Dockerfile,
Compose opt-in profile/env.example, deploy README, verification docs.

- [x] Read-only inspect current image Xvfb/x11vnc availability; pin apt
  candidates and image inputs. Entrypoint launches Xvfb `-nolisten tcp` and
  x11vnc loopback only, signal cleanup; no startup with missing controls.
- [x] Gateway separate manual network; only browser shares it. Bind only
  `127.0.0.1:19123`. Manual token/login/origin configured privately; no defaults
  enabling weak auth. Validate token differs read/apply. Feature default off.
- [x] Compose/preflight tests deny public bindings, profile duplication,
  Docker socket, shared credentials and Funnel; baseline profile unchanged.
- [x] Isolated Linux images run coordinator/gateway/Chromium/noVNC integration;
  no production profile, credentials, HH, Telegram or public network.
- [x] Record tests, scan/review diff and prepare concrete release proposal.
  Current task authorization covers implementation; ask before GitHub/VPS.

## Task 6: Authorized release and phone acceptance

- [x] After explicit release instruction: fresh branch/worktree/PR audit,
  source guard, main publication, both VPS source sync, immutable releases.
- [x] Preserve profile/env/secret inodes/mounts. Install only changed DE
  components; add `/hh/` Serve mapping without reset/other-route changes.
- [x] Probe direct denial/identity denial/owner access and no public VNC/CDP.
  Inspect actual image files, health and service state after any uncertain step.
- [ ] Owner enables Tailscale on iPhone; Safari image/keyboard/Done verified.
  Foreign identity denied, paused collection proven, successful target read
  resumes original progress, inactive page retains permanent URL.
- [x] Record actual results and incomplete live checks; no Desktop reinstall.

## Self-review

Tasks cover state/restart/unknown (1–2), owner access/transport/mobile (3),
Telegram/progress (4), deployment/isolation/dependencies (5), live phone (6).
No TTL or link credential; a browser auth session is separate from durable
manual ownership. No generic remote executor or new model tool is introduced.


Implementation tasks 1–5 completed locally and are saved together after integration
review. [Measured development results](../../updates/2026-10-16-hh-mobile-manual-development.md).
Task 6 release was authorized and installed. [Release results](../../updates/2026-10-16-hh-mobile-manual-release.md).
Real iPhone acceptance and a separate foreign Tailscale account remain unverified;
owner HTTPS and gateway-level foreign identity denial passed.
