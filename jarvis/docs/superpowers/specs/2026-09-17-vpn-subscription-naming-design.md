# VPN Subscription Naming Design

Date: 2026-09-17
Status: proposed detailed design; awaiting owner review

## Goal

Let the owner choose a name before creating each VPN subscription and rename
any active subscription later. The same name should be offered to Happ when
the existing subscription URL is refreshed. Renaming must not rotate the URL,
reissue node credentials, or interrupt active VPN sessions.

## Telegram interaction

- `/vpn` → `📲 Подписки (Happ)` → `➕ Новая подписка` asks for a name before
  inserting a subscription. The owner sends one plain-text reply. A successful
  insert opens the new profile with its existing `Подключить 4 сервера` action.
- Every active profile view has `✏️ Переименовать`. It asks for a new name and,
  after a successful update, returns to that profile. The confirmation explains
  that Happ receives the new name on its next successful subscription update.
- `Отмена`, expired input, another menu action, and duplicate delivery do not
  create or rename a subscription. Existing profiles keep their current names
  until the owner changes them. Revoked profiles cannot be renamed.
- Names are trimmed, nonempty, at most 25 Unicode code points, and limited to
  letters, digits, spaces, period, hyphen, and underscore. The error message
  states the limit and keeps the guided input open for correction. Duplicate
  names are allowed because subscription IDs, not labels, are the identity.

## Data and authority

- Reuse `vpn_subscriptions.label`; no new table or migration is needed.
- Add an owner-scoped repository rename operation with a parameterized
  `UPDATE ... WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING *`.
- Use the existing PostgreSQL-backed Telegram guided interaction, bound to
  owner, conversation, and chat. Consume it at most once. The rename callback
  contains only the subscription UUID and is not authorization by itself.
- Validate and escape the label at display boundaries. Never place a
  subscription URL, token, node password, or raw credential in the guided
  interaction, callback data, error message, or logs.

## Happ subscription response

- The ordinary Base64 `/sub/:token` response retains its exact URI-list body
  and URL. Add `profile-title` with the UTF-8 name encoded as Base64, as Happ
  documents, and `profile-update-interval: 1` (hours). The Base64 header avoids
  non-ASCII HTTP header encoding problems. Do not add these headers to 404/503
  responses or embed metadata in the URI-list body.
- The name shown by Happ depends on a successful fetch and Happ's handling of
  the documented header. The bot must not claim an immediate or guaranteed
  change in an already imported local profile. A failed update leaves the last
  imported name visible until the next successful refresh.
- Explicit `?format=sing-box` continues to return the same JSON contract; the
  rename operation does not alter the four server tags or failover structure.
- Legacy active labels longer than 25 characters remain valid in PostgreSQL;
  the header uses a 25-code-point Unicode-safe prefix until the owner renames
  the profile. New and renamed labels use the 25-character limit.

## Failure behavior and verification

- A database failure leaves the old label and subscription token unchanged
  and returns a generic error to Telegram. A missing, revoked, or foreign
  subscription returns the same unavailable result without leaking existence.
- Tests cover create-name prompt, invalid-name retry, cancellation, duplicate
  input, rename on bound and unbound profiles, cross-owner/revoked rejection,
  unchanged token/client IDs, UTF-8 Base64 response header, the one-hour
  update header, and unchanged Base64/Sing-box bodies.
- Production acceptance checks the Telegram path and `/sub/:token` headers
  without printing the token or credentials. A real Happ import/refresh and
  updated display name remain owner-device acceptance checks. Diagnose the
  reported 00:23 mobile subscription-update error separately; this feature
  cannot fix a failed fetch by itself.

## Source

Happ documents `profile-title` (plain UTF-8 or Base64, maximum 25 characters)
and `profile-update-interval` in its [application-management reference](https://github.com/HappDev/happ_su/blob/main/dev-docs/app-management.md).
