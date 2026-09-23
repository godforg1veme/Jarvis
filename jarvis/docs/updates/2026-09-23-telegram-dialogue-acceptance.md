# Telegram dialogue and button-chain acceptance, 2026-09-23

Status: the integrated server source containing this branch's remaining patch
was deployed on 2026-09-23 after 544/544 server tests, production preflight,
container health, and public smoke passed. Earlier production owner text and
voice were accepted; post-release live client acceptance, full real-client
menu acceptance, and member-client checks remain open. This record separates
evidence from assumptions.

## What was tested

| Path | Evidence | Result |
| --- | --- | --- |
| Real owner text and personal-name answer | Two fresh production `telegram_updates` rows had closed `message/completed` outcomes; the first user text and assistant answer were saved. The assistant identified «Илья» as a VPN-profile label, not a verified personal name. | Passed on the owner's Telegram client. |
| Real owner voice | The second inbound message became one `voice_transcript`, followed by an assistant answer; no raw audio was stored in conversation messages. | Passed on the owner's Telegram client. |
| Real owner menu navigation | The owner reported all eight lower-menu buttons present and tapped them; eight new `message/completed` updates were recorded without failure codes. A later Life OS visit produced one `callback/completed` update without failure code. The owner said return navigation appeared to work but was unsure; no second callback was observed, so a distinct inline Back/Cancel completion is **not** claimed. | Bottom menu and one inline callback passed; Back/Cancel remains unconfirmed. |
| Bot transport E2E fixture | grammY polling path with fake Bot API: model and callback failure fallback, callback acknowledgement, duplicate update suppression, denied account, primary send failure, failed fallback send, and secret-free closed logs. | Passed locally. |
| Menu and scope | Owner/member exact keyboard rows match the contract; Life OS emitted callbacks have handlers and bounds; focused tests cover menu, guided flows, family confirmation, VPN artifact redaction, and origin-scoped remote commands. | Automated pass; not a substitute for member-client taps. |
| Full server regression | Isolated Telegram branch: 521/521. Separate dirty Supervisor checkout: 522/522. These are different source states and are not presented as one merged build. | Passed locally in both states. |
| Production operations | DE Compose server/ASR/PostgreSQL healthy; Cloudflare `/health/ready` reported `ok`; DE and NL Xray, Hysteria2, and Host Agent active; no failed systemd units in the checked snapshot. | Passed read-only checks. |

`telegram_updates.status=completed` records service-handler completion before
Bot API delivery. The live text and voice acceptance is backed by saved
assistant replies, but a generic completed row by itself is not delivery
proof. The branch now classifies primary and fallback Telegram send failures
separately without logging transport exception text or bot-token URLs.

## Remaining release and client gates

1. The Telegram branch was integrated with Supervisor and the combined server
   source was deployed from `codex/vpn-supervisor-integration` at `f7af2a7`.
   Preflight, Compose health, public smoke, and a bounded post-release error
   count passed; no real post-release Telegram delivery was claimed.
2. The owner tapped the eight non-changing lower-menu paths. Recheck a specific
   inline Back/Cancel only if that user-visible control is in scope for a
   future change; it was not confirmed by the 2026-09-23 evidence. Do not
   issue or confirm VPN/remote/delete actions merely for this acceptance.
3. A family/member account must separately check its three-row keyboard and
   owner-only VPN/Operations denial. Fixture tests are not a real member test.
4. A true Telegram delivery outage and true ASR outage are deliberately not
   induced in production. Their error paths are covered by isolated E2E tests,
   not claimed as live incident acceptance.
