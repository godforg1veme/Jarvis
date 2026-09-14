# Telegram Unified Memory Gallery and VPN Owner Fix Design

**Date:** 2026-09-14

**Status:** Implemented and production-deployed on 2026-09-14. The complete
261-test server suite, server-only rebuild, Compose health, public smoke,
sanitized startup logs, a real production owner VPN-menu service call, and the
owner-scoped gallery query passed. Real Telegram media delivery and deletion of
a disposable item remain manual client acceptance.
**Status:** Approved for implementation

## Summary

Fix the Telegram `🔐 VPN` entry so it preserves the authenticated owner context
through the menu-to-domain boundary. Add one owner-scoped `🖼 Файлы и кадры`
gallery under `🧠 Память` that combines uploaded documents with retained Visual
Memory frames. Selecting an item sends the actual image or file before offering
separate `🗑 Удалить`, `✅ Оставить`, and back controls.

The gallery is a presentation and orchestration layer only. Documents and
Visual Memory retain independent storage, authorization, retention, and deletion
rules. Binary content, storage keys, local paths, and decrypted visual payloads
must never be written to conversations, callbacks, logs, or new database state.

## Goals

- Make the owner-visible VPN button open the existing VPN menu successfully.
- Keep the VPN domain authorization check on every VPN action.
- Present all uploaded documents and all available retained Visual Memory frames
  in one paginated Telegram gallery, newest first.
- Send images and visual frames as Telegram photos when supported.
- Send PDFs, office files, audio, video, and other documents as Telegram files.
- Let the user inspect content before choosing whether to remove it.
- Keep deletion explicit, owner-scoped, idempotent, and delegated to the source
  domain service.
- Preserve Telegram callback-size bounds and existing secret-handling rules.

## Non-goals

- Moving or copying Visual Memory blobs into document storage.
- Persisting Telegram file IDs as a new cache.
- Generating PDF or office-document thumbnails.
- Changing Vision capture leases, consent, or retention policy.
- Allowing family members to inspect another user's content.
- Removing the existing `📄 Документы` section or text-memory controls.
- Changing VPN confirmation policy or Host Agent operations.

## Confirmed VPN Failure

Production logs show `VPN_OWNER_REQUIRED` from
`VpnCommandService.openMenu()`. `TelegramMenuService` recognizes the Telegram
user as owner to render the button, but `handleMenuAction()` forwards a context
without the canonical `userId`. The VPN repository therefore receives an empty
owner identifier and correctly denies the request.

The fix is to create one normalized menu context containing `userId`,
`conversationId`, `telegramUserId`, `chatId`, and origin fields before routing
menu or callback actions. `VpnCommandService` continues to call its repository
owner check; the menu label never becomes authorization evidence.

## Architecture

### Unified metadata query

Add a focused gallery repository that reads presentation-safe metadata from
`documents` and `visual_memories` with an owner-scoped `UNION ALL`. It returns
only a closed source kind, opaque record ID, display label, media type/category,
source label, byte length, and capture/create timestamp. Storage keys, hashes,
device identifiers, lease identifiers, OCR, and scene bodies are excluded.

The query orders by timestamp and opaque ID for deterministic pagination. It
uses a bounded numeric offset and page size. The UI exposes previous and next
buttons only when those pages exist. Page callbacks contain only bounded page
numbers; item callbacks contain a closed source code plus UUID and remain below
Telegram's 64-byte callback limit.

### Gallery service

Add a small Telegram gallery service responsible for:

- mapping safe metadata into human labels;
- listing a bounded page;
- resolving an owner-scoped item selection;
- delegating document bytes to `KnowledgeService`;
- delegating frame decryption to `VisualMemoryService`;
- mapping deletion to the source service;
- returning a closed media response for the Telegram transport.

It does not read storage paths directly and does not implement deletion SQL.

`KnowledgeService` gains an owner-scoped read method that retrieves one active
document through the repository, reads its opaque storage key internally, and
returns bounded delivery metadata plus a buffer. `VisualMemoryService.read()`
remains the only decryption path for frames. Visual entries are shown only when
the visual-memory reader is configured and capable of reading them; an inactive
Vision capture provider must not prevent ordinary document browsing.

### Telegram transport

Extend the closed Telegram result contract with one transient media object:

- `kind`: `photo` or `document`;
- a bounded `Buffer`;
- validated MIME type and safe filename/caption;
- the inline post-preview controls.

The bot sends photos with `replyWithPhoto` and all other files with
`replyWithDocument`, using Grammy `InputFile`. The buffer is never appended to
conversation history. Text sent to the conversation repository contains only a
generic preview response without storage metadata.

