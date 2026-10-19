# Поиск работы с личным подключением HH — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans. Выполняй задачи последовательно в текущей ветке, сверяясь с контрольными точками. Шаги отмечаются checkbox (`- [ ]`).

**Goal:** Разрешить пользователю с правом `jobs` подключить личный HH с телефона или ПК через обычный HTTPS и безопасно искать вакансии в своей области.

**Architecture:** Mini App создаёт короткоживущий одноразовый входной ticket, а HTTPS-страница передаёт ограниченные события управления отдельному persistent Chromium-профилю. Сервер остаётся единственным шлюзом: браузер и RPC не получают публичный порт, а Telegram, Mini App, worker и browser повторно проверяют право текущего пользователя. Профиль владельца и существующий его вход остаются на прежнем пути.

**Tech Stack:** CommonJS, Fastify HTTPS routes, PostgreSQL migrations, Mini App ES modules, Playwright/Chromium. Новые production-зависимости не добавлять.

**Текущий статус:** реализация личного подключения и role-scoped jobs подготовлена в `codex/jobs-member-hh`; синтаксис 50 JavaScript-файлов и `git diff --check` прошли. Исправлено использование `users.role='owner'` как fallback для Telegram owner-меню; существующая проверка обновлена, но тесты и сборка не запускались. Live HH и развёртывание не выполнялись. Сверяй оставшиеся шаги с dated development record.

**Spec:** [Поиск работы для участников и личное подключение HH](../specs/2026-10-19-job-search-member-access-design.md).

## Global Constraints

- Пользователь определяется числовым Telegram ID; `jobs`, блокировка, `deny` и membership revision проверяются сервером на каждом действии и перед фоновым действием.
- Главный владелец по-прежнему определяется только `JARVIS_OPERATIONS_OWNER_TELEGRAM_ID`; его HH-профиль не используется участниками.
- Ticket привязан к одной сессии входа, передаётся в URL fragment и хранится в БД только как SHA-256; он не появляется в query, Telegram, логах или diagnostics. Срок ticket — 5 минут. Повтор обмена в этот срок идемпотентно возвращает тот же guest token той же сессии, чтобы потеря HTTP-ответа не блокировала вход; новая browser-сессия при повторе не создаётся.
- Временная сессия входа действует 10 минут; host-only guest cookie `__Secure-jarvis-job-login` ограничена путём `/mini/api/jobs/login`, имеет `HttpOnly; Secure; SameSite=Strict`, не содержит `Domain` и удаляется при завершении/отзыве/истечении срока.
- Вход доступен только на текущем HTTPS origin. Публичный gateway принимает только кадр страницы и закрытые события мыши/клавиатуры; произвольной навигации, URL, HTTP proxy, публичного RPC/CDP и Tailscale нет.
- Введённые события могут кратко проходить через Mini App, HTTPS gateway и внутренний browser RPC в памяти. Их значения не сохраняются в БД, файлы, application state, Telegram, логи или diagnostics; текстовая форма страницы и снимки экрана не архивируются. UI прямо раскрывает этот маршрут и технический доступ владельца инфраструктуры до начала входа.
- HH cookies и профиль хранятся только в приватном каталоге пользователя; владелец сервера технически управляет этой инфраструктурой. Пароли и коды не пишутся в отдельную форму Jarvis.
- В обычном job RPC сохраняется read-only сетевой guard. Во время явно активного login-сеанса допускаются только проверенные действия стандартной формы входа HH на allowlisted auth origins; любое действие отклика, навигация на переданный клиентом URL и посторонний write остаются запрещены.
- Профиль владельца остаётся в существующем `/home/pwuser/profile`. У каждого участника отдельный Playwright context и durable state-файл под UUID-путём; файлы проходят проверку symlink/владельца/режима и закрытые права каталога.
- CAPTCHA, история, приложения, resume selection, поиски и доставки остаются в области того же `user_id`; отзыв права прекращает удалённое управление и последующие фоновые действия, но сам профиль не удаляет.
- Не менять другие пользовательские разделы, VPN/Operations owner-bound правила, Telegram button labels/callback grammar и существующие точные подтверждения отклика.
- Не выполнять live HH login или live submit без отдельного разрешения на ручную приёмку; неизвестный исход сверять с тем же session/operation ID.

## Карта файлов

