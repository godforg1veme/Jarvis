# Telegram Human Button Navigation Design

**Date:** 2026-09-14  
**Status:** Approved for implementation planning

## Summary

Jarvis Telegram control will use a persistent, role-aware reply keyboard for
top-level navigation. Users will no longer need to type slash commands for
ordinary bot features. Dynamic choices and all confirmations remain inline
buttons attached to the relevant bot message.

Text input remains only where the value cannot be selected safely from a
bounded list, such as a new VPN access label, a computer name, a memory fact, or
a natural-language Desktop instruction. In those flows Jarvis asks for the
value directly; the user never has to repeat a command prefix.

Existing slash commands remain available as a compatibility and recovery path,
but user-facing help and navigation no longer depend on them.

## Goals

- Make every existing user-facing Telegram command reachable through human,
  Russian-language buttons.
- Keep the main navigation visible at the bottom of the Telegram chat.
- Preserve inline, one-time confirmation for changing or destructive actions.
- Show administrative sections only to the owner.
- Add a dedicated Operations panel entry without changing the panel's existing
  browser approval boundary.
- Support multi-step text entry without losing context across server restarts.
- Keep current owner scoping, update deduplication, callback validation, secret
  handling, and action confirmation guarantees.

## Non-goals

- Removing slash-command support.
- Turning Operations into a Telegram Mini App.
- Replacing natural-language Desktop instructions with one button per Tool
  Gateway action.
- Letting Telegram start or extend a local Vision Lease.
- Changing VPN, device, document, Life OS, memory, or Operations business
  rules beyond the interaction needed for button navigation.
- Adding arbitrary URLs or arbitrary model-generated callback actions.

## Interaction Model

### Persistent role-aware keyboard

The owner sees:

```text
[🏠 Главное]       [🎯 Life OS]
[🧠 Память]        [📄 Документы]
[🖥 Устройства]    [🔐 VPN]
[📊 Панель]        [❓ Помощь]
```

A family member sees:

```text
[🏠 Главное]       [🎯 Life OS]
[🧠 Память]        [📄 Документы]
[🖥 Устройства]    [❓ Помощь]
```

The keyboard is resized for the Telegram client and remains available after
ordinary bot answers. Owner-only buttons are omitted for non-owners, but every
server-side handler still repeats authorization checks. Button recognition is
an exact match against the closed menu catalog. Similar free text must not be
treated as a privileged menu action.

`/start` and `🏠 Главное` explicitly install the appropriate role keyboard.
Because Telegram retains a reply keyboard until it is replaced, inline messages
do not need to resend it. `🏠 Главное` also cancels any unfinished text entry
flow in the current chat.

### Inline controls

Inline buttons remain attached to the message whose object or decision they
control. They are used for:

- selecting a VPN protocol or VPN client;
- actions on a selected VPN client;
- selecting and deleting a document;
- selecting and revoking a device;
- accepting or dismissing a Life OS proposal;
- confirming or rejecting a Desktop or VPN mutation;
- opening the configured Operations URL;
- approving or denying an Operations browser session.

Callbacks remain bounded, grammatically validated, owner-scoped, and limited
to 64 UTF-8 bytes. Technical IDs are never shown in message text.

## Navigation and Feature Flows

### Home

`🏠 Главное` shows a short readiness message and explains the sections available
to the current role. It does not query or display new monitoring data. The
action closes any pending input flow and restores the role keyboard.

### Life OS

`🎯 Life OS` opens the existing Mission Control summary:

- current mission;
- up to five near-term commitments;
- up to five proposals.

Each proposal keeps its current inline `✅ Принять` and `Не сейчас` actions.
The callback remains scoped to the proposal's owner and originating Telegram
conversation.

### Memory

`🧠 Память` opens inline actions:

- `📋 Что ты помнишь` lists active memories using the existing bounded list;
- `➕ Запомнить` starts a text-entry flow for one fact;
- `✏️ Исправить` shows the bounded active-memory list, lets the user select one
  fact by inline button, then asks for the replacement text;
- `🗑 Забыть` shows the same owner-scoped list and presents an inline
  confirmation for the selected fact before deactivation.

Memory navigation uses closed `mem:*` callbacks. A memory selected for
correction or removal is referenced by its owner-scoped opaque ID; callback text
does not contain the memory body.

The existing sensitive-memory filter remains authoritative. Passwords, tokens,
keys, payment data, and other currently prohibited values must still be
rejected. The button flow calls `MemoryService`; it does not write memories
directly.

### Documents

`📄 Документы` lists the owner's documents and their public ingest status. It
also offers `➕ Добавить документ`, which explains that the user can send a file
directly to the chat.

Each listed document can expose `🗑 Удалить`. Deletion requires the existing
inline confirmation and owner-scoped document lookup. The callback must not
accept a document owned by another user. There is no new document-download
feature in this work.

### Devices and Desktop instructions

`🖥 Устройства` opens:

- `📋 Мои устройства`;
- `➕ Подключить компьютер`.

