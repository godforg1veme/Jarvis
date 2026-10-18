# Telegram Mini App Implementation Plan

> **For agentic workers:** Execute the independent access/API and client tasks
> with separate agents; the integrating agent owns runtime, Telegram and jobs.
> Steps use checkbox syntax for tracking. Review and test each deliverable.

**Goal:** Local, reviewable Telegram Mini App with verified Telegram identity,
durable role administration and personal overrides, preserving private data.

**Architecture:** Keep existing Fastify/CommonJS and PostgreSQL. AccessService
is the shared authority for Mini App and Telegram. Three.js stays a local client
dependency; a build script emits an allowlisted static bundle under mini-app/dist.

**Tech Stack:** Node.js 22.12+, Fastify, pg, existing zod, browser ES modules,
Three.js 0.186.1. No additional production dependencies.

**Spec:** ../specs/2026-10-18-telegram-mini-app-design.md

## Global Constraints

Execution result, October 18: local access/API/client/runtime implementation
is complete, 741 server tests and 8 PostgreSQL acceptance tests passed along
with both browser suites and the Mini App build. The original work items below
remain as the execution recipe. Production Docker/Caddy build, deployment,
real Telegram/phone acceptance and a separate second HH connection remain.
Actual details: ../../updates/2026-10-18-telegram-mini-app-development.md.

- Telegram ID as string; no email and no username-based authentication.
- Owner authority derives from operationsOwnerTelegramId, not a body field.
- Personal allow/deny overrides role; block denies all; owner is protected.
- Administrator privileges do not grant access to another person's data.
- Existing Supervisor, resource scope and origin-bound confirmations remain.
- Never store raw initData/session credentials in URLs, logs or localStorage.
- Keep preview separate from production UI; no production demo/auth fallback.
- Only local work; publication, real Telegram configuration and VPS await release.
- Three.js is approved. Do not add other production dependencies.
- PostgreSQL acceptance must use an isolated database, never production data.

## Shared interfaces

```js
// server/src/access/accessService.js
new AccessService({ pool, ownerTelegramId, legacyAllowedIds })
await service.initialize();
await service.getAccessForTelegram(telegramId);
await service.getAccessForUser(userId);
await service.isAllowedTelegram(telegramId); // false for unregistered/blocked
await service.allows(userId, permission);
// Access result: { userId, telegramId, displayName, level, blocked,
// roleId, overrides, permissions: string[], revision }; null if unknown.
```

HTTP contract, prefixed `/mini/api`:

```js
POST /session // { initData }; HttpOnly cookie, {ok, csrfToken, actor, catalog}
GET /me // {ok, csrfToken, actor, catalog}
POST /logout // Origin + X-Jarvis-CSRF, revoke original session
GET /admin // {ok, users, roles, audit}; administrative metadata only
POST /admin/users // {operationId,telegramId,displayName,roleId,level}
PATCH /admin/users/:telegramId // {operationId,revision,roleId,overrides,blocked,level}
POST /admin/roles // {operationId,name,permissions}
PATCH /admin/roles/:id // {operationId,revision,name,permissions}
GET /admin/operations/:id // original outcome, scoped to acting administrator
// Roles: {id,name,permissions:string[],revision}
// User fields match Access result; level owner|admin|member.
// Overrides: partial object of permission => allow|deny (inherit = absent).
// Mutation responses: {ok:true,result}; errors {ok:false,code}; fixed codes.
// X-Jarvis-CSRF on every mutation after login; same-origin check at login too.
```

## Task 1: PostgreSQL authority and Mini App authentication

**Files:** create server/src/access/{permissionCatalog,accessPolicy,
accessRepository,accessService}.js, server/src/miniApp/{initData,sessionService,
routes}.js, server/src/db/migrations/037_access_mini_app.sql,
server/test/{miniAppAuth,accessPolicy,miniAppRoutes}.test.js and isolated
server/test/miniAppPostgresAcceptance.cjs.

**Consumes:** existing pool/users/user_identities; shared contract above.
**Produces:** AccessService and registerMiniAppRoutes(app,{config,accessService,pool}).

- [ ] Test HMAC validation, duplicate fields, bounds, stale/future auth_date,
  no initDataUnsafe authority, forged user, blocked user and cookie revocation.
  Signature algorithm:
  ```js
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const signature = createHmac('sha256', secret).update(dataCheckString).digest();
  timingSafeEqual(signature, suppliedHash);
  ```
- [ ] Build forward-only tables with closed permissions, FK constraints,
  revisions, session hashes, operation dedup and bounded safe audit records.
- [ ] Implement transactional policy writes: acquire global access-admin
  advisory lock, resolve actor from DB inside transaction, verify owner/admin,
  protect owner and admin targets, verify revision, apply, persist operation
  result/audit, commit. Bind operation ID to actor and canonical payload digest.