| Файл | Ответственность после изменения |
| --- | --- |
| `server/src/db/migrations/039_job_member_hh_sessions.sql` | Закрытая запись входной сессии, ticket hash, membership revision и одноразовые переходы состояния. |
| `server/src/jobs/jobConnectionSessionRepository.js` | Атомарные SQL-операции создания, обмена ticket, статуса, подтверждения и истечения сессии. |
| `server/src/jobs/jobConnectionSessionService.js` | Проверка доступа и координация Mini App с per-user browser профилем. |
| `server/src/access/accessRepository.js` | Текущая ревизия назначенной роли для отмены login ticket при изменении разрешений роли. |
| `server/src/jobs/jobBrowserClient.js`, `server/src/jobs/jobRuntime.js`, `server/src/jobs/jobConfig.js` | Внутренний RPC-клиент с user UUID, раздельными read/connect/apply полномочиями и адаптеры job-runtime. |
| `job-browser/src/profileManager.js`, `job-browser/src/browserMain.js`, `job-browser/src/hhBrowser.js` | Изолированные user contexts с приватным durable state каждого пользователя и ограниченным браузерным входом. |
| `job-browser/src/rpcProtocol.js`, `job-browser/src/rpcServer.js`, `job-browser/src/captchaBroker.js` | Закрытые job/login/CAPTCHA операции с раздельными read/connect/apply credentials, точной схемой событий и scope по user UUID. |
| `server/src/miniAppSelfRoutes.js`, `server/src/miniApp/routes.js`, `server/src/runtime.js` | Аутентифицированные Mini App endpoints и отдельно авторизованный HTTPS guest login gateway. |
| `mini-app/src/app.js`, `mini-app/src/api.js`, `mini-app/src/jobConnection.js` | Статус, простая кнопка подключения, share/copy link, resume choice и отзыв/повтор входа. |
| `mini-app/job-connect.html`, `mini-app/src/jobConnect.js`, `mini-app/src/style.css`, `server/src/miniAppAssets.js` | Адаптивная HTTPS-страница входа с удалённым экраном HH и мобильной клавиатурой. |
| `server/src/jobs/jobSchemas.js`, `jobTelegramService.js`, repositories/workers и `server/src/telegram/telegramMenuService.js` | Личные job-действия для любого актуального membership с `jobs`; запрет участникам использовать owner-профиль. |
| `server/test/*`, `job-browser/test/*` | PostgreSQL, настоящий Fastify handlers, browser protocol/profile isolation и role-revocation acceptance. |
| `mini-app/README.md`, `job-browser/README.md`, `docs/telegram-menu-contract.md`, `docs/README.md`, новая dated development запись | Обновлённые пользовательские и эксплуатационные границы; текущий статус на русском и английском. |

## Итог аудита ролей

- Ассистент, Life OS, память, документы и устройства используют разрешения секций и личный `user_id`; доступ администратора не превращается в чтение чужих личных данных.
- VPN и Operations остаются owner-bound по числовому `JARVIS_OPERATIONS_OWNER_TELEGRAM_ID`.
- В «Поиске работы» обнаружено расхождение: кнопка может быть видна участнику с `jobs`, но вход в меню, `assertJobScope`, CAPTCHA, очередь поиска/истории/доставки и RPC браузера требуют владельца. Расширен только этот permission path. В legacy owner-меню теперь тоже требуется точный настроенный Telegram ID; сохранённая роль пользователя владельца не назначает.
- Назначение `jobs` администратору не подставляет аккаунт HH владельца: профили всех пользователей, включая admin, выбираются по отдельному внутреннему UUID.

---

### Task 1: Сессия входа и проверка личного доступа

**Files:**
- Create: `server/src/db/migrations/039_job_member_hh_sessions.sql`
- Create: `server/src/jobs/jobConnectionSessionRepository.js`
- Create: `server/src/jobs/jobConnectionSessionService.js`
- Modify: `server/src/jobs/jobSchemas.js`, `server/src/access/accessRepository.js`
- Test: `server/test/jobConnectionSession.test.js`
- Test: `server/test/jobMemberConnectionPostgresAcceptance.cjs`

**Interfaces:**
- `new JobConnectionSessionService({ repository, accessService, browserClient, now = Date.now })` is the only service allowed to create/claim/confirm a login session.
- `JobConnectionSessionRepository.transaction(fn)` starts a PostgreSQL transaction, takes `pg_advisory_xact_lock(hashtext('jarvis-access-admin'))`, and commits or rolls back. Its helpers are `createOrRefresh(client, row)`, `byTicketForUpdate(client, ticketHash)`, `claimLocked(client, { id, guestTokenHash })`, `byIdForUser(client, { sessionId, userId })`, `setStatus(client, { sessionId, userId, status })`, and `confirmLocked(client, { sessionId, userId, resumeId })`.
- `JobConnectionSessionService.create({ userId, requestId })` returns `{ sessionId, ticket, expiresAt, status }`; `sessionId` and `ticket` are null for an already-connected profile, and `ticket` is null for an already-claimed session. Repeating the same `requestId` refreshes only a still-pending ticket and never creates a second browser session.
- `JobConnectionSessionService.claim({ ticket })` atomically changes `pending` to `claimed` and returns `{ sessionId, guestToken, expiresAt }`. A replay with the same still-valid ticket returns the same deterministic guest token for that same claimed session; it cannot create or switch sessions. No raw ticket or guest token is stored.
- `JobConnectionSessionService.status({ sessionId, userId })` returns only `{ status, resumes }` for the same currently authorized Mini App actor.
- `JobConnectionSessionService.confirm({ sessionId, userId, resumeId })` writes `job_connections` only after authenticated browser state and an exact resume choice; returns `{ status: 'connected', resumeId }`.
- `JobConnectionSessionService.cancel({ sessionId, userId })` revokes only the caller’s pending login session and closes its remote-control window.
- `assertJobLoginAccess(session, access)` throws `JOB_ACCESS_REVOKED` if current access no longer matches the saved membership/role revisions or lacks `jobs`.
- `AccessRepository.get()` also returns `roleRevision`; guest authorization is `authorizeGuest({ guestToken })` and returns only `{ sessionId, userId }` after checking expiry, state, permission, captured `membership_revision`, `role_id`, and `role_revision`.
- Export `assertJobLoginAccess(session, access)` alongside `JobConnectionSessionService` for direct closed-state unit coverage.

- [ ] **Step 1: Add the forward-only session table and indexes**

