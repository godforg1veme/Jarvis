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

## Live follow-up: JSONB target comparison and reconciliation

The owner confirmed two repairs in Telegram, but both stopped before their
mutation checkpoints. PostgreSQL JSONB reordered target object keys; the previous
JSON.stringify equality incorrectly classified identical targets as changed.
Release 38b931fa7c9465c523b5a312133c80612d9c01cc compares the exact closed fields
independently of object-key order. The regression fixture now reproduces JSONB
reordering; all 608 server tests passed.

Read-only operation.status proved that neither original deterministic child ID
had a Host Agent claim or result. Both original, already owner-confirmed durable
actions were resumed under their same identifiers after owner/profile checks and
a conditional status claim. Both succeeded without another Telegram approval or
a new mutation identifier. The original supplied subscription URL returned HTTP
200 with four endpoints in both Base64 and explicit Sing-box formats. Tokens
were preserved; credential bodies were not printed or saved.

Two profiles now have all four exports. The third still has one missing DE
Hysteria2 client and awaits its own owner Telegram confirmation. Public smoke,
server/database/ASR health and active Xray/Hysteria2/Host Agent checks passed.
Phone-side Happ import/traffic remains manual acceptance.
