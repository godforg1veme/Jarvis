# Telegram Button Architecture and Change-Control Design

Status: proposed design for owner review. This document is not yet an active
runtime contract. It describes the guide and agent workflow to adopt after
approval; it does not authorize changes to Telegram behavior or production code.

Date: 2026-09-23

## 1. Purpose and outcome

Jarvis Telegram failures must be diagnosed and fixed across the complete
request-to-response path, not patched only at the handler where a symptom first
appears. Every coding agent must understand the route, identity and scope,
interaction state, domain action, delivery, diagnostics, and regression gates
before changing Telegram button behavior.

The deliverable after this design is approved is a durable architecture guide,
a short mandatory entry in the root `AGENTS.md`, and precise cross-links from
the current Telegram menu contract and documentation index. The guide will
describe stable architecture rules; `docs/telegram-menu-contract.md` will
remain the authority for currently shipped menu labels, layout, routes, and
confirmation behavior.

Success means that an agent changing any Telegram button path:

1. Traces the complete path and identifies the responsible boundary and root
   cause before editing.
2. Tells the owner what it intends to change before editing Telegram button
   architecture or behavior.
3. Gets explicit approval before changing user-observable menu/callback
   behavior or a confirmation/security boundary.
4. Updates every affected source of truth and the tests that protect it in the
   same change, without mechanically editing unrelated documents.
5. Reports the changed behavior, documents, test results, and any remaining
   live-client acceptance checks.

## 2. Current baseline observed in the repository

The current implementation is distributed by responsibility:

- `server/src/telegram/bot.js` owns Telegram polling middleware, callback
  acknowledgement, input delivery, output delivery, and the top-level error
  boundary.
- `server/src/telegram/messageService.js` normalizes inbound updates, applies
  the access policy and update deduplication, establishes the user and
  conversation, routes callbacks/messages, and records safe outcome state.
- `server/src/telegram/telegramMenu.js` owns persistent-keyboard labels,
  label-to-action mapping, role-aware layout, and owner detection helper.
- `server/src/telegram/telegramMenuService.js` owns menu navigation,
  button callback handling for several domains, and guided text interactions.
- Domain services such as Life OS, VPN, gallery, devices, memory, and documents
  perform the bounded domain operations and may provide inline controls.
- PostgreSQL-backed update and interaction repositories retain the dedup and
  guided-flow state needed across process restarts.

This is a responsibility map, not a claim that every callback follows one
identical branch. The new guide must map specialized branches (including VPN
Supervisor, VPN, Life OS, gallery, and confirmation callbacks) and keep the
map current when ownership moves.

## 3. End-to-end architecture

### 3.1 Message, command, and persistent-keyboard path

```text
Telegram getUpdates
  -> bot middleware / update normalization
  -> allowlist and input-kind/size validation
  -> update_id claim (duplicate stops before side effects)
  -> resolve Telegram identity -> Jarvis user -> chat-bound conversation
  -> classify: supported command / exact persistent-keyboard label /
                active guided input / attachment or voice / ordinary dialogue
  -> menu or domain service, guided-flow consumer, or assistant pipeline
  -> authorize and validate domain operation
  -> format safe response and inline/reply controls
  -> send Telegram response/media
  -> persist allowed conversation result and closed update outcome
```

Exact text matching for persistent keyboard labels remains navigation, not
authorization. Unmatched ordinary text stays ordinary dialogue unless a valid,
unexpired guided interaction owns that text in the same user/conversation/chat
scope. The precedence of commands, labels, active interactions, attachments,
voice, and ordinary text must be explicit and regression-tested.

### 3.2 Inline callback path

```text
Telegram callback_query
  -> callback grammar gate and bounded normalization
  -> answerCallbackQuery (UI spinner acknowledgement only; not action success)
  -> allowlist and update_id claim
  -> resolve identity and chat-bound conversation
  -> dispatch by closed callback family to its owning service
  -> re-check role, user/chat/conversation scope, object state and freshness
  -> safe/read-only result OR explicit origin-bound confirmation flow
  -> validate result buttons/artifacts -> Telegram send/edit
  -> persist only permitted history and closed outcome diagnostics
```