Create `job_hh_login_sessions` with UUID `id`, `user_id`, unique `request_id` per user, nullable SHA-256 `ticket_hash`, nullable unique `guest_token_hash`, positive `membership_revision`, captured nullable `role_id` and nonnegative `role_revision`, status restricted to `pending`, `claimed`, `authenticated`, `confirmed`, `cancelled`, `expired`, `revoked`, or `failed`, optional selected resume ID, separate `ticket_expires_at` (five minutes) and `expires_at` (login session, ten minutes), created/updated timestamps, and nullable claimed/completed timestamps. Retain only the ticket hash while a session is pending/claimed so exchange retries can derive the same guest token; clear it on every terminal state. Add indexes for per-user active state and expiry and a partial unique index allowing at most one `pending`, `claimed` or `authenticated` session per user. Do not add password, cookie, DOM, frame, or raw bearer columns.

```sql
CREATE TABLE job_hh_login_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  ticket_hash text UNIQUE CHECK (ticket_hash IS NULL OR ticket_hash ~ '^[a-f0-9]{64}$'),
  guest_token_hash text UNIQUE CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[a-f0-9]{64}$'),
  membership_revision integer NOT NULL CHECK (membership_revision > 0),
  role_id uuid REFERENCES access_roles(id) ON DELETE SET NULL,
  role_revision integer NOT NULL CHECK (role_revision >= 0),
  status text NOT NULL CHECK (status IN ('pending','claimed','authenticated','confirmed','cancelled','expired','revoked','failed')),
  resume_id text CHECK (resume_id IS NULL OR char_length(resume_id) <= 128),
  ticket_expires_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  claimed_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE UNIQUE INDEX job_hh_login_one_active_per_user
  ON job_hh_login_sessions(user_id) WHERE status IN ('pending','claimed','authenticated');
CREATE INDEX job_hh_login_expiry_idx ON job_hh_login_sessions(expires_at);
```

Run the migration in the isolated fixture by applying `001_identity_and_conversations.sql`, `037_access_mini_app.sql`, `029_job_search.sql`, then `039_job_member_hh_sessions.sql`; confirm the owner’s existing `job_connections` row shape is unchanged.

- [ ] **Step 2: Write unit tests for ticket and guest-token transitions**

In `jobConnectionSession.test.js`, add a local `fixture()` that returns `{ service, repository, access, userId, requestId }`; `repository` implements the method names above and stores only passed hashes. Inject a deterministic clock. Cover: random ticket is 32 bytes and returned once; database receives only its SHA-256 hash; same `requestId` has one `sessionId`; ticket can be claimed once; expiry rejects; wrong user, blocked user, missing `jobs`, denied override, and changed membership or role revision reject; status/confirm/cancel reject foreign user; repeated confirm does not increment the connected profile twice.

```js
const { randomUUID } = require('node:crypto');

test('claim consumes the capability once and stores only its digest', async () => {
  const { service, repository, userId, requestId } = fixture();
  const created = await service.create({ userId, requestId });
  assert.equal(Buffer.from(created.ticket, 'hex').length, 32);
  const claimed = await service.claim({ ticket: created.ticket });
  assert.equal(claimed.sessionId, created.sessionId);
  const replay = await service.claim({ ticket: created.ticket });
  assert.deepEqual(replay, claimed);
  assert.notEqual(repository.saved.ticketHash, created.ticket);
  const roleId = randomUUID();
  const savedAccess = { userId, blocked: false, permissions: ['jobs'], revision: 3, roleId, roleRevision: 7 };
  assert.doesNotThrow(() => assertJobLoginAccess({ userId, membershipRevision: 3, roleId, roleRevision: 7 }, savedAccess));
  assert.throws(() => assertJobLoginAccess({ userId, membershipRevision: 3, roleId, roleRevision: 7 },
    { ...savedAccess, roleRevision: 8 }), { code: 'JOB_ACCESS_REVOKED' });
});

test('role revision invalidates a pending login session', () => {
  const roleId = randomUUID();
  const session = { userId: randomUUID(), membershipRevision: 3, roleId, roleRevision: 7 };
  const access = { userId: session.userId, blocked: false, permissions: ['jobs'], revision: 3, roleId, roleRevision: 7 };
  assert.doesNotThrow(() => assertJobLoginAccess(session, access));
  assert.throws(() => assertJobLoginAccess(session, { ...access, roleRevision: 8 }), { code: 'JOB_ACCESS_REVOKED' });
});
```

Run: `node --test server/test/jobConnectionSession.test.js`

Expected: all cases pass, and serialized repository inputs contain no raw ticket, guest bearer, HH password, or cookie.

- [ ] **Step 3: Implement repository transitions with row locks**

Use one PostgreSQL transaction per state change. Before locking or changing a login row, take the existing `jarvis-access-admin` transaction advisory lock, then evaluate current access through `AccessRepository.get(client, 'user', userId)`. This serializes claim/confirm with role and membership mutations. `claim` updates `ticket_hash` to `NULL` only when hash, state, expiry, membership revision, role ID and role revision match. Store only `hash(guestToken)`; return the raw token only to the HTTP handler creating the secure cookie. Preserve the original `requestId` on retries.

```sql
UPDATE job_hh_login_sessions
SET guest_token_hash = $2, status = 'claimed', claimed_at = now()
WHERE ticket_hash = $1 AND status = 'pending' AND ticket_expires_at > now() AND expires_at > now()
  AND membership_revision = $3 AND role_id IS NOT DISTINCT FROM $4 AND role_revision = $5
RETURNING id, user_id, membership_revision, role_id, role_revision, expires_at;
```

- [ ] **Step 4: Implement service-level current-access checks**

