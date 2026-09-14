# Telegram Unified Memory Gallery and VPN Owner Fix Implementation Plan

**Date:** 2026-09-14
**Design:** `docs/superpowers/specs/2026-09-14-telegram-unified-memory-gallery-vpn-owner-fix-design.md`
**Scope:** Cloud server and Telegram bot only
**Status:** Ready for implementation

## Objective

Fix the production `🔐 VPN` menu failure by preserving the canonical owner
context at the Telegram menu boundary. Add a paginated, owner-scoped gallery
under `🧠 Память` that combines every uploaded document with every readable
Visual Memory frame, sends the selected content to Telegram, and offers an
explicit delete-or-keep decision only after preview.

## Constraints

- Keep CommonJS and add no production dependency.
- Keep every VPN action behind the existing repository owner check.
- Do not treat the presence of a reply-keyboard label as authorization.
- Keep documents and Visual Memory in their existing stores and services.
- Never expose or persist storage keys, local paths, hashes, decrypted scene
  bodies, OCR, document bytes, image bytes, or VPN artifacts.
- Keep Telegram callbacks closed, fully validated, and at most 64 bytes.
- Keep gallery reads and mutations owner-scoped at their domain boundaries.
- Do not change Vision lease, consent, capture, or retention behavior.
- Do not modify or rebuild the Windows client.

## Phase 0: Reconfirm baseline and failure

1. Confirm the worktree contains only the committed design and plan history.
2. Run the smallest current suites:

   ```powershell
   cd server
   node --test test/telegramMenuService.test.js test/telegramMessageService.test.js test/telegramBot.test.js test/vpnCommandService.test.js test/knowledgeService.test.js test/visualMemory.test.js
   ```

3. Retain the verified production diagnosis in the update record: the current
   failure is `VPN_OWNER_REQUIRED` because `handleMenuAction()` receives `user`
   but not canonical `userId`, while `VpnCommandService.openMenu()` correctly
   requires `context.userId`.
4. Do not change production configuration or owner records to work around the
   bug.

Exit criterion: the existing suites are green and the implementation targets
the missing context field rather than weakening VPN authorization.

## Phase 1: Normalize Telegram menu context and fix VPN

### Files

- Modify `server/src/telegram/messageService.js`.
- Modify `server/src/telegram/telegramMenuService.js` only if a single context
  normalization helper belongs there.
- Extend `server/test/telegramMessageService.test.js`.
- Extend `server/test/telegramMenuService.test.js`.
- Extend `server/test/vpnCommandService.test.js` only for the unchanged domain
  authorization expectation.

### Steps

1. Add a focused builder that derives one menu context after allowlist lookup,
   user lookup, and conversation lookup. Include:

   - `user` and canonical `userId`;
   - `conversation` and canonical `conversationId`;
   - `telegramUserId` and `chatId`;
   - `originChannel: 'telegram'` and `originDeviceId: null`.

2. Use the same shape for bottom-menu actions, callbacks, and pending guided
   text.
3. Keep `TelegramMenuService.owner()` for presentation only.
4. Keep `VpnCommandService.openMenu()` and every subsequent VPN action calling
   `_requireOwner()`.
5. Add a regression test that follows the actual message-service path from
   `🔐 VPN` to `VpnCommandService.openMenu()` and asserts the canonical UUID is
   present.
6. Add a member test proving a forged VPN label still receives a neutral denial.

Exit criterion: owner VPN navigation succeeds without bypassing the repository
check, and a non-owner remains denied.

## Phase 2: Add the unified owner-scoped gallery query

### Files

- Add `server/src/telegram/telegramMemoryGalleryRepository.js`.
- Add `server/test/telegramMemoryGalleryRepository.test.js`.

### Repository contract

1. Implement one parameterized `UNION ALL` over active `documents` and readable
   `visual_memories`.
2. Bind `user_id` independently in both branches.
3. Return only:

   - closed source code `d` or `v`;
   - record UUID;
   - safe display label;
   - media type/category or visual source class;
   - byte length;
   - event timestamp.

4. Exclude `storage_key`, `blob_key`, hashes, owner IDs, device/lease/frame IDs,
   OCR, observations, captions that may contain private body text, and metadata
   objects not needed for presentation.
5. Order by event timestamp descending and UUID descending for deterministic
   pages.
6. Accept only a bounded integer page and fixed page size. Fetch one additional
   row to decide whether `➡️` is needed.
7. Accept an `includeVisual` boolean. When no visual reader is configured, omit
   the visual branch from results instead of presenting dead entries.

### Tests

- Assert both SQL branches bind the same owner.
- Assert SQL and parameters contain no user-controlled identifiers or table
  names.