Pairing asks for a human-readable computer name as plain text, then uses the
existing `DeviceService.beginPairing` flow to return the temporary code and
Desktop instructions. The user never types `/pair`.

The device list shows safe status metadata and lets the user choose an active
device. A selected device offers:

- `🎮 Дать поручение`, which starts a text-entry flow bound to that device;
- `⛔ Отозвать доступ`, which retains the current inline confirmation.

The Desktop instruction is passed through the existing orchestrator and action
manifest with an optional `preferredDeviceId`. The orchestrator validates that
the selected device belongs to the current user and declares the requested
capability before execution. Jarvis still plans only declared, schema-validated
actions. Safe operations follow existing policy; changing operations produce
inline `✅ Подтвердить` and `✖️ Отмена` buttons bound to the originating
Telegram channel. Telegram cannot start, add, or extend Vision capture sources.

### VPN

`🔐 VPN` is owner-only and first opens protocol selection:

```text
[⚡ Hysteria2 — рекомендуется]
[🛡 VLESS — резерв]
```

Each protocol page offers:

```text
[🔄 Статус] [👥 Мои доступы]
[➕ Новый доступ]
[♻️ Перезапустить]
[← Выбор протокола]
```

`➕ Новый доступ` starts a ten-minute text-entry flow that asks only for the
access label, for example `iPhone Максима`. The protocol is retained as safe
interaction context. A valid label produces the existing inline confirmation;
approval executes the existing closed Host Agent operation and returns the
one-time Happ import artifact. No raw URI is persisted in PostgreSQL,
conversation text, memory, telemetry, or logs.

The client list lets the owner select a label and then choose:

- `📄 Получить конфиг`;
- `🔁 Перевыпустить`;
- `🗑 Отозвать`.

All three operations keep one-time, origin-bound inline confirmation. Restart
also requires confirmation and warns that active connections may briefly drop.
After completion or cancellation Jarvis returns to the selected protocol page.

### Operations panel

`📊 Панель` is owner-only. It returns a short explanation and a single inline
URL button, `🌐 Открыть Operations`, pointing to exactly the configured
`operationsPublicOrigin` plus `/ops/`.

The button does not grant a session and does not bypass browser authentication.
The panel continues to request Telegram approval, delivered as a separate
message with `✅ Разрешить` and `Отклонить`. Those callbacks remain bound to the
configured owner Telegram ID and retain their existing expiry and one-time
semantics.

Arbitrary URLs are not accepted in menu results. If Operations is disabled or
its public origin is unavailable, the menu reports that the panel is currently
unavailable and sends no link.

### Help

`❓ Помощь` describes normal text questions, voice notes, file upload, each
visible section, and the confirmation model. User-facing help does not require
slash commands. A short compatibility note may state that legacy commands
remain available for recovery.

## Multi-step Input State

A new PostgreSQL-backed Telegram interaction repository stores unfinished
input flows. The schema records:

- an opaque interaction ID;
- `user_id` and `conversation_id` ownership;
- the Telegram chat identifier needed to enforce the originating chat;
- a closed interaction kind;
- a small, schema-validated JSON context;
- status and expiry timestamps;
- creation and update timestamps.

Only one active interaction is allowed per user and Telegram conversation.
Safe context may contain a VPN protocol, selected device ID, or the stage of a
memory correction. It must not contain VPN credentials, file bodies, voice
data, arbitrary local paths, raw tool arguments, or conversation history.

Supported initial interaction kinds are:

- `vpn_access_label`;
- `device_pairing_name`;
- `device_instruction`;
- `memory_add`;
- `memory_correct_replacement`.

The default input deadline is ten minutes. Starting another section, pressing
`🏠 Главное`, or pressing `✖️ Отмена` atomically cancels the previous active
interaction. The role keyboard stays installed while Jarvis waits for text.
Each input prompt carries an inline `✖️ Отмена` callback bound to that
interaction, while `🏠 Главное` remains available on the persistent keyboard.
This avoids Telegram's restriction that a single message can carry either a
reply keyboard or an inline keyboard, but not both.

The repository must claim or advance a pending interaction atomically so that
duplicate or concurrent Telegram delivery cannot consume the same input twice.
The existing `telegram_updates` claim remains the first deduplication boundary.

If an interaction expires before the next message, Jarvis explains that the
step expired and treats the message as ordinary conversation input. It must not
silently reinterpret an unrelated message as a privileged parameter.

## Component Boundaries

### Telegram menu catalog

A focused module owns:

- canonical Russian labels;
- owner and member reply keyboards;
- the temporary cancel keyboard;
- exact mapping from a button label to a closed menu action;
- bounded builders for inline callback and URL buttons.

The catalog contains presentation and closed identifiers only. It does not
perform database access or business operations.

### Telegram menu service

A focused service handles top-level menu actions and multi-step input. It
depends on existing domain services and on the new interaction repository. It
must call domain service interfaces instead of duplicating VPN, device,
document, memory, Life OS, or Operations rules.