Use injected `AccessService.getAccessForUser(userId)` for every Mini App/guest operation. Require `!blocked`, `permissions.includes('jobs')`, the same membership revision, role ID and role revision, and caller ownership. Extend `AccessRepository.get()` to return the current `access_roles.revision` as `roleRevision` so a role permission change invalidates an open ticket even when the member row itself did not change. `confirm` calls the user’s browser adapter to prove HH authentication, fetches current resumes, validates the chosen ID against that exact list, then upserts only that user’s existing `job_connections` row and increments its revision once.

```js
const access = await accessService.repository.get(db, 'user', row.user_id);
assertJobLoginAccess({ userId: row.user_id, membershipRevision: row.membership_revision,
  roleId: row.role_id, roleRevision: row.role_revision }, access);
```

For claim/confirm transactions, call the same repository with the transaction client (`accessService.repository.get(client, 'user', row.user_id)`) after `pg_advisory_xact_lock(hashtext('jarvis-access-admin'))`; do not authorize from a session actor snapshot.

- [ ] **Step 5: Prove migration and scope on an isolated PostgreSQL fixture**

In `jobMemberConnectionPostgresAcceptance.cjs`, use the existing `JARVIS_JOB_TEST_DATABASE_URL` fixture convention. Create owner plus two members with a `jobs` role, exchange a ticket for only one member, and assert the other member cannot claim, view, confirm, or cancel it. Verify duplicate request IDs, concurrent claims, expiry, deny override, block, revision change, and owner/member unique `job_connections` rows.

Run: `node --test server/test/jobMemberConnectionPostgresAcceptance.cjs`

Expected: PASS against a disposable database; without the explicit isolated URL the result is skipped and must not be reported as PostgreSQL acceptance.

### Task 2: Отдельные persistent профили и private RPC

**Files:**
- Create: `job-browser/src/profileManager.js`
- Modify: `server/src/jobs/jobBrowserClient.js`, `server/src/jobs/jobConfig.js`, `server/src/jobs/jobRuntime.js`, `deploy/docker-compose.yml`, `deploy/env.example`
- Modify: `job-browser/src/browserMain.js`, `job-browser/src/hhBrowser.js`, `job-browser/src/rpcProtocol.js`, `job-browser/src/rpcServer.js`
- Modify: `job-browser/src/applicationLedger.js`, `job-browser/src/guardedSubmission.js`, `job-browser/src/captchaJournal.js`, `job-browser/src/manualState.js`, `job-browser/src/captchaAttemptStore.js`
- Modify: `job-browser/src/captchaRecovery.js`, `job-browser/src/captchaTelegramBrowser.js`, `job-browser/src/captchaBroker.js`, `job-browser/src/captchaProtocol.js`, `job-browser/src/captchaTelegramProtocol.js`, `job-browser/src/manualCoordinator.js`
- Modify: `job-browser/test/rpcServer.test.js`, `job-browser/test/browserRuntimeAcceptance.cjs`
- Create: `job-browser/test/profileManager.test.js`, `job-browser/test/memberLoginAcceptance.cjs`

**Interfaces:**
- `ProfileManager.forUser(userId)` returns the user’s `HhBrowser` and user-bound application/CAPTCHA collaborators; invalid UUIDs fail closed. Owner uses the existing persistent context; members use independent browser contexts with state loaded/saved under their UUID profile root.
- `ProfileManager.selectPrimaryResume(userId, resumeId)` validates the resume against that profile’s live HH account, then atomically stores only the selected ID in `jarvis-primary-resume.json` mode `0600` inside that UUID profile.
- `resolveProfilePath(userId, { ownerId, root })` returns `root` for the configured owner and `path.join(root, 'members', userId)` for any other valid UUID.
- `readPrivateState(root)` returns a validated Playwright storage-state object; `savePrivateStateAtomically(root, state)` writes it through a same-directory mode-`0600` temporary file and atomic rename.
- `validRequest(value)` validates the exact private RPC shape and UUID syntax without assigning the configured owner UUID to member work.
- `JobBrowserClient` uses the current read token for `search`/`history`/`resumes`/`inspect`, a new connect token for `login_*` and `select_resume`, and the existing distinct apply token for `submit`/`reconcile`.
- `HhBrowser.startLogin({ sessionId })` opens only `https://hh.ru/account/login` for the active pending session.
- `HhBrowser.loginFrame({ sessionId })` returns `{ state, mimeType: 'image/jpeg', frameBase64, width, height }`, capped at 1024×768 and 512 KiB decoded.
- `HhBrowser.loginInput({ sessionId, sequence, event })` accepts only closed pointer, wheel, key, and bounded text-input events; enforces in-memory monotonic sequence numbers so a repeated event is never typed twice; returns `{ state }` and never echoes event values.
- `HhBrowser.loginStatus({ sessionId })` returns `{ state, resumes, nextSequence }`, with resume IDs/titles only after authenticated HH state.
- `HhBrowser.closeLogin({ sessionId })` closes remote control and removes an unconfirmed profile only if it was created by this attempt.
- Existing methods (`search`, `history`, `getVacancy`, `inspect`, `submit`, `reconcile`) select only `ProfileManager.forUser(userId)`; the RPC credential remains private to server↔browser.

- [ ] **Step 1: Add profile-path and bounds tests before browser changes**

Test that `resolveProfilePath(ownerId, { ownerId, root })` returns `root`; member UUIDs resolve under `root/members/<uuid>`; invalid UUID, symlink, wrong owner/mode, path traversal, foreign user in a state journal, over-capacity and duplicate session ID all fail closed. Verify the member state file is written atomically with mode `0600` and reloaded on restart. Use temporary fixture directories and fake Playwright contexts only.