- Assert storage internals are absent from the selected projection.
- Assert deterministic ordering, bounded page math, and next-page detection.
- Assert documents remain available when visual reading is disabled.

Exit criterion: the repository supplies safe merged metadata without reading
any file or decrypting any frame.

## Phase 3: Add owner-scoped preview reads

### Files

- Modify `server/src/knowledge/documentRepository.js`.
- Modify `server/src/knowledge/knowledgeService.js`.
- Extend the relevant knowledge repository/service tests.
- Extend `server/src/vision/visualMemoryService.js` only if a small delivery
  adapter is required.
- Extend `server/test/visualMemory.test.js`.

### Document read

1. Add `DocumentRepository.getActiveForUser({ userId, documentId })` selecting
   one non-deleted document by both identifiers.
2. Add `KnowledgeService.readForDelivery({ userId, documentId })` that:

   - fetches through the owner-scoped repository method;
   - reads the opaque storage key internally;
   - rejects empty or over-limit buffers;
   - returns only safe filename, validated MIME type, category, byte length, and
     the transient buffer.

3. Do not return the storage key or path to Telegram code.

### Visual read

1. Reuse `VisualMemoryService.read({ userId, memoryId })` for owner-scoped
   decryption.
2. Convert its base64 image into a bounded buffer only after validating content
   type and encoded-size limits.
3. Return a safe generated filename and a short caption derived only from
   non-sensitive presentation metadata.
4. Do not persist the decoded image or full observation.

### Tests

- Cross-owner document and frame reads return the same result as missing.
- Storage paths and keys never cross the service result boundary.
- Empty, malformed base64, unsupported MIME, and oversized payloads fail before
  Telegram delivery.
- A read failure does not call either deletion service.

Exit criterion: selected content can be obtained only through its existing
owner-scoped domain service as a transient bounded buffer.

## Phase 4: Implement the gallery coordinator and controls

### Files

- Add `server/src/telegram/telegramMemoryGalleryService.js`.
- Add `server/test/telegramMemoryGalleryService.test.js`.
- Modify `server/src/telegram/telegramMenuService.js`.
- Modify `server/src/telegram/bot.js` callback grammar.
- Extend `server/test/telegramMenu.test.js` and
  `server/test/telegramMenuService.test.js`.

### List flow

1. Add `🖼 Файлы и кадры` to the existing memory inline menu.
2. Route `gallery:page:<page>` to a bounded page render.
3. Map rows to human icons and labels without technical IDs:

   - Telegram/image document: `🖼`;
   - camera frame: `📷`;
   - screen frame: `🖥`;
   - PDF/office/text: `📄`;
   - audio: `🎵`;
   - video: `🎬`;
   - other file: `📦`.

4. Keep each label short enough for Telegram and include a safe date when useful.
5. Add bounded previous, next, and memory-back buttons.

### Preview flow

1. Parse `gallery:open:<source>:<uuid>:<page>` with a complete anchored regex.
2. Dispatch `d` only to `KnowledgeService` and `v` only to
   `VisualMemoryService`.
3. Return a transient media response with preview controls:

   - `gallery:delete:<source>:<uuid>:<page>`;
   - `gallery:keep:<page>`;
   - `gallery:page:<page>`.

4. Preview selection performs no mutation.

### Delete and keep flow

1. Keep/back only rerender the requested bounded page.
2. Delete dispatches to `KnowledgeService.remove()` or
   `VisualMemoryService.remove()` with the current `userId`.
3. Treat missing/already-deleted as a stale item, never as success for another
   record.
4. Return a generic deletion result and refreshed page without persisting the
   UUID or filename as user content.

Exit criterion: every item can be previewed before an explicit source-scoped
delete-or-keep decision.

## Phase 5: Extend the Telegram media transport

### Files

- Modify `server/src/telegram/bot.js`.
- Extend `server/test/telegramBot.test.js`.
- Modify `server/src/telegram/messageService.js` only for safe assistant-history
  text handling.
- Extend `server/test/telegramMessageService.test.js`.

### Transport contract

1. Validate one closed `media` result:

   - kind is `photo` or `document`;
   - content is a non-empty `Buffer` below the configured safe limit;
   - filename is sanitized and bounded;
   - MIME is allowlisted/bounded;
   - caption is bounded;
   - buttons pass the existing callback validator.

2. Use `ctx.replyWithPhoto(new InputFile(buffer, filename), options)` for safe
   images and `ctx.replyWithDocument(...)` for every other file.
3. If an image does not satisfy the safe Telegram photo contract, deliver it as
   a document rather than transforming it or adding a dependency.
