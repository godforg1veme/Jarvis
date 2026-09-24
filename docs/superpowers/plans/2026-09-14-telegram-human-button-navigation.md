# Telegram Human Button Navigation Implementation Plan

**Date:** 2026-09-14  
**Design:** `docs/superpowers/specs/2026-09-14-telegram-human-button-navigation-design.md`  
**Scope:** Cloud server and Telegram bot only  
**Status:** Implemented and deployed; live owner/member Telegram acceptance pending

## Objective

Replace user-facing Telegram slash-command navigation with a persistent,
role-aware bottom keyboard while retaining bounded inline selection and
one-time confirmation. Add restart-safe text-entry flows for values that cannot
be represented by buttons, and add an owner-only Operations panel link without
bypassing browser approval.

## Constraints

- Keep CommonJS and add no production dependency.
- Preserve all current slash commands as compatibility paths.
- Reuse domain services; do not duplicate VPN, device, memory, document, Life
  OS, orchestrator, or Operations business rules.
- Never persist VPN artifacts, credentials, raw audio, file bodies, arbitrary
  local paths, or raw tool arguments in Telegram interaction state.
- Keep confirmation bound to the originating user and Telegram channel.
- Do not make Desktop, Host Agent, PostgreSQL, or internal services public.
- Do not build or modify the Windows executable; this is server-only work.

## Phase 0: Establish the baseline

1. Run the current focused suites before editing:

   ```powershell
   cd server
   node --test test/telegramBot.test.js test/telegramMessageService.test.js test/vpnCommandService.test.js test/actionOrchestrator.test.js
   ```

2. Record any pre-existing failure and stop if it overlaps Telegram, VPN,
   orchestration, identity, or Operations approval behavior.
3. Confirm the worktree contains only expected changes after the already
   committed design and plan documents.

## Phase 1: Persist bounded Telegram input interactions

### Files

- Add `server/src/db/migrations/015_telegram_interactions.sql`.
- Add `server/src/telegram/telegramInteractionRepository.js`.
- Add `server/test/telegramInteractionRepository.test.js`.

### Database contract

Create `telegram_interactions` with:

- UUID primary key;
- `user_id` and `conversation_id` foreign keys;
- bounded Telegram `chat_id`;
- a checked closed `kind` enum covering VPN label, pairing name, Desktop
  instruction, memory add, and memory replacement;
- bounded JSON object `context`;
- checked `status` (`active`, `consumed`, `cancelled`, `expired`);
- `expires_at`, `created_at`, and `updated_at` timestamps;
- a partial unique index allowing one active row per user/conversation.

Repository operations:

- `begin` cancels an existing active interaction and creates the new one in one
  transaction;
- `getActive` returns only an owner/chat-matching non-expired interaction and
  marks stale rows expired;
- `advance` atomically changes kind/context for the same active interaction;
- `consume` atomically moves one active row to consumed;
- `cancel` atomically cancels the active interaction for the user/chat;
- all context is schema-validated and byte-bounded before persistence.

### Tests

- one active interaction per conversation;
- isolation across users and chats;
- begin replaces an earlier interaction atomically;
- consume/advance work once under concurrent calls;
- expiry and cancellation are terminal;
- rejected context includes no unbounded or unknown fields.

Commit: `feat(server): persist Telegram input interactions`

## Phase 2: Add the closed menu and transport contracts

### Files

- Add `server/src/telegram/telegramMenu.js`.
- Modify `server/src/telegram/bot.js`.
- Extend `server/test/telegramBot.test.js`.
- Add `server/test/telegramMenu.test.js`.

### Menu catalog

Define canonical labels once and export:

- exact label-to-action parsing;
- owner and member reply-keyboard builders;
- the owner/member button layouts from the approved design;
- bounded inline builders for `mem:*`, expanded `doc:*`, expanded `dev:*`,
  current `life:*`, current `vpn:*`, current `cmd:*`, `flow:cancel:*`, and
  Operations approval callbacks.

Button labels are presentation only. The parser must return `null` for case,
spacing, or Unicode lookalikes instead of guessing a privileged action.

