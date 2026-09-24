# Telegram bot menu contract

Status: current production navigation contract, checked 2026-09-23. This file
owns shipped labels, layout, callback families, and visible confirmations.
Read the stable architecture and agent workflow in
[`telegram-button-architecture.md`](telegram-button-architecture.md) before
changing a path. The isolated Telegram branch may lag concurrent Supervisor
source changes; verify the deployed revision before a server rollout.

## Change control

Do not alter a label, row, availability, callback grammar, route, or
confirmation boundary without explicit owner approval in the current task, a
focused test of the route and authorization, and an update here and in
`AGENTS.md` if an invariant changes. First send the change notice required by
the architecture guide. Refactoring internals must preserve this observable
contract. Labels are presentation, never authority.

## Persistent bottom keyboard

The keyboard is persistent, resizeable, and exact-text matched. Other text is
ordinary assistant input unless a valid scoped guided interaction owns it.

| Row | Owner | Family member | Route |
| --- | --- | --- | --- |
| 1 | `🏠 Главное`, `🎯 Life OS` | `🏠 Главное`, `🎯 Life OS` | Home, Life OS |
| 2 | `🧠 Память`, `📄 Документы` | `🧠 Память`, `📄 Документы` | Memory, documents |
| 3 | `🖥 Устройства`, `🔐 VPN` | `🖥 Устройства`, `❓ Помощь` | Devices; owner VPN; help |
| 4 | `📊 Панель`, `❓ Помощь` | absent | Owner Operations, help |

Strings and mappings live in `server/src/telegram/telegramMenu.js`. `/start`
and `/help` remain Home and Help aliases. Owner-only handlers recheck server
authorization even if a user types a label or submits callback data directly.

## Inline controls

Callback data uses a closed grammar and at most 64 UTF-8 bytes. No bodies,
paths, storage keys, tokens, credentials, or unchecked user text may appear.

- `life:*`: Life OS hierarchy and proposals; mutable values use scoped guided input.
- `vpn:*`: country/protocol menus, subscriptions, and origin-bound confirmation.
  `/vpn_health` shows the local Host Agent diagnosis and separate cross-node
  VLESS/Hysteria2 probe results. External timer failures do not currently send
  their own proactive Telegram incident message. Its «Автоматический ремонт»
  label refers to autonomous action without owner approval: only a restricted
  Xray/Hysteria2 service-restart proposal can be executed after a fresh owner
  confirmation in the private chat.
  The owner-only external-checks menu adds `Проверить ключ` only for fixed
  DE/NL and VLESS/Hysteria2 bindings with a completed installation/rotation
  attempt (including uncertain outcomes that require reconciliation), using
  `vpn:probe:recheck:<de|nl>:<v|h>`. It is available only in a private Telegram
  chat; the callback route forwards the normalized Telegram chat type to that
  guard and requires separate confirmation in the same conversation. It runs
  at most one existing read-only external probe after the Host Agent checks
  private credential-file metadata. Missing requested credentials fail closed
  without starting systemd. It stores only closed proof metadata; it never installs, rotates,
  exports, or reveals a key. Callback bytes contain only the fixed source node
  and protocol code.
- `mem:*`, `doc:*`, `dev:*`, `gallery:*`, `flow:*`: scoped controls, lookup, and expiry.
- `cmd:*`, `vpsup:*`: changing remote/VPN actions with originating-client confirmation.

`vpsup:allow|reject|details:<uuid>` is closed and bounded. Synthetic
acceptance is a confirmed no-op. The separate Supervisor rollout deployed
real-restart handling on 2026-09-23: a restart proposal is actionable only
from the owner's private Telegram chat after the current incident and closed
policy are rechecked, and may invoke only the matching `vpn.restart` or
`vpn.hysteria2.restart` operation. A post-action snapshot verifies both VPN
stacks. Stale diagnosis cancels; uncertain outcome is reconciled by the
original request ID without retry. A genuine owner-confirmed NL Xray restart
passed live postchecks on 2026-09-24 after the host-bound callback fix; the
synthetic no-op acceptance passed earlier on 2026-09-16.
For every button action, the server resolves the run's persisted `host_id`
to exactly one configured Supervisor service, and that service independently
checks host ownership before handling the callback. This is an internal route
fix; labels, row layout, callback bytes, and confirmation scope are unchanged.

`server/src/telegram/bot.js` validates outbound inline buttons. New callback
forms require parser, handler, authorization, and test before allowlisting.

## Route and failure invariants

1. Poll → strict dispatch → allowlist → update claim → scoped conversation →
   menu/guided input/dialogue → validated text or media delivery.
2. Model, menu, callback, and voice errors return safe classified outcomes;
   diagnostics retain only closed kind/status/failure code, never input text.
3. Duplicate update IDs never rerun a mutation or one-time artifact delivery.
4. VPN credentials and subscription URLs are delivery-only, not history,
   telemetry, prompts, logs, or callback data.
5. A keyboard row never grants authority; every owner-only action rechecks it.
   VPN confirmation also rechecks the originating conversation, channel, and
   device so a copied confirmation cannot execute from another chat.
6. `telegram_updates.status` describes service processing, not Bot API delivery.
   Delivery and fallback-send failures have distinct closed diagnostic codes;
   neither authorizes automatic replay of a changing action.

## Required regression gate

```powershell
cd server
node --test test/telegramArchitectureContract.test.js test/telegramBot.test.js test/telegramMessageService.test.js test/telegramMenu.test.js test/telegramMenuService.test.js test/telegramLifeOsService.test.js test/operationsLogs.test.js
```

Then run `npm test` before deployment. Production changes also need deployment
preflight, Compose health, public smoke, and real owner/member tap-throughs of
the affected path. Keep those manual outcomes separate from fixture results.