## Interaction Flow

1. `🧠 Память` retains the existing text-memory controls and adds
   `🖼 Файлы и кадры`.
2. The gallery lists all source types newest first with clear icons: photo,
   camera, screen, PDF/office, audio, video, and generic file.
3. `⬅️` and `➡️` navigate bounded pages without creating conversation turns.
4. Selecting a document revalidates ownership, reads it through
   `KnowledgeService`, and sends it as a photo or file.
5. Selecting a frame revalidates ownership, decrypts it through
   `VisualMemoryService`, and sends it as a photo.
6. The preview message includes `🗑 Удалить`, `✅ Оставить`, and `← Назад`.
7. `✅ Оставить` and back perform no mutation and return to the current gallery
   page.
8. `🗑 Удалить` invokes the correct source service. Documents are removed through
   `KnowledgeService.remove()`; frames are marked deleted and their encrypted
   blob is removed through `VisualMemoryService.remove()`.
9. The result reports deletion without exposing an ID or path and returns to an
   updated gallery page.

The delete button is the explicit destructive decision requested by the user;
there is no deletion on item selection or preview delivery.

## Callback Contract

Add only closed callback forms:

```text
gallery:page:<bounded-number>
gallery:open:d:<uuid>:<bounded-page>
gallery:open:v:<uuid>:<bounded-page>
gallery:delete:d:<uuid>:<bounded-page>
gallery:delete:v:<uuid>:<bounded-page>
gallery:keep:<bounded-page>
```

The parser validates the complete string, UUID format, page range, and Telegram
byte limit before dispatch. A source code selects a declared service, never a
table name or filesystem path.

## Error Handling

- A stale or already-deleted item returns a neutral unavailable message and a
  refreshed gallery page.
- A forged cross-owner UUID is indistinguishable from a missing item.
- Repeated delete callbacks are idempotent and do not affect another record.
- A missing Visual Memory reader omits visual entries or reports them
  unavailable without exposing configuration state.
- Decryption or storage-read errors are logged only with bounded error codes and
  opaque record IDs under the existing logging policy; user-facing text contains
  no internal error.
- Media size is checked before Telegram delivery. Oversized content remains
  stored and receives a clear non-destructive response.
- Telegram transport failure does not delete the source and does not mark a
  preview as successful.
- VPN owner failures remain sanitized, while unexpected errors continue through
  the bot's bounded error handler.

## Security and Privacy

- Every list, read, and delete operation includes `userId` at the database or
  domain-service boundary.
- Menu visibility is presentation only; VPN and gallery actions repeat domain
  authorization.
- The gallery repository exposes metadata only and uses parameterized SQL.
- No callback contains a storage key, path, credential, OCR text, scene body, or
  document contents.
- Visual blobs are decrypted only for the selected owner-scoped preview and held
  transiently in process memory.
- Document bytes and image bytes are never persisted to conversation history,
  telemetry, Life OS, or logs by the preview flow.
- Existing Telegram download and upload size limits remain authoritative.
- VPN artifacts and confirmation behavior are unchanged.

## Verification

Focused tests must cover:

- normalized menu context contains the canonical owner and conversation IDs;
- owner VPN menu succeeds and member VPN access is denied;
- gallery metadata query is owner-scoped, parameterized, deterministic, and
  excludes storage internals;
- documents and available visual frames merge in timestamp order;
- page controls stay within callback and row limits;
- images use photo delivery while all other items use document delivery;
- preview buffers and storage metadata are absent from stored conversation text;
- keep/back cause no mutation;
- document deletion and visual deletion call only their respective source
  service;
- stale, duplicate, cross-owner, unavailable, oversized, and read/decrypt failure
  paths are safe;
- existing VPN, Telegram, knowledge, and visual-memory tests remain green.

Then run the complete server suite with `npm test`.

Production rollout requires `deploy/scripts/preflight.sh`, a server-only image
rebuild, Compose health, migration status, bounded sanitized logs, and
`deploy/scripts/smoke.sh`. Manual Telegram acceptance uses an owner account to
open VPN, preview one image, preview one non-image document, keep one item, and
delete one disposable test item. A family member verifies isolation without
receiving owner content or controls.

## Acceptance Criteria

The owner can open VPN from the persistent menu without an internal error. From
`🧠 Память`, the user can browse every available uploaded document and readable
Visual Memory frame, select one, receive the actual content, and decide
separately to delete or keep it. No selection deletes content, every mutation is
owner-scoped and source-delegated, and no binary data or storage internals enter
persistent conversation or callback state.
