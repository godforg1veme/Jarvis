# Missing subscription repair rollout — 2026-09-29

Release e02b5604293b7b14ebc553be25a6fa3872380dd3 is deployed on DE.
Bound profiles now offer targeted repair in the owner's private Telegram chat,
using the existing callback and origin-bound confirmation. Only explicit missing
clients qualify. Existing subscription tokens and healthy bindings remain intact.
Child mutation IDs are saved before issue; unknown outcomes preserve checkpoints
and block repeated repair. Binding replacements use owner-scoped compare-and-swap.

74 focused Telegram/VPN tests and all 608 server tests passed. PostgreSQL
temporary fixtures passed request serialization/duplicate blocking, owner scoping,
binding CAS and token preservation. After deployment, another temporary fixture
confirmed that an unknown result retains its operation checkpoint. No fixture
modified production profile or action rows.

Source/release provenance, preflight, unchanged environment comparison, Compose
health and public smoke passed. Only the server container was replaced; database,
ASR and ingress retained their IDs. Read-only production checks confirmed restore
controls for all three active profiles and one missing DE Hysteria2 endpoint each.

Actual replacements are pending the owner's Telegram taps: VPN → subscriptions
→ profile → restore connections → confirm, for each profile. Codex did not issue
keys or fabricate a Telegram confirmation. Four-endpoint subscription responses
and real Happ refresh remain acceptance after those actions.
