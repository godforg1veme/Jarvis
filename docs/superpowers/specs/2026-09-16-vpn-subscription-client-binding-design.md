# VPN Subscription Client Binding Design

## Goal

Ensure every Jarvis VPN subscription is bound to its own DE and NL Hysteria 2
and VLESS client records so one stable Happ URL can safely refresh the complete
four-server profile.

## Current defect

The initial subscription flow creates only a database row; it does not issue
node clients or persist their IDs. When a subscription is served, the fallback
looks for a matching label and otherwise exports the first non-probe client on
each host. The active production profile has no DE/NL client IDs and no exact
`Мой телефон` client label, making that fallback both unreliable and unsafe.

## Design

### Stable refresh contract

- A normal Happ update fetches the same `/sub/:token` URL and returns the
  current four-endpoint URI list. It does not rotate tokens, credentials, or
  client IDs.
- The existing explicit token-rotation action continues to invalidate only the
  old URL when the owner deliberately asks for a new URL.
- Endpoint credential changes happen only in an explicit subscription repair
  workflow with a fresh owner confirmation in the originating Telegram chat.

### Bound provisioning workflow

- A subscription provision/repair request creates four closed Host Agent client
  operations: Hysteria 2 and VLESS on DE, then Hysteria 2 and VLESS on NL.
- All four request IDs are generated once and retained as workflow data for
  reconciliation. A repeated callback must never create a second client set.
- The workflow persists a compact protocol-pair identifier object into the
  existing `client_id_de` and `client_id_nl` fields only after all four client
  operations report success.
- The renderer receives no URI or credentials. The subscription service later
  asks each Host Agent to export only the persisted client IDs while building a
  response; raw exports remain transient in memory.

### Failure handling

- Remove the `clients[0]` fallback. A profile without a complete bound client
  set fails closed and tells the owner to repair it; it must not export another
  profile's credentials.
- If a known newly created client must be compensated after a later operation
  fails, revoke only that known ID under the same confirmed workflow. An
  interrupted/unknown operation is recorded as unknown and is never retried
  with a new identity automatically.
- The current unbound profile exposes a repair action in its Telegram detail
  view. The owner must confirm before any Host Agent mutation occurs.

### Telegram UX

- Subscription detail clearly distinguishes **«Обновить в Happ»** (no server
  credential changes; use Happ's normal refresh control) from **«Восстановить
  доступы»** (issues a clean client set after confirmation).
- After a successful repair, the same subscription URL stays valid and the
  owner is told to use Happ's update control. No raw VLESS/Hysteria URI is sent
  to Telegram, PostgreSQL, logs, or a conversation.

## Verification

Tests cover full four-client provisioning, exact ID persistence, no fallback to
an unrelated client, owner/origin-bound confirmation, duplicate confirmation,
partial failure compensation, stable `/sub/:token` refresh, and Telegram copy.
The production rollout creates no client until the owner presses and confirms
the repair button; after that, Happ import/update is a manual device acceptance
check.