### Transport result shape

Separate these response fields:

- `replyKeyboard` for the persistent bottom keyboard;
- `buttons` for inline callback buttons;
- `panelLink` for the one permitted inline Operations URL;
- existing `artifact` for one-time VPN files.

Only one Telegram `reply_markup` is attached to a message. Inline messages do
not replace the already installed persistent keyboard. Long replies attach
markup to the final chunk only.

Validate `panelLink` against the exact configured HTTPS Operations URL before
sending. Reject arbitrary schemes, origins, paths, and mixed callback/URL
button objects.

### Tests

- exact owner/member keyboard snapshots;
- one button is never interpreted as arbitrary text or a slash command;
- callback grammar and Telegram 64-byte limit;
- exact Operations URL acceptance and hostile URL rejection;
- reply and inline markup serialization;
- markup only on the final long-message chunk;
- current VPN artifact validation remains unchanged.

Commit: `feat(telegram): add role-aware menu transport`

## Phase 3: Introduce the Telegram menu coordinator

### Files

- Add `server/src/telegram/telegramMenuService.js`.
- Add `server/test/telegramMenuService.test.js`.
- Modify `server/src/telegram/messageService.js`.
- Modify `server/src/runtime.js`.
- Extend `server/test/telegramMessageService.test.js`.

### Service boundary

Construct `TelegramMenuService` with the interaction repository, existing
domain services, orchestrator, configured owner Telegram ID, Operations enabled
state, and the canonical panel URL.

It owns presentation and flow coordination only. It exposes:

- `handleMenuAction` for exact bottom-keyboard actions;
- `handleCallback` for non-confirmation menu callbacks;
- `handlePendingText` for a claimed input interaction;
- `cancelPending` for Home and explicit cancellation;
- role-aware `home` and `help` responses.

### Message routing order

Refactor `TelegramMessageService.handle` after allowlist, update claim, user,
and conversation resolution:

1. handle exact Home or cancellation;
2. handle another exact top-level menu action, cancelling stale flow state;
3. handle an active text interaction only for a plain, non-attachment,
   non-voice message;
4. process attachments and voice using current bounded paths;
5. retain existing slash-command compatibility;
6. retain orchestrator, memory inference, and ordinary assistant paths.

Do not append menu labels or callback controls as user conversation messages or
Life OS source events. Persist a Desktop instruction as normal user-authored
conversation content. Keep VPN labels and pairing names out of conversation
history; memory text is stored only through `MemoryService`.

### Tests

- `/start` and Home install the correct role keyboard;
- non-owner menus omit VPN and Operations;
- crafted owner labels do not bypass server authorization;
- navigation labels do not enter conversation or the Life OS Event Spine;
- pending interactions preempt ordinary assistant handling only while active;
- expiry reports the expired step and does not perform a privileged operation;
- Home and explicit cancel close the flow;
- attachment and voice behavior is unchanged.

Commit: `feat(telegram): route persistent human navigation`

## Phase 4: Convert VPN creation to command-free text entry

### Files

- Modify `server/src/vpn/vpnCommandService.js`.
- Modify `server/src/telegram/telegramMenuService.js`.
- Extend `server/test/vpnCommandService.test.js`.
- Extend `server/test/telegramMenuService.test.js` and
  `server/test/telegramMessageService.test.js`.

### Service changes

Expose a public closed VPN action method that accepts validated
`action`, `protocol`, `arguments`, and origin context, then reuses the current
confirmation record creation. Existing slash and callback handlers call the
same method.

Change the `➕ Новый доступ` callback result from command-copying instructions
to a structured request for `vpn_access_label`. The menu coordinator persists
the selected protocol and asks for only a human label. Valid text calls the
closed VPN action method and produces the current inline confirmation.

Keep status, client selection, export, rotate, revoke, restart, artifact
delivery, audit, recovery, and unknown-outcome behavior intact. Successful and
cancelled flows return to the selected protocol menu.

### Tests

