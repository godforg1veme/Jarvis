# Telegram dialogue and button-chain acceptance, 2026-09-23

Status: the integrated server source containing this branch's remaining patch
was deployed on 2026-09-23 after 544/544 server tests, production preflight,
container health, and public smoke passed. A 2026-09-24 post-release owner
acceptance has since passed for text, inbound voice, and the read-only Life OS
`Миссия` → `Life OS` return path. Member-client checks and other feature-specific
manual acceptance remain open. This record separates evidence from assumptions.

## Post-release owner acceptance, 2026-09-24

The owner confirmed a fresh text, short voice note, and Life OS tap-through in
Telegram Desktop. The text and voice updates were persisted as completed; the
voice content type was `voice_transcript` (no raw audio row). The assistant's
answer to «Как меня зовут?» did not guess a name; it said no name was known.
This matches the identity policy: Telegram account labels and prior assistant
claims are not trusted profile facts. A read-only owner-scoped database count
found no active profile memory matching an explicit «меня зовут» fact, so the
preferred name is currently unset for this account.

The assistant's Life OS `Миссия` button displayed the mission state; its
`Life OS` return button then displayed the section list. The two fresh
production `telegram_updates` rows were `callback/completed` with no failure
code, at 2026-09-24 15:56:18Z and 15:56:47Z. The result was also visually
verified in the real Telegram Desktop window. No changing action was invoked.
The owner previously reported all eight persistent bottom-menu entries
present. Family/member-client layout and authorization taps remain unverified.

One separate production callback failure was present at 2026-09-24
16:03:28.586945Z with the closed code `DIALOGUE_UNAVAILABLE`; callbacks around
it completed. The update diagnostics intentionally retain no callback payload
or dialogue text, so the failed button/action cannot be identified from the
available safe evidence. It did not recur during the tested Life OS path. This
is an unresolved, non-attributed event, not evidence that every callback path
is healthy.

## What was tested

| Path | Evidence | Result |
| --- | --- | --- |
| Real owner text and personal-name answer | Fresh post-release production text was answered. The assistant said no name was known and did not repeat the prior unverified «Илья» claim. | Message path passed; preferred name remains unset until explicitly confirmed by the owner. |
| Real owner voice | The post-release 4-second inbound voice note produced a saved `voice_transcript` and an assistant answer; the database retained no raw-audio message. | Passed on the owner's Telegram client; a real ASR-outage test was not induced. |
| Real owner menu navigation | The owner reported all eight lower-menu buttons present and tapped them. On 2026-09-24, the owner-side Mission callback displayed mission state and the inline `Life OS` button returned to the section list; both new callback updates completed without failure codes. | Persistent menu presence and the Mission → Life OS return passed. Member layout and changing paths remain separate checks. |
| Bot transport E2E fixture | grammY polling path with fake Bot API: model and callback failure fallback, callback acknowledgement, duplicate update suppression, denied account, primary send failure, failed fallback send, and secret-free closed logs. | Passed locally. |
| Menu and scope | Owner/member exact keyboard rows match the contract; Life OS emitted callbacks have handlers and bounds; focused tests cover menu, guided flows, family confirmation, VPN artifact redaction, and origin-scoped remote commands. | Automated pass; not a substitute for member-client taps. |
| Full server regression | Integrated worktree source: focused Telegram contract suite 65/65; full `server/npm test` 587/587. Earlier isolated 521/521 and Supervisor 522/522 runs were separate source states. | Passed locally; production runtime was checked separately. |
| Production operations | Fresh 2026-09-24 snapshot: DE server, PostgreSQL, and ASR healthy; Cloudflare Tunnel up; DE and NL Xray, Hysteria2, and Host Agent active; no failed systemd units; public readiness `ok`. | Passed read-only checks. |

`telegram_updates.status=completed` records service-handler completion before
Bot API delivery. The live text and voice acceptance is backed by saved
assistant replies, but a generic completed row by itself is not delivery
proof. The branch now classifies primary and fallback Telegram send failures
separately without logging transport exception text or bot-token URLs.

## Remaining release and client gates

1. The Telegram branch was integrated with Supervisor and the combined server
   source was deployed from `codex/vpn-supervisor-integration` at `f7af2a7`.
   On 2026-09-24 the running server container was healthy and passed live
   text/voice and read-only callback acceptance. The image was created at
   13:39Z and has no source-revision label; the VPS checkout is dirty, and
   several Telegram source-file hashes differ from the latest integrated
   worktree. Critical chat-type and VPN callback routing contracts were
   checked in the running container, but exact source-to-image equivalence and
   equivalence of the 587-test local suite to that image are not claimed. No
   deployment was performed during this acceptance.
2. The owner tapped the eight non-changing lower-menu paths. Recheck a specific
   inline Back/Cancel only if that user-visible control is in scope for a
   future change; it was not confirmed by the 2026-09-23 evidence. Do not
   issue or confirm VPN/remote/delete actions merely for this acceptance.
3. A family/member account must separately check its three-row keyboard and
   owner-only VPN/Operations denial. Fixture tests are not a real member test.
4. A true Telegram delivery outage and true ASR outage are deliberately not
   induced in production. Their error paths are covered by isolated E2E tests,
   not claimed as live incident acceptance.