```js
const root = '/tmp/job-browser-fixture/owner';
assert.equal(resolveProfilePath(ownerId, { ownerId, root }), root);
assert.equal(resolveProfilePath(memberId, { ownerId, root }), path.join(root, 'members', memberId));
await assert.rejects(manager.forUser('../../owner'), { code: 'JOB_BROWSER_ACCESS_DENIED' });
```

Run: `node --test job-browser/test/profileManager.test.js`

- [ ] **Step 2: Implement bounded profile manager without moving owner state**

Keep `/home/pwuser/profile` and `jarvis-owner.json` validation intact. Create member directories as mode `0700` beneath `/home/pwuser/profile/members/<user UUID>` on the existing persistent volume and validate each with `lstat`, process UID, no group/world permissions, and no symlinks. Get the Playwright `Browser` from the owner persistent context and fail startup with `JOB_BROWSER_CONTEXT_REQUIRED` if it is unavailable. Create member contexts from that browser with downloads disabled and service workers blocked; load/save only cookies, local storage and IndexedDB in each profile’s private `state.json`; save atomically on authenticated login and context close. Keep at most two live member contexts; close the least-recently-used idle member context before admitting another. If both are busy, queue ordinary job RPCs up to the existing request limit and return `JOB_BROWSER_BUSY` for a third simultaneous login; never evict a profile’s durable files. Keep the current 1 GiB container memory bound; do not raise it automatically.

```js
const memberRoot = path.join(profileRoot, 'members', userId);
await fs.mkdir(memberRoot, { recursive: true, mode: 0o700 });
const context = await browser.newContext({ storageState: await readPrivateState(memberRoot) });
await savePrivateStateAtomically(memberRoot, await context.storageState({ indexedDB: true }));
```

- [ ] **Step 3: Bind application and CAPTCHA persistence to each profile**

   Pass the selected profile root and UUID to `ApplicationLedger`, `GuardedSubmission`, `CaptchaJournal`, `ManualState`, and `CaptchaAttemptStore`. Construct a separate `ManualCoordinator`, `CaptchaRecovery`, and `CaptchaTelegramBrowser` per profile. A repository file or CAPTCHA RPC is rejected if its embedded owner/user ID differs from the profile UUID. Keep owner export/receipt commands fixed to the owner root and disabled for member profiles.

The selected resume ID for a member is loaded from that same private UUID directory at profile start; owner continues reading the existing owner manifest. Do not copy one profile’s manifest to another.

- [ ] **Step 4: Extend the RPC with exact login operations and user routing**

   Add `login_start`, `login_frame`, `login_input`, `login_status`, `login_close`, and `select_resume` as exact request shapes in `rpcProtocol.js`. `rpcServer.js` routes them through `ProfileManager.forUser(input.userId)`, validates screenshot response size before JSON encoding, accepts no caller-supplied URL, and keeps the current 1 MiB response bound. Authenticate read, connect and apply operations with three distinct credentials; add `JARVIS_JOB_BROWSER_CONNECT_TOKEN` only to job-browser and the main server, never job-collector. Extend CAPTCHA broker requests with the same exact user UUID and per-user coordinator lookup.

```js
const inputEvent = { userId, operation: 'login_input', args: {
  sessionId, sequence: 4, event: { type: 'text', value: 'x' },
} };
assert.equal(validRequest(inputEvent), true);
assert.equal(validRequest({ ...inputEvent, args: { ...inputEvent.args, url: 'https://example.com' } }), false);
assert.equal(validRequest({ userId, operation: 'select_resume', args: { resumeId: 'resume-1' } }), true);
```

- [ ] **Step 5: Add HH login and input behavior to the user’s browser only**

Add a dedicated login tab under the selected user’s isolated context; keep the existing GET-only `allowedRequest` policy as default. During this explicit login state only, permit non-GET requests after a recent explicit user input and only when the exact method, resource type, HH auth origin and login path appear in a closed allowlist; deny application-response paths, other hosts/methods and caller-supplied URLs. Accept only event coordinates inside the last frame, supported key names, and text chunks up to 64 characters. No event, frame, input value, or page content is written to a log or file. The login state machine returns only `waiting`, `authenticated`, `captcha`, `expired`, `closed`, or a fixed failure code.

```js
const request = route.request();
const loginWrite = isLoginActive && loginInputGuard.hasRecentUserGesture(sessionId, 2000)
  && request.frame() === loginPage.mainFrame()
  && isApprovedHhLoginRequest(request.method(), request.resourceType(), request.url());
if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !loginWrite) return route.abort();
```

- [ ] **Step 6: Verify protocol and two-profile isolation with fixtures**

   Use intercepted HH-shaped pages and fake IDs; assert bad internal auth, unsupported operation, extra keys, unsafe URL, oversized input/frame, foreign `sessionId`, duplicate start, duplicate input sequence and owner/member cross-access are rejected. Verify login never triggers application POST, CAPTCHA broker/state/journal and application ledger are different per profile, and owner browser acceptance still resolves the existing path.

Run: `node --test job-browser/test/rpcServer.test.js job-browser/test/profileManager.test.js job-browser/test/memberLoginAcceptance.cjs job-browser/test/browserRuntimeAcceptance.cjs`

Expected: PASS without real HH credentials or production profile access.

### Task 3: HTTPS gateway, Mini App подключение и mobile UI