- Hysteria2 and VLESS label flows without slash commands;
- label validation and retry within the active interaction;
- owner denial at callback and action boundaries;
- confirm, reject, duplicate, expired, and cross-user callbacks;
- one-time artifact delivery with no secret persistence;
- existing `/vpn*` regression coverage.

Commit: `feat(telegram): create VPN access through guided input`

## Phase 5: Add guided device management and selected Desktop context

### Files

- Modify `server/src/telegram/telegramMenuService.js`.
- Modify `server/src/orchestrator/actionOrchestrator.js`.
- Extend `server/test/actionOrchestrator.test.js`.
- Extend `server/test/telegramMenuService.test.js` and
  `server/test/telegramMessageService.test.js`.

### Device flow

Add closed callbacks for device list, pairing, selection, task entry, revoke
prompt, and current revoke confirmation. Pairing starts
`device_pairing_name`; a valid name calls `DeviceService.beginPairing` and
returns the current ten-minute code instructions.

Selecting `🎮 Дать поручение` starts `device_instruction` with only the owned
device UUID in context. Consume the interaction once and append the instruction
as an ordinary user message before passing it to the orchestrator.

### Orchestrator context

Add optional `preferredDeviceId` to `ActionOrchestrator.handle`:

- resolve it only from `deviceRepository.listForUser(userId)`;
- restrict available action calculation to that owned device;
- require the device to be online and declare the planned action;
- store the validated target as the workflow target when creating a workflow;
- never accept a preferred device from model output;
- keep Desktop-origin targeting and existing continuation behavior unchanged.

### Tests

- pairing without `/pair`, including invalid names and expiry;
- list and select only owner-scoped active devices;
- revoke retains inline confirmation;
- selected device is honored with multiple online devices;
- foreign, revoked, offline, or incapable devices cannot be targeted;
- changing Desktop action still returns origin-bound inline confirmation;
- Vision through Telegram still requires an already-active lease.

Commit: `feat(telegram): guide device pairing and tasks`

## Phase 6: Add memory, document, and Life OS menus

### Files

- Modify `server/src/memory/memoryService.js`.
- Modify `server/src/memory/memoryRepository.js`.
- Modify `server/src/telegram/telegramMenuService.js`.
- Extend `server/test/memoryService.test.js`.
- Extend `server/test/telegramMenuService.test.js` and
  `server/test/telegramMessageService.test.js`.

### Memory

Add explicit `list`, `remember`, `correctById`, and `forgetById` service methods
that reuse current normalization and sensitive-data rules. Add owner-scoped
repository deactivation by memory UUID and an atomic `replaceById` transaction
that deactivates the selected fact and creates its replacement/version records
together. Keep the current natural-language memory parser as a compatibility
path.

The menu shows bounded owner memories. Add starts `memory_add`. Correction
selects an owner memory, starts `memory_correct_replacement`, and atomically
deactivates the selected record plus creates the replacement through the
service. Forget uses a selected owner memory and an inline confirmation; a
repeat click is a safe unavailable/no-op response.

### Documents

Use `KnowledgeService.list` for the menu and retain the existing owner-scoped
delete prompt and confirmation. Add upload guidance without adding a new
document transfer path. Remove command/ID instructions from button responses.

### Life OS

Route the top-level button to the current Mission Control query. Preserve
proposal confirmation/dismissal callbacks and owner/conversation scoping.
Change proactive Telegram proposal delivery to include the same inline buttons
instead of `/life_confirm` and `/life_dismiss` text instructions.

### Tests

- memory list/add/correct/forget and sensitive-data rejection;
- foreign memory ID denial and repeat confirmation behavior;
- document listing, empty state, upload guidance, delete confirmation, and
  foreign document denial;
- Life OS top-level summary and proactive proposal inline buttons;
- existing natural-language and slash compatibility paths.

Commit: `feat(telegram): add memory documents and Life OS menus`

## Phase 7: Add owner-only Operations entry and finish help text

### Files

- Modify `server/src/telegram/telegramMenuService.js`.
- Modify `server/src/runtime.js`.
- Extend `server/test/telegramMenuService.test.js`,
  `server/test/telegramBot.test.js`, and Operations session tests.