### Telegram message service

`TelegramMessageService` remains the coordinator. After identity, allowlist,
deduplication, user, and conversation resolution it routes in this order:

1. exact global navigation or cancellation buttons;
2. an active, non-expired text interaction;
3. existing closed slash-command compatibility handlers;
4. existing orchestrator, memory inference, and assistant conversation paths.

Attachments and voice notes keep their existing bounded processing. A pending
text interaction must never cause attachment or raw voice bytes to be stored as
the requested value.

Exact menu labels and interaction-control callbacks are presentation events:
they are not appended as user conversation content and do not enter the Life OS
Event Spine. A Desktop instruction remains ordinary owner-authored conversation
content. VPN labels and pairing names are passed only to their bounded domain
flows; memory input is persisted only under the existing Memory Service rules.

### Telegram transport

Transport results support separate fields for:

- a reply keyboard;
- inline callback buttons;
- a validated inline Operations URL button;
- an optional existing VPN artifact.

Long messages attach markup only to the final Telegram chunk. Existing safe
HTML formatting remains unchanged. Callback-data and URL validation happen
before calling Telegram.

## Authorization and Trust Boundaries

- Allowlist rejection happens before user or interaction persistence.
- Owner-only menu visibility uses the resolved user role and configured owner
  identity; owner-only handlers repeat the authoritative domain check.
- Menu labels are presentation, never authorization.
- Callback targets are loaded with the current `user_id` before execution.
- Changing remote actions retain confirmation in the client where the request
  originated.
- Models never generate callback data, URLs, Host Agent operation names, shell,
  or PowerShell.
- Operations links use only the configured HTTPS origin and fixed `/ops/`
  path.
- One-time VPN artifacts retain the current non-persistence contract.
- Jarvis never claims a Desktop or Host Agent action succeeded without the
  verified existing service result.

## Error Handling

- An expired or consumed callback reports that the button is no longer
  available and offers a safe return to the relevant list.
- An expired input interaction reports expiry, leaves the role keyboard in
  place, and does not execute an action.
- Invalid labels or names explain the accepted human format and keep the user
  in the same bounded input step until expiry or cancellation.
- Missing or revoked objects report a human-readable error and return to the
  current section.
- Unavailable Desktop or Host Agent responses are never reported as success.
- Unknown Host Agent mutation outcomes preserve the current no-retry rule.
- Disabled feature services produce an unavailable message rather than routing
  button text to the language model.
- Any unexpected error is logged without secrets and receives the existing
  generic Telegram failure response.

## Compatibility and Rollout

- Existing `/life`, `/documents`, `/document_delete`, `/devices`, `/pair`,
  `/revoke`, `/memory`, `/vpn*`, `/desktop`, `/confirm`, and `/reject` paths
  remain supported.
- Help and success messages stop instructing users to copy technical IDs or
  compose slash commands.
- Old inline callbacks remain valid for their existing lifetime.
- The database migration is additive and must deploy before the server version
  that writes interaction state.
- No new production dependency is required.
- This is a cloud/server and Telegram change; it does not require rebuilding
  the Windows Desktop executable.

## Verification

Focused automated coverage must verify:

- owner and member reply keyboard contents and layout;
- exact label matching and rejection of lookalike free text;
- installation of the correct role keyboard on start and its persistence
  through completion, cancellation, and expiry;
- every top-level menu route;
- VPN access creation without a slash command for both protocols;
- VPN client export, rotation, revocation, restart, confirmation, cancellation,
  duplicate callbacks, and expired callbacks;
- device pairing without `/pair`;
- device selection and bound natural-language instruction context;
- device revoke confirmation;
- memory list, add, correction, forget confirmation, and sensitive-data
  rejection;
- document list, upload guidance, and delete confirmation;
- Life OS proposal actions;
- owner-only Operations visibility and exact configured `/ops/` link;
- existing Operations browser approval callback coexistence;
- interaction isolation across users and chats;
- atomic handling of duplicate updates and concurrent interaction consumption;
- persistence across a simulated service restart;
- no credentials, raw artifacts, raw voice, file bodies, or technical IDs in
  stored conversation content or logs;
- backward compatibility for existing slash commands.

Run the smallest Telegram, VPN, memory, device, document, Life OS, Operations
session, and callback tests first. Then run the complete server suite with
`npm test` from `server/`. Production acceptance covers role-aware `/start`, all
top-level buttons, one Hysteria2 create-confirm-export cycle, one cancelled
mutation, one pairing flow, the Operations link and browser approval, clean
logs, and healthy Jarvis/Xray/Hysteria2 checks.

## Acceptance Criteria

The work is complete when an allowlisted Telegram user can discover and use
every existing user-facing bot feature without typing a slash command; only
unavoidable parameter values and natural-language requests require text. The
owner receives VPN and Operations controls, family members do not, every
action that requires confirmation under existing policy retains an inline
confirmation, pending input survives a server restart safely, and the full
server test suite passes without weakening any existing trust boundary.