- [ ] Bootstrap configured owner and existing allowlist preserving member
  sections assistant/life/memory/documents/devices; never re-enable blocked
  accounts or overwrite later assignments on restart.
- [ ] Register session/admin APIs with body limits, exact schemas, bounded
  query sizes, rate limits, secure cookie, CSRF and fixed safe errors. Verify
  Origin exactly against configured HTTPS origin. No raw error logging.
- [ ] Run `node --test server/test/accessPolicy.test.js server/test/miniAppAuth.test.js server/test/miniAppRoutes.test.js`.
- [ ] Run isolated PostgreSQL acceptance for CAS, parallel writes, dedup,
  cross-actor operation replay, privilege escalation, inherited/explicit rights,
  startup idempotence and session revocation.

## Task 2: Live Mini App client

**Files:** mini-app/index.html, mini-app/src/{app,core,api,admin}.js,
mini-app/src/style.css, mini-app/build.js, mini-app/preview-server.js,
mini-app/package.json, scripts/testMiniAppPreview.cjs and
scripts/testMiniAppClient.cjs.

**Consumes:** shared HTTP contract. **Produces:** `npm run build --prefix mini-app`
static production files and separate loopback-only design preview.

- [ ] Keep existing preview as explicit `/preview` or a separate preview
  entrypoint. Production boot reads Telegram.WebApp.initData and sends it to
  `/mini/api/session`, never trusts initDataUnsafe, and fails closed when outside
  Telegram. Restore an existing session with GET /me. Do not ask for email.
- [ ] Implement fetch wrapper returning fixed public errors, same-origin
  credentials and in-memory CSRF. Mutations retain operation ID while outcome
  is uncertain; query original ID, do not retry under a fresh ID.
- [ ] Render identity and effective sections from /me; hide administration for
  members. Admin list/role/user editors use real APIs, revision and confirmation
  summary. Include owner-only admin promotion/demotion with protected owner.
- [ ] Add safe loading/expired/forbidden/conflict/unavailable/unknown states.
  Preserve draft on failure. Render all names as text, not HTML.
- [ ] Preserve procedural 3D and motion accessibility. Build by copying only
  explicit source/vendor assets, no new bundler dependency. Production uses
  external modules and supports strict CSP without unsafe-inline/eval.
- [ ] Run existing preview test and synthetic real-client tests for login,
  roles, overrides, protected targets, failure recovery, 320/390/desktop,
  keyboard, no Telegram, no localStorage credentials and no external requests
  except official Telegram SDK.

## Task 3: Runtime, permission gates and safe deployment build

**Files:** server/src/config/loadConfig.js, server/src/runtime.js,
server/src/app.js, server/src/telegram/{accessPolicy,messageService,
telegramMenu,telegramMenuService}.js, server/src/jobs affected paths,
deploy/server.Dockerfile and focused tests/docs.

**Consumes:** Tasks 1/2. **Produces:** actual local app served at /mini/.

- [ ] Add explicit MINI_APP_ENABLED (default false) and MINI_APP_PUBLIC_ORIGIN
  validation; initialize authority before routes/workers when enabled.
- [ ] Serve only built static files. Scope Telegram frame-ancestor exceptions
  and SDK CSP to /mini/. Preserve Ops/subscription protections. Suppress raw
  mini API URL/error logging, use closed error codes only.
- [ ] Announce Telegram route changes before editing. Apply shared authority
  to sender allowlist, keyboard filtering, callbacks, direct commands, guided
  states, voice/files and assistant context. Check revoked permissions before
  work and before delivery. No boolean coercion of asynchronous isAllowed.
- [ ] Preserve owner-only Supervisor and VPN privileged operations. Do not
  weaken operations session authority. UI describes unavailable delegation.
- [ ] Inspect jobs browser credentials/collector ownership before expanding
  jobs. Never send another user's HH account to a shared owner browser. Make
  denied jobs workers stop new work/delivery and keep original-ID reconciliation.
  If separate HH browser sessions are not provisioned, show explicit setup
  requirement instead of claiming working multi-user search.
- [ ] Build mini UI in Docker build stage and copy dist to public/mini.
  Ensure Electron excludes mini-app resources as already established.
- [ ] Run focused Telegram gate and full `npm test --prefix server`, Mini App
  browser tests, PostgreSQL acceptance, build and `git diff --check`.

## Task 4: Review and handoff

- [ ] Self-review authentication, owner protection, foreign data, revoked
  sessions/rights, strict payloads, no secret logs, no unknown-operation retry.
- [ ] Update bilingual mini-app README, docs/README, verification and dated
  development result. Update Telegram menu contract for actual changed behavior.
- [ ] Record tested/untested separately: local browser fixtures and isolated
  PostgreSQL versus real Telegram/phone/HH/VPS. Local commit; no push.
- [ ] Offer production publication only after local reviewable result and
  report exact updated components and remaining real-client checks.