### Behavior

- Build the panel URL from the configured HTTPS origin and fixed `/ops/` path.
- Show `📊 Панель` only to the owner.
- Return `🌐 Открыть Operations` as an inline URL button; never create a panel
  session from Telegram navigation.
- Preserve the separate browser request and `ops:allow`/`ops:deny` flow.
- Return an unavailable message and no URL when Operations is disabled.
- Rewrite `/start` and Help copy around buttons, ordinary text, voice, and file
  upload. Mention slash commands only as a recovery compatibility path.

### Tests

- exact panel URL for owner;
- no button/link for member;
- hostile configuration and arbitrary URL rejection;
- Operations approval callbacks still bypass the menu callback handler and
  reach the existing approval service once;
- disabled Operations behavior;
- updated Help and Start copy contains no required command syntax.

Commit: `feat(telegram): link owner Operations panel`

## Phase 8: Regression, documentation, and deployment readiness

### Files

- Update `README.md` with the verified button-first Telegram behavior.
- Update `docs/README.md` and add a dated update under `docs/updates/` after
  automated verification.
- Update `AGENTS.md` if the final implementation materially changes Telegram
  routing, interaction state, trust boundaries, or verification commands.

### Automated verification

Run focused suites after each phase. At the end run:

```powershell
cd server
node --test test/telegramInteractionRepository.test.js
node --test test/telegramMenu.test.js test/telegramMenuService.test.js
node --test test/telegramBot.test.js test/telegramMessageService.test.js
node --test test/vpnCommandService.test.js test/actionOrchestrator.test.js
node --test test/memoryService.test.js
npm test
```

Also run migration parsing/application tests already included by `npm test`.
If a local PostgreSQL acceptance environment is available, apply migrations to
an isolated database and verify the partial active-interaction uniqueness and
atomic claim behavior without printing connection credentials.

### Manual local Telegram fixture acceptance

Exercise with fake services or a local bot fixture:

1. owner `/start` and member `/start` keyboard differences;
2. every top-level button;
3. Hysteria2 and VLESS new-access label flows;
4. cancel and expiry during input;
5. multi-device selection and a confirmation-required Desktop instruction;
6. memory add/correct/forget;
7. document delete and Life OS proposal actions;
8. exact Operations link and independent browser approval callback;
9. duplicate callbacks and stale object buttons;
10. logs and stored conversation content contain no credentials or control
    labels that should be presentation-only.

Commit documentation only after the relevant behavior is verified:
`docs: record Telegram button navigation verification`

## Production acceptance (explicit follow-up, not ordinary tests)

Deployment was requested and completed on 2026-09-14. The server was rebuilt
with migration 015, Compose reported the server and PostgreSQL healthy, the
public HTTPS smoke test passed, and the migration was registered in PostgreSQL.
The remaining client-driven checks below still require the real owner/member
Telegram accounts; do not mark them complete from server health alone.

Do not deploy automatically. When the owner requests deployment:

1. run `deploy/scripts/preflight.sh`;
2. deploy the migration before or together with the compatible server image;
3. verify Compose health and `deploy/scripts/smoke.sh`;
4. use the live owner and family Telegram accounts to verify role keyboards;
5. complete one Hysteria2 create-confirm-export cycle and one cancelled VPN
   mutation without retaining the URI;
6. complete pairing and selected-Desktop instruction flows;
7. open Operations from its link and approve the browser in Telegram;
8. inspect sanitized logs and Operations health for Jarvis, Xray, and
   Hysteria2;
9. update current-status documentation only for capabilities actually verified
   live.

## Completion checklist

- Every current user-facing Telegram capability is reachable without a slash
  command.
- Owner and member keyboards differ correctly.
- All policy-required confirmations remain inline and origin-bound.
- Input interactions survive restart and are isolated, expiring, and
  single-consume.
- VPN secrets remain one-time response artifacts.
- Operations navigation does not grant authorization.
- Existing slash commands and Operations approvals still work.
- Focused and full server suites pass.
- Documentation reports only verified behavior.
