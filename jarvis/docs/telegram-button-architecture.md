# Telegram button architecture and agent workflow

Status: active architecture guide, 2026-09-23. This file owns stable routing,
trust-boundary, diagnosis, and change-control rules. The shipped labels, rows,
callback families, and visible confirmations are owned by
[`telegram-menu-contract.md`](telegram-menu-contract.md). The implementation
remains authoritative for what actually runs; a disagreement is drift to
investigate, not permission to silently rewrite either document.

## Complete request-to-response path

| Stage | Owner | Invariant to check |
| --- | --- | --- |
| Poll and delivery | `server/src/telegram/bot.js` | Only supported updates enter dispatch; callback acknowledgement stops the spinner, not proof of action success. Outbound text, buttons, media, and fallback delivery are validated. |
| Normalize and claim | `messageService.js`, `telegramUpdateRepository.js` | Reject disallowed senders before work; claim each `update_id` once; retain only closed kind, outcome, and failure code. |
| Identity and scope | User/conversation repositories and access policy | Derive authority from Telegram identity and server records. Bind user, conversation, and chat; never trust a button label or callback ID as authority. |
| Classify | `messageService.js`, `telegramMenu.js` | Commands, exact keyboard labels, active guided input, voice/media, and ordinary text have explicit precedence. Unmatched text is dialogue. |
| Route | `telegramMenuService.js` and owning domain service | Each callback family has a closed grammar and an owner. Recheck resource scope, revision, expiry, and role at the handler. |
| Act or confirm | Domain service / Tool Gateway / Host Agent | Read-only actions may answer directly. Changing actions require the existing origin-bound confirmation and an exactly-once or original-ID reconciliation path. |
| Reply and record | Bot, conversation repository, update repository | Deliver a safe response or classified fallback; persist only allowed conversation content. A sent fallback does not imply that an uncertain mutation was rolled back. |

The current `telegram_updates.status=completed` means the service handler
finished; it is written before the Bot API send and therefore is **not** proof
that Telegram delivered a reply. Outbound-send and fallback-send failures are
separate closed log codes (`TELEGRAM_DELIVERY_FAILED` and
`TELEGRAM_FALLBACK_DELIVERY_FAILED`). Duplicate suppression must not blindly
re-run a changing action after either code. A durable delivery outbox would be
a separate product design, not an implied property of this contract.

Callback families include `life:*`, `vpn:*`, `vpsup:*`, `mem:*`, `doc:*`,
`dev:*`, `gallery:*`, `flow:*`, and `cmd:*`. `bot.js` has the outbound grammar
gate; each family handler owns its own authorization. New callback syntax must
be accepted by both the grammar and handler, protected by tests, and approved
before changing the user-visible contract. Callback data is at most 64 UTF-8
bytes and must never contain secrets, user text, document bodies, paths, or
storage keys. URL buttons navigate; they never grant server authority.

Guided input is stored server-side with a typed state, owner/user,
conversation/chat scope, and expiry. Validate input and consume the state
atomically before mutation. A stale, foreign, revoked, or replayed control
fails closed. Family sharing and remote/VPN changes retain their separate
confirmation boundaries. An uncertain Host Agent result is reconciled by its
original operation ID; never repeat it under a fresh ID merely to get a reply.

## Failure and diagnostic contract

Distinguish denied, ignored, duplicate, invalid/expired, backend unavailable,
domain failure, successful domain result, Telegram send failure, and fallback
send failure. A public answer is safe and actionable, without SQL, exception
details, callback payload, secret-bearing URI, or another user's data.
Diagnostics may contain closed route kind, phase, outcome, failure code, and
update ID only. They must not copy dialogue, transcript, raw file URL, token,
credential, storage key, or arbitrary exception message into logs or Operations.
Raw Telegram `voice` bytes are request-temporary; only the transcript is saved
when ASR succeeds. A voice failure must not claim that a transcript was saved.

For an incident, trace one update in this order: polling health → normalization
→ allowlist → claim/outcome → user/conversation/chat → classification and
guided state → domain authorization and result → conversation persistence →
Telegram delivery/fallback → safe logs. Do not enable payload logging to debug.

## Mandatory change notice and approval

Before editing any Telegram button path, the agent must tell the owner in its
current task: the observed symptom and evidence, complete affected path,
expected behavior/security impact (or explicitly **no visible contract
change**), likely files, tests, documents, and practical acceptance plan. If
the diagnosis expands, send a revised notice before crossing that boundary.

No menu label, row, visibility, callback grammar/route, confirmation flow, or
owner/member scope may change without explicit owner approval **in the current
task**, matching focused tests, and an update to the menu contract. An internal
repair within the requested scope may proceed after notice only if every
observable and security invariant is preserved. Neither an LLM response nor
an agent's interpretation of a label can authorize a product change or action.

After a change, report actual behavior, touched documents, automated results,
deployed revision, and remaining real-client checks. Keep the sources of truth
distinct: this guide owns architecture; the menu contract owns shipped UI;
`AGENTS.md` owns the mandatory entry rule; `docs/README.md` owns verified
status; tests and source own executable behavior; old specs/plans remain history.
Update each affected source in the same change, not every file indiscriminately.

## Verification gate

Run the focused command in [`telegram-menu-contract.md`](telegram-menu-contract.md),
then full `server/npm test` before deployment. Check owner/member layouts,
exact labels versus ordinary text, allowed/denied senders, foreign chat and
conversation, malformed/oversized callbacks, replay, guided-state expiry and
single consumption, stale confirmations, unavailable backends, voice limits
and ASR failure, delivery fallback, and secret-free diagnostics. Deployment
also needs preflight, Compose health, public smoke, and real owner/member taps
for affected paths. A fixture or synthetic Bot API test is not a real client.
