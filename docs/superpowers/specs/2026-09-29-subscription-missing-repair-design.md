# Restore missing subscription endpoints

Owner approved the targeted replacement path in this chat on 2026-09-29.
Previous DE Hysteria2 credential state was not found in inspected backup roots.
The implementation restores missing bindings through owner-confirmed new keys,
not recovery of previous credential bytes.

Reuse the closed subscription.repair action and callback. Bound profiles expose
a restore button. Only the owner in a private Telegram chat can request it;
approval stays bound to the creating conversation/channel/device.
Inspect all four exact bound IDs: only VPN_CLIENT_NOT_FOUND qualifies as missing;
transport errors and other failures cannot authorize new credentials.
Persist targets in the confirmation and recheck them before issuing anything.
Serialize request creation with a subscription advisory transaction lock.
Persist deterministic child request IDs before any issue. Save returned client
IDs as metadata, compare-and-swap the owner-scoped binding after each issue,
and preserve tokens and other endpoints. Never revoke or retry automatically.
Interrupted/unknown outcomes remain blocked for original-ID reconciliation.

Tests cover success, export failure, transport uncertainty, binding conflict,
foreign conversation, replay and preservation of token/other bindings.
Deploy only after full server tests and public readiness. The owner must tap
the new button and confirm each affected profile; no keys are issued by Codex.
