# Telegram VPN button control design

Date: 2026-09-13
Status: implemented and deployed; manual Telegram/Happ acceptance remains

## Problem

The first VPN command flow prints request UUIDs and client IDs and expects the
owner to copy them into commands. Telegram turns `/vpn_confirm UUID` into a
clickable command token that may send only `/vpn_confirm`; production logs
confirmed exactly that failure. The owner should not have to see, copy, or type
technical identifiers.

## User experience

`/vpn` opens one inline control panel with these buttons:

- `Обновить статус`;
- `Мои доступы`;
- `Новый доступ`;
- `Перезапустить VPN`.

`Мои доступы` shows only human labels. Selecting a label opens actions for that
client: `Получить конфиг`, `Перевыпустить`, `Отозвать`, and `Назад`. Client IDs
are never rendered in message text or button captions.

`Новый доступ` explains that a label is required and asks for
`/vpn_issue Имя`. Labels remain unique, so manual commands may also use a
label instead of an ID. No user-facing VPN command requires an ID.

Every changing action returns inline `Подтвердить` and `Отмена` buttons. The request
UUID is present only in bounded callback data and is not rendered. Success,
failure, expiry, and already-used callbacks replace or answer the control
message with a clear result and a route back to the VPN menu.

## Architecture

Telegram callback data uses a closed grammar under the `vpn:` prefix and stays
under Telegram's 64-byte limit. It may contain an opaque internal client or
request ID, but only the server and Telegram transport see it.

The bot routes only `vpn:` callbacks to a dedicated VPN callback handler and
passes all other callback data to the existing Operations approval handler.
The handler derives the Telegram user and chat from the signed Telegram update;
it never trusts identity or channel data from callback payloads.

The callback handler translates a validated callback into the existing
`VpnCommandService` operations. Owner authorization, origin binding,
confirmation expiry, durable request state, Host Agent idempotency, credential
redaction, and one-time document delivery remain unchanged.

For manual label-based actions, the service requests the safe client list,
matches one unique label case-insensitively, and stores only the resolved opaque
ID in the already protected action request. Unknown or ambiguous labels do not
create an action.

## Telegram rendering

The service returns presentation-neutral button descriptors containing only
allowlisted action kinds and bounded opaque values. `bot.js` converts those
descriptors into Telegram inline keyboards after validating captions, callback
grammar, row count, and callback byte length. The database persists answer text
only; reply markup and credential artifacts are not stored in conversations.

Callback queries are always acknowledged to stop Telegram's loading spinner.
Repeated callbacks rely on the existing request state machine and return an
unavailable/already-completed message without repeating a mutation.

## Security boundaries

- VPN controls remain owner-only and allowlist-gated.
- Confirmation remains bound to the originating Telegram channel.
- Callback payloads cannot select arbitrary Host Agent operations.
- Labels are validated with the existing length and character allowlist.
- VLESS URIs remain one-time in-memory artifacts and are never placed in text,
  callback data, PostgreSQL, telemetry, or logs.
- Operations panel callbacks continue to work through explicit prefix routing.

## Verification

Tests cover callback grammar and size, owner rejection, menu rendering, hidden
technical IDs, client selection by label, confirm/cancel buttons, duplicate and
expired callbacks, artifact delivery, credential non-persistence, and coexistence
with Operations callbacks. The full server suite runs before deployment.

Production acceptance requires `/vpn` menu navigation, one issue-confirm-export
cycle, one cancelled mutation, Operations callback regression, clean logs, and
healthy Xray/Jarvis smoke checks.
