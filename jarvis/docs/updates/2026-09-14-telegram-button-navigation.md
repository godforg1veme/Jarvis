# Telegram button navigation — 2026-09-14

## Implemented

Telegram now has a persistent, role-aware bottom keyboard. Family members see
Home, Life OS, Memory, Documents, Devices, and Help. The configured owner also
sees VPN and Operations.

Dynamic choices remain attached to the relevant message as inline buttons:

- Life OS proposal decisions;
- memory selection, correction, and confirmed removal;
- document selection and confirmed deletion;
- device selection, task entry, pairing, and confirmed revocation;
- Hysteria2/VLESS status, client selection, issue, export, rotation, revocation,
  and restart;
- Desktop and VPN confirmations;
- the exact configured Operations panel URL and separate browser approval.

VPN access labels, computer names, memory text, and selected-Desktop
instructions use ten-minute PostgreSQL-backed input interactions. Interaction
state is owner/conversation/chat scoped, closed by kind, JSON-bounded, and
single-consume. It contains no VPN credential, artifact, file body, raw voice,
local path, or raw tool arguments.

Existing slash commands remain available as a compatibility path, but new help
and navigation do not require them.

## Safety properties

- Menu labels are matched exactly and never authorize an action.
- Owner-only controls repeat domain authorization checks.
- PostgreSQL queries are parameterized and interaction creation is serialized
  per owner conversation.
- Selected Desktop tasks validate ownership, online state, and declared device
  capabilities through the existing Action Orchestrator.
- Policy-required changes retain origin-bound inline confirmation.
- The Operations link is limited to the configured HTTPS origin plus `/ops/`;
  opening it does not create or approve a panel session.
- VPN share URIs remain one-time response artifacts and are not persisted.

## Verification

The focused Telegram, interaction, VPN, memory, migration, and orchestrator
suites passed. The complete server suite passed with 249 tests:

```text
tests 249
pass 249
fail 0
```

Production deployment completed on 2026-09-14. The VPS preflight passed, only
the server image was rebuilt, PostgreSQL and the other Compose services remained
healthy, migration `015_telegram_interactions.sql` was registered, and the
public HTTPS live/ready smoke test passed. Bounded startup logs showed normal
request handling without startup errors.

Live owner/member Telegram acceptance remains explicit manual work: verify both
role keyboards from the real accounts, then exercise representative VPN,
pairing, selected-Desktop, memory, document, Life OS, and Operations approval
flows without retaining one-time VPN artifacts.