The callback acknowledgement may happen before the server action completes.
It must never be presented in logs or product logic as evidence that the action
succeeded. Update deduplication is the authority for preventing replayed side
effects; a duplicate update must not rerun a domain mutation.

### 3.3 Outbound controls and guided interactions

- Persistent reply-keyboard buttons are stable navigation labels. A label maps
  to a closed action; a user typing similar text does not gain authority.
- Inline callback buttons are bounded controls for navigation, selection, and
  explicit actions. Callback data stays within the closed grammar and Telegram
  byte limit. Do not put secrets, raw credentials/tokens, user-authored input,
  document content, storage keys, local paths, or authority claims in it.
- URL buttons are external navigation only. Their destination is validated and
  must not bypass a server-side approval or authentication boundary.
- Guided text input stores typed interaction state outside the callback.
  It is scoped to user, conversation, and chat; expires; validates input; and
  is atomically consumed before a changing operation. Invalid input may keep
  the same interaction active only while valid and unexpired.
- Outbound button data is validated before Telegram delivery. Rendering text
  and button labels never replaces server-side authorization.

### 3.4 Authority and changing actions

Every action handler derives authority from the authenticated Telegram user
and current server-side records, never from a label, callback prefix, object
identifier, stored role claim supplied by the client, or an old prompt.
Lookups and mutations are owner/user scoped. Foreign, stale, expired, revoked,
or already-consumed resources fail closed with a safe recovery response.

Changing remote, family-sharing, credential, access, delete, or other
consequential actions use the existing domain confirmation contract. The
confirmation is bound to the originating Telegram user, conversation/chat,
and action revision/nonce where applicable. A callback from another origin,
an expired confirmation, or a repeated confirmation cannot authorize a second
effect. An uncertain external result is reconciled using its original operation
identity; it is not blindly retried with a new identity.

One-time artifacts (for example credentials or subscription URLs) are returned
only through their approved delivery path and are excluded from conversation
history, prompts, telemetry, diagnostics, and this guide.

## 4. Failure handling and observability

The implementation and tests distinguish at least these outcomes: ignored or
unsupported update, denied identity, duplicate update, stale/expired control,
invalid input, unavailable domain service, domain failure, successful domain
result, Telegram delivery failure, and fallback-delivery failure. Public error
text is safe and actionable without revealing secrets, database detail, or
cross-user resource existence.

Diagnostics use closed route kinds, outcomes, phases, and failure codes plus
the update ID where permitted. They must not include dialogue text, callback
payloads, raw Telegram file URLs, credential-bearing artifacts, or arbitrary
exception messages. A fallback response does not imply a failed action was
rolled back; if the outcome is uncertain, surface that safely and reconcile
using the same operation identity.

When investigating an incident, trace one representative update across:

1. polling/transport health;
2. normalization and route classification;
3. allowlist and update claim/outcome;
4. user/conversation/chat scope;
5. menu/interaction/domain dispatch;
6. domain authorization, state transition, and result;
7. conversation persistence policy;
8. Telegram result delivery and fallback;
9. safe logs and production health signals.

Do not request or copy secrets into chat or logs. Avoid enabling verbose
payload logging as a debugging shortcut.

## 5. Change-control rule for every coding agent

Before editing a Telegram button route, callback family, keyboard, interaction
flow, confirmation path, or shared routing/authorization boundary, the agent
posts a concise change notice in the current task containing:

- observed symptom or requested outcome and evidence/root-cause hypothesis;
- complete path and boundary expected to change;
- user-visible behavior/security impact, including an explicit “no visible
  contract change” statement when applicable;
- files/services likely affected, regression tests, and documentation sources
  that may need synchronization;
- verification plan and any production/manual acceptance that remains.

This notice is mandatory even when the requested task already authorizes a
bugfix; it makes the scope inspectable before code changes begin. A change to a
menu label/layout/availability, callback grammar/route, confirmation boundary,
family visibility, or other Telegram user-observable contract must wait for
explicit owner approval in the current task. Internal refactoring may proceed
within the requested scope after notice only if it preserves the observable
contract and all existing invariants.

After implementation, the agent reports actual changes versus the notice. If
investigation changes the diagnosis or scope, it sends an updated notice and
gets approval before crossing the expanded boundary.