**Files:**
- Modify: `server/src/miniAppSelfRoutes.js`, `server/src/miniApp/routes.js`, `server/src/miniAppAssets.js`, `server/src/runtime.js`
- Modify: `mini-app/src/app.js`, `mini-app/src/api.js`, `mini-app/src/style.css`, `mini-app/build.js`
- Create: `mini-app/src/jobConnection.js`, `mini-app/job-connect.html`, `mini-app/src/jobConnect.js`
- Modify: `server/test/miniAppRoutes.test.js`, `server/test/miniAppRuntime.test.js`, `server/test/miniAppIntegrationAcceptance.cjs`
- Create: `server/test/jobLoginGatewayAcceptance.cjs`, `scripts/testJobConnectClient.cjs`

**Interfaces:**
- Mini App API: `POST /mini/api/jobs/login` with `{ requestId }`; authenticated `GET /mini/api/jobs/login/owned/status/:sessionId`; `POST /mini/api/jobs/login/confirm` with `{ sessionId, resumeId }`; `POST /mini/api/jobs/login/cancel` with `{ sessionId }`.
- Guest API: `POST /mini/api/jobs/login/claim` with `{ ticket }`; cookie-authenticated HTTPS `GET` routes for `/status/:sessionId` and `/frame/:sessionId`; `POST /input/:sessionId` with a closed event and monotonically increasing `sequence`; and `POST /guest/cancel`. Repeating claim with the same ticket before its five-minute expiry returns the same guest token for the same session, allowing the client to recover from a lost response.
- Guest cookie name: `__Secure-jarvis-job-login`; issue it only after a valid ticket claim with `Path=/mini/api/jobs/login; HttpOnly; Secure; SameSite=Strict; Max-Age=600`, without a `Domain` attribute. The narrow path limits automatic sending to login endpoints. Clear it using the same path on cancel, expiry, revoke, or login completion.
- `registerMiniAppSelfRoutes` receives `getJobConnectionSessionService: () => jobRuntime?.connectionSessionService`; resolve it inside each handler because Mini App routes are registered before `jobRuntime` is initialized.
- `createJobConnectionPanel({ api, actor, anchor })` renders connection state and a share/copy one-time HTTPS link. It stores only the request/session UUID for reconciliation in `sessionStorage`; it never stores the ticket or guest token.
- The connection page reads ticket from `location.hash`, immediately clears the fragment with `history.replaceState`, exchanges it once, and then uses the HttpOnly guest cookie. The initial one-time link is the only share/copy surface; after exchange no ticket is placed in a later URL, local storage, clipboard fallback, log, or analytics.

- [ ] **Step 1: Test gateway authorization and ticket exchange**

Exercise actual Fastify route handlers over HTTP: wrong origin, missing/invalid guest cookie, malformed payload, ticket in query, claim replay returning the same session/cookie, expired ticket, foreign profile, oversized frame/input, duplicate input sequence, revoked membership, and request without `jobs` all fail closed with a small public error code. Check response and diagnostics do not contain ticket/token/frame/event text.

Run: `node --test server/test/jobLoginGatewayAcceptance.cjs`

- [ ] **Step 2: Add the Mini App job-connection routes**

Register the authenticated endpoints through the existing `route`/`authorize` helpers, requiring exact same origin + CSRF on mutations and no query keys. The claim route has no Mini App cookie; it requires exact Origin and a valid one-time ticket. Pass the lazy job service getter through `runtime.js` to `registerMiniAppSelfRoutes`. Every guest request requires the HTTPS Origin, guest HttpOnly cookie, same live session/revision, and a fresh access check. The guest page polls the bounded frame endpoint and sends allowlisted input events by HTTPS POST; no WebSocket or public browser RPC is added. On revocation, expiry, cancel, or browser failure, clear the cookie and close the temporary browser page.

- [ ] **Step 3: Add Mini App status and one-tap connection flow**

Render the jobs connection card from current `actor.permissions`. Show connected/disconnected/expired states, one primary «Подключить HH» action, status polling, exact resume list and a confirmation button. Use Web Share API first, then `navigator.clipboard.writeText`, then a visible selectable link. Show a 5-minute expiry and allow retry with the same `requestId` after an uncertain response. Do not generate a QR through a third-party service or add a production dependency.

```js
const link = new URL('/mini/job-connect/', publicOrigin);
link.hash = new URLSearchParams({ ticket }).toString();
await navigator.share({ url: link.href, title: 'Вход в HH через Jarvis' });
```

- [ ] **Step 4: Add a phone/desktop login page with truthful privacy copy**

Serve an explicit `job-connect.html` asset via the Mini App allowlist. Show the HH page as a bounded image with pointer/touch controls and a visible masked keyboard input that invokes the device’s native keyboard; let the user temporarily reveal typed text when entering an email or code. Send text/key events by authenticated HTTPS POST in memory and clear the client value after acknowledgement or tab close. Before starting, disclose that screen frames and input pass through Jarvis HTTPS and its private browser service; values are not retained in the app/database/files/logs, and the infrastructure owner technically controls the server.

```js
let ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
history.replaceState(null, '', location.pathname);
const claim = await api.request('/jobs/login/claim', 'POST', { ticket });
ticket = null;
```

Derive the guest token as an HMAC of the ticket and session ID using a domain-separated label. On an idempotent replay, recompute the same value and compare its digest with the stored `guest_token_hash`; never persist or log the bearer itself. The five-minute ticket expiry bounds this recovery path.

- [ ] **Step 5: Keep cross-device confirmation in the original Telegram Mini App session**