4. Send post-preview controls with the media message.
5. Store only a generic assistant text such as `Файл отправлен для просмотра.`;
   never stringify or append the media object.
6. Do not delete content when Telegram delivery fails.

Exit criterion: the selected bytes are sent once, remain transient, and carry
the explicit decision buttons.

## Phase 6: Runtime wiring and regression verification

### Files

- Modify `server/src/runtime.js`.
- Extend `server/test/runtime.test.js` if wiring coverage exists there.

### Steps

1. Construct `TelegramMemoryGalleryRepository` from the existing PostgreSQL
   pool.
2. Construct `TelegramMemoryGalleryService` from the gallery repository,
   `KnowledgeService`, and optional `VisualMemoryService`.
3. Inject the gallery service into `TelegramMenuService`.
4. Keep document browsing available when Vision is disabled or its reader is
   unavailable.
5. Run focused suites:

   ```powershell
   cd server
   node --test test/telegramMemoryGalleryRepository.test.js test/telegramMemoryGalleryService.test.js test/telegramMenuService.test.js test/telegramMessageService.test.js test/telegramBot.test.js test/vpnCommandService.test.js test/knowledgeService.test.js test/visualMemory.test.js
   ```

6. Run the complete server suite:

   ```powershell
   npm test
   ```

7. Run `git diff --check` and inspect the full diff for generated files, secrets,
   raw paths, or binary fixtures.

Exit criterion: focused and full suites pass with no new dependency or trust
boundary regression.

## Phase 7: Documentation

### Files

- Update `README.md` only with behavior verified locally or in production.
- Update `docs/README.md` as the current status authority.
- Add `docs/updates/2026-09-14-telegram-memory-gallery-vpn-fix.md`.
- Add status notes to the design and this plan without rewriting their history.
- Update `AGENTS.md` only if current runtime ownership, safety boundaries, or
  verified production status materially changes.

Record:

- the confirmed VPN root cause and fix;
- supported gallery sources and preview behavior;
- owner scoping and non-persistence of binary content;
- focused/full test totals;
- exact production checks actually completed;
- manual client checks that remain.

## Phase 8: Production rollout

Proceed only after local verification and an explicit owner deployment request.

1. Run the VPS preflight:

   ```bash
   cd /home/deploy/apps/jarvis
   bash deploy/scripts/preflight.sh
   ```

2. Create a restricted rollback archive of only the server files that will be
   replaced. Do not include `.env`, secrets, documents, visual blobs, database
   data, or VPN state.
3. Transfer only the reviewed server source changes.
4. Rebuild and restart only the server under the `tunnel` profile:

   ```bash
   docker compose --profile tunnel --env-file deploy/.env -f deploy/docker-compose.yml up -d --build server
   ```

5. Confirm server, PostgreSQL, Cloudflare Tunnel, and existing ASR remain
   healthy.
6. Run:

   ```bash
   bash deploy/scripts/smoke.sh https://jarvis.rilora.ru
   ```

7. Inspect bounded sanitized server logs for polling and callback errors.
8. From the owner Telegram account:

   - open `🔐 VPN` and confirm both protocol menus render;
   - open `🧠 Память` → `🖼 Файлы и кадры`;
   - preview one image and one non-image document;
   - choose `✅ Оставить` on one item;
   - delete only a disposable test item and verify it disappears.

9. From a family-member account, verify owner controls and owner content are not
   available.
10. Update documentation only with results actually observed.
11. Commit the implementation with a repository-style message and push only
    after successful deployment, as requested by the owner. Never force-push.

## Commit checkpoints

The implementation may remain one cohesive commit after successful deployment,
but review it internally in these logical groups:

1. `fix: preserve Telegram owner context for VPN menu`
2. `feat: add Telegram memory file preview gallery`
3. `docs: record Telegram gallery production verification`

Do not commit a partial production claim. If deployment succeeds but a manual
Telegram scenario remains unverified, state that distinction explicitly.

## Completion checklist

- VPN menu opens for the authenticated owner and remains denied to members.
- Every uploaded document appears in paginated gallery navigation.
- Every readable retained Visual Memory frame appears when the reader is
  configured.
- Selecting an item sends its real image or file before any delete decision.
- Keep/back never mutate content.
- Delete is explicit, owner-scoped, idempotent, and delegated to the source
  service.
- Callbacks contain no paths, keys, content, or credentials.
- Binary preview data never enters conversations, logs, telemetry, or Life OS.
- Focused and full server suites pass.
- VPS preflight, Compose health, and public smoke pass after deployment.
- Documentation separates automated rollout evidence from manual Telegram
  acceptance.