## 6. Documentation ownership and synchronization

“Update everywhere” means update each affected source of truth, index, and
test in the same change; it does not mean copy identical material into every
document.

| Artifact | Owns | Update when |
| --- | --- | --- |
| `docs/telegram-button-architecture.md` (to be created after approval) | End-to-end responsibilities, trust boundaries, debugging method, and invariants | Stable architecture or agent workflow changes |
| `docs/telegram-menu-contract.md` | Current labels, rows, routes, callback families, visible confirmation behavior | User-observable menu/callback contract changes |
| Root `AGENTS.md` | Mandatory agent entry rule and cross-links; project-level invariant summary | Mandatory workflow/safety rule changes; keep concise |
| `docs/README.md` | Documentation discovery and verified current status | Add/remove/rename guide or material product status changes |
| Runtime source and tests | Actual behavior and executable guarantees | Every implementation change |
| Design/plan history under `docs/superpowers/` | Decision history and approved rollout plan | Preserve approved decisions; add supersession notes rather than rewriting history |

The code is the implementation, not a silent replacement for a documented
contract. If code, guide, and current menu contract disagree, record the drift,
identify which user-approved behavior is intended, then update the affected
sources together. Do not “fix” disagreement by weakening security or silently
rewriting the contract.

## 7. Required regression matrix

Tests are selected from the affected path, not just the edited file. At minimum,
Telegram button work considers:

| Area | Required cases |
| --- | --- |
| Keyboard and classification | Owner/member layouts; exact label routes; ordinary text; command aliases; precedence with active guided input |
| Callback contract | Valid/invalid grammar; UTF-8 byte bound; unknown family; outbound validation; malformed or oversized data |
| Identity and scope | Allowlisted/denied sender; owner/member access; foreign user, conversation, and chat; cross-origin confirmation rejection |
| Deduplication | Duplicate update causes no second write, send artifact, or external mutation; failed/uncertain update follows documented reconciliation |
| Guided flow | Start, valid input, invalid input, cancel, expire, replace/cancel previous flow, scope mismatch, consume exactly once, restart persistence |
| Domain state | Missing/deleted/revoked/stale object; revision conflict; repeated confirmation; service unavailable; safe recovery path |
| Delivery and diagnostics | Empty result rejected; Telegram send failure/fallback; closed failure code; no user text, callback payload, token, URL, or secret in logs/history |
| Acceptance | Focused automated suite, adjacent Telegram suites, full server tests before deployment, then real owner/member taps for affected client paths |

The guide must point to the focused suite in `AGENTS.md`/the menu contract
rather than maintaining a competing command list. Production deployment keeps
the existing preflight, health, readiness smoke, and manual Telegram acceptance
requirements.

## 8. Adoption sequence after this design is approved

1. Create `docs/telegram-button-architecture.md` from the approved architecture
   and workflow sections, clearly labeling current observations versus
   normative invariants.
2. Add a concise mandatory rule and link in root `AGENTS.md`; do not duplicate
   the full architecture there.
3. Add reciprocal links and ownership notes to
   `docs/telegram-menu-contract.md` and `docs/README.md`; preserve all current
   menu labels, rows, routes, and confirmation behavior.
4. Add a documentation consistency checklist to future Telegram button work;
   do not refactor runtime code as part of adopting the guide.
5. Self-review the guide against the code and run documentation-level checks
   (links, command paths, and consistency). Runtime tests are not a substitute
   for the manual owner/member acceptance still listed in project status.

## 9. Acceptance criteria for this design

- The full message and callback paths, including special domain branches, are
  understandable without treating a keyboard label as authority.
- User, conversation, chat, update, interaction, and confirmation scopes are
  explicit, as are duplicate, stale, expired, and uncertain outcomes.
- An agent cannot silently change Telegram button behavior: a pre-edit notice
  is required, and observable contract changes wait for explicit approval.
- The synchronization table names the authoritative home for each class of
  information and avoids indiscriminate documentation churn.
- Regression and manual acceptance expectations are explicit and consistent
  with existing project instructions.
- Adoption does not change runtime behavior, expose secrets, alter menu
  controls, or weaken confirmation/security boundaries.