The guest browser can only report that HH authentication completed. It cannot choose or save a resume. The authenticated Mini App session polls `/owned/status/:sessionId`, displays the account-safe state and exact resume titles, and confirms the selected resume. If the original Mini App is closed, the profile stays unconfirmed and is cleared after expiry; a new attempt starts only after checking/reconciling the original `sessionId`.

For each remote text event, allocate the next `sequence`, send once, and clear the transient input only after an acknowledgement with that sequence. A reconnect first asks the server for the next expected sequence, so a lost acknowledgement cannot type the same password character twice.

- [ ] **Step 6: Verify built assets and mobile browser contract**

Add deterministic client checks for fragment clearing before any `fetch`, no token persistence, touch coordinate scaling, native keyboard event forwarding, guest cookie-only stream, share/copy fallback, reconnect/expiry text, and no secret-bearing errors. Build Mini App and serve it from Fastify’s allowlist.

Run: `npm run build --prefix mini-app; node scripts/testJobConnectClient.cjs; node --test server/test/miniAppRoutes.test.js server/test/miniAppRuntime.test.js server/test/jobLoginGatewayAcceptance.cjs`

Expected: PASS; preview and app use the same static asset names and MIME types.

### Task 4: Права jobs в Telegram, repositories и background workers

**Files:**
- Modify: `server/src/telegram/telegramMenuService.js`
- Modify: `server/src/jobs/jobSchemas.js`, `jobTelegramService.js`, `jobBrowserConnectionService.js`, `jobBrowserClient.js`, `jobRuntime.js`, `collectorMain.js`
- Modify: `server/src/jobs/jobSearchRepository.js`, `jobProfileRepository.js`, `jobDraftRepository.js`, `jobDraftService.js`, `jobSettingsService.js`, `jobSettingsPanel.js`, `jobHistoryRepository.js`, `jobDeliveryRepository.js`, `jobDeliveryWorker.js`, `jobCaptchaService.js`, `jobCaptchaClient.js`, `jobCaptchaRepository.js`, `jobCaptchaWorker.js`, `jobHistorySyncRepository.js`, `jobHistoryWorker.js`, `jobApplicationRepository.js`, `jobApplicationService.js`
- Modify: `server/test/telegramMenuService.test.js`, `server/test/jobTelegram.test.js`, `server/test/telegramMessageService.test.js`, `server/test/jobDeliveryAcceptance.cjs`, `server/test/jobCaptchaAcceptance.cjs`, `server/test/jobHistoryAcceptance.cjs`, `server/test/jobApplicationsAcceptance.cjs`
- Create: `server/test/jobMemberPermissionsAcceptance.cjs`

**Interfaces:**
- Change `assertJobScope(pool, scope, accessService)` to validate the existing exact Telegram conversation/identity scope, then require the current access record to be unblocked and include `jobs`.
- `jobScope(context)` accepts only a private Telegram chat where `chatId === telegramUserId`; the menu service supplies freshly loaded `context.access` before any `job:*` callback.
- `JobBrowserClient.forUser(userId)` supports any syntactically valid internal UUID, while every public Telegram/Mini App/worker call must pass the `jobs` access check before using it.
- Every claim/worker path checks fresh access before HH browser work, writing new job state, CAPTCHA answer/photo delivery, history delivery, or Telegram delivery; state mutations check again in their transaction before commit.

```js
async function assertJobScope(pool, input, accessService) {
  const scope = scopeSchema.parse(input);
  const access = await accessService.repository.get(pool, 'user', scope.userId);
  if (!access || access.blocked || !access.permissions.includes('jobs')) throw jobError('JOB_SCOPE_DENIED');
  const result = await pool.query(`SELECT c.id FROM conversations c
    JOIN user_identities i ON i.user_id=c.user_id AND i.provider='telegram' AND i.external_id=$3
    WHERE c.id=$1 AND c.user_id=$2 AND c.channel='telegram' AND c.external_chat_id=$3`,
  [scope.conversationId, scope.userId, scope.chatId]);
  if (!result.rowCount) throw jobError('JOB_SCOPE_DENIED');
  return scope;
}
```

- [ ] **Step 1: Add failing tests for member Telegram scope and stale rights**

Update `jobTelegram.test.js` and the actual callback handler acceptance so a member with `jobs` can open search, a member without it is denied, a group/foreign chat is denied, and an already-started callback fails after `deny`, block, or membership revision change. Preserve current callback bytes and button label.

Run: `node --test server/test/jobTelegram.test.js server/test/telegramMenuService.test.js`

- [ ] **Step 2: Remove only the owner gates from the jobs path**

In `telegramMenuService.js`, remove the canned non-owner return and route `jobs` only after `context.access.permissions` contains `jobs`. `jobScope` checks the private Telegram chat binding; `assertJobScope` then re-reads permission through `AccessService`. Do not touch owner checks for `vpn`, `operations`, desktop control, or admin access.

```js
function jobScope(context) {
  if (context.chatType !== 'private'
    || String(context.chatId) !== String(context.telegramUserId)) throw jobError('JOB_SCOPE_DENIED');
  return { userId: context.user.id, conversationId: context.conversation.id,
    chatId: String(context.chatId), channel: 'telegram' };
}
```

- [ ] **Step 3: Inject current access checks into all job repositories/services**

Pass `accessService` from `createJobRuntime` and collector startup to every repository/service that calls `assertJobScope`, including search, profiles, drafts, settings, history, applications, connection and CAPTCHA. Replace each `users.role='owner'` queue predicate with current jobs access; retain user identity, conversation, connected profile, lease, expiry and private-chat joins. In the browser adapter, route all list/search/history/inspect/apply/reconcile calls to the selected UUID profile.

Every state-changing repository transaction takes the same short-lived advisory lock as access mutations before checking permission:

```js
await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
await assertJobScope(client, scope, accessService);
await client.query('UPDATE job_searches SET settings=$1,revision=revision+1 WHERE user_id=$2', [settings, scope.userId]);
```

```js
const access = await accessService.getAccessForUser(userId);
if (!access || access.blocked || !access.permissions.includes('jobs')) throw jobError('JOB_ACCESS_REVOKED');
const result = await browserClient.forUser(userId).search(searchArgs);
```

- [ ] **Step 4: Recheck permissions at every asynchronous boundary**

Before each collector page, guided-input consumption, captcha browser action/reply/photo, history page, delivery send, and application inspect/confirm/submit/reconcile, re-read current `AccessService` state and compare the login/search/connection revisions already frozen by that operation. On revoke/block/deny, stop or pause with a fixed access-revoked code, close active login control, and never send another page or Telegram item.

For Telegram guided input, preserve the existing `messagePermissions` and final `MessageService` permission recheck. For browser/worker work, put the same check immediately before each external HH or Bot API side effect; do not rely on the permission loaded when the job was queued.

- [ ] **Step 5: Add two-user/owner isolation acceptance**

With the isolated job/PostgreSQL and browser fixtures, create owner plus two members and distinct synthetic profiles. Verify one user’s search, saved matches, draft, selected resume, application ledger, CAPTCHA state, history, and delivery cannot be read or changed by the other; revoke permission during login, collection, CAPTCHA, history and delivery and assert the next boundary stops. Verify a regrant reuses only that same user’s retained profile. Assert the owner path still works on its existing profile root.

Run: `node --test server/test/jobMemberPermissionsAcceptance.cjs server/test/jobTelegram.test.js server/test/telegramMenuService.test.js server/test/jobBrowserClient.test.js`

### Task 5: Adjacent tests, Telegram contract, and current documentation

**Files:**
- Modify: `docs/telegram-menu-contract.md`, `mini-app/README.md`, `job-browser/README.md`, `docs/README.md`, `docs/verification.md`
- Create: `docs/updates/2026-10-19-job-search-member-access-development.md`
- Test: existing server and browser suites listed below.

- [ ] **Step 1: Record the Telegram observable change**

Add a dated Russian/English change note to `docs/telegram-menu-contract.md`: same bottom label and callback grammar; a permitted non-owner now opens personal search; an unconnected user gets an HTTPS Mini App HH connection path; every result stays user/private-chat scoped. Keep the already-notified path and approval evidence in that document.

- [ ] **Step 2: Document connection, privacy, operations and recovery**

Update `mini-app/README.md` with the phone/desktop link, five-minute ticket, one-time guest cookie, native keyboard, resume confirmation, expiry/retry, and what the infrastructure owner can technically access. Update `job-browser/README.md` with owner and member roots, two-member-context limit, per-user journals/ledgers, private RPC operations and retention behavior. Add only focused verification commands to `docs/verification.md`.

- [ ] **Step 3: Write bilingual current status and development result**

In `docs/README.md`, add a concise Russian and English status linking the implementation record. The new `docs/updates/2026-10-19-job-search-member-access-development.md` has full «Русский» and «English» sections, records only executed local checks, and separates fixtures from pending live HH login/release acceptance. Do not describe a deployment or live login as completed.

- [ ] **Step 4: Run focused regression and full relevant suites**

Run, in this order:

```powershell
node --test server/test/jobConnectionSession.test.js server/test/jobMemberPermissionsAcceptance.cjs server/test/jobLoginGatewayAcceptance.cjs server/test/jobTelegram.test.js server/test/telegramMenuService.test.js
node --test server/test/jobMemberConnectionPostgresAcceptance.cjs
npm run test:jobs:postgres --prefix server
npm test --prefix server
npm test --prefix job-browser
npm run build --prefix mini-app
node scripts/testJobConnectClient.cjs
node --test server/test/miniAppIntegrationAcceptance.cjs
```

Use `JARVIS_JOB_TEST_DATABASE_URL` only for a disposable test DB. The migration/acceptance steps must not use production. Browser tests use temporary fixture profiles and intercepted HH-shaped pages; never point them at `/home/pwuser/profile` or a real HH account.

- [ ] **Step 5: Review behavior and report remaining acceptance**

Inspect `git diff --check`, `git status`, exact current `main`/branch relationship, all ticket and RPC responses, Mini App asset allowlist, and every owner gate found by `rg -n "role='owner'|role !== 'owner'|role === 'owner'" server/src/jobs server/src/telegram/telegramMenuService.js`. Remaining owner checks must be documented as owner-only infrastructure or configuration checks. Report live login and release as unverified until separately authorized and performed.

## Последовательность исполнения

Задачи 1–2 вводят идентификатор сессии и user-scoped browser API, на которые опираются задачи 3–4. Task 3 делает полный HTTPS-сценарий пригодным для телефона и ПК. Task 4 открывает только разрешённый личный путь и защищает все отложенные действия актуальными ролями. Task 5 закрывает контракт, проверки и документацию. После локальной реализации и проверок изменения остаются в `codex/jobs-member-hh`; push, PR, production migrations, VPS rollout и live HH login требуют отдельного поручения.
