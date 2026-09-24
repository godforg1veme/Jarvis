# Natural-Language Desktop Tool Orchestrator Design

Status: approved design as of 2026-09-02.

Platform note: this document remains the detailed design for the first Windows
execution slice. The generic orchestration and future executor boundaries are
defined by `2026-09-02-action-orchestrator-platform-foundation-design.md`.

## Goal

Replace the split between ordinary assistant chat and manually structured
`/desktop` commands with one bounded orchestration loop. A user should be able
to describe a local task naturally, continue it in later messages, and receive
an answer based on verified Desktop tool results.

The motivating example is not a special case. Requests such as "find the
Tabletop Simulator folder on drive F and open it", "find it yourself", "show
the latest report", "focus the browser", and equivalent paraphrases must use
the same planning, validation, execution, confirmation, and result-delivery
pipeline.

## Scope

The first production slice covers the existing declared file, application, and
window actions. It supports Desktop chat and Telegram, multiple owner-scoped
Windows devices, multi-step tool use, follow-up questions, result-based
continuation, and asynchronous completion messages.

The existing `/desktop`, `/confirm`, `/reject`, and `/command` forms remain as
diagnostic and recovery interfaces. They are no longer the primary user
experience.

The following remain out of scope:

- arbitrary model-generated shell, PowerShell, executable paths, or scripts;
- browser automation and continuous visual control;
- tools outside the declared Tool Gateway action registry;
- implicit sharing of conversations, files, devices, or authority between
  users;
- claiming success before a successful Tool Gateway result is received.

## Current Failure

Desktop and Telegram text currently follow two separate paths. A narrow parser
handles structured remote commands and one absolute-folder-path phrase. All
other messages go to the conversational model with `toolsAvailable: []`.

Consequently, the assistant cannot:

- turn natural language into validated tool calls;
- search before acting;
- consume a command result and choose the next step;
- retain an unfinished tool task across a clarification;
- deliver a later completion event to the originating client.

Adding more regular expressions would preserve those architectural gaps and
create language-specific special cases.

## Selected Architecture

### Tool intent planner

`ToolIntentPlanner` receives the current request, bounded recent conversation
history, owner-scoped device summaries, declared capabilities, and bounded
verified results from earlier workflow steps. It returns exactly one validated
decision:

- `answer`: provide a text response;
- `ask_user`: request missing information or a choice;
- `tool_call`: request one declared action with structured arguments.

The planner never executes actions. Its output is parsed as strict JSON,
checked against a versioned schema, and given at most one corrective retry.
Unknown actions, extra fields, oversized values, and malformed output fail
closed. Model fallback is disabled once a workflow has tool authority so a
second provider cannot unknowingly repeat an action.

### Desktop task orchestrator

`DesktopTaskOrchestrator` owns the workflow state machine and is the only chat
component allowed to turn a planner decision into a command. A workflow has at
most four tool steps and a bounded wall-clock lifetime. Reaching either limit
produces an explicit incomplete result.

The orchestrator:

1. selects or asks for a target device;
2. invokes the planner with only that device's current capabilities;
3. validates and creates a command through `CommandService`;
4. waits for or later consumes the verified Desktop result;
5. gives a bounded, sanitized result back to the planner;
6. repeats, asks the user, pauses for confirmation, or completes.

`CommandService` remains the execution authority. The orchestrator cannot send
WSS frames directly or bypass owner, capability, policy, TTL, audit, or replay
checks.

### Workflow persistence

PostgreSQL stores each workflow with:

- owner and conversation IDs;
- origin channel and origin device/chat identity;
- selected target device;
- status: `planning`, `waiting_tool`, `waiting_user`,
  `waiting_confirmation`, `completed`, `failed`, or `expired`;
- bounded user-visible context and planner decisions;
- current step number and linked command IDs;
- expiration and completion timestamps.

Workflow steps store the action, policy, sanitized planner arguments, linked
command, and normalized outcome. Raw secrets are never stored. Existing command
records remain the source of truth for OS execution and audit.

Workflow transitions use compare-and-set database updates. Duplicate client
messages, command results, callbacks, reconnects, and worker retries therefore
cannot advance the same step twice.

### Verified result waiting and continuation

`DeviceSessionRegistry` gains a bounded command-result notification mechanism.
`CommandService.handleResult` persists the result first and then signals local
waiters. The database is authoritative; in-memory notifications only reduce
latency.

If a tool completes within the current HTTP request budget, the orchestrator
continues immediately. Otherwise the request returns an honest in-progress
message and a worker resumes the persisted workflow. A server restart loses no
completed command result and cannot repeat a command whose execution state is
unknown.

Telegram receives asynchronous workflow updates in the originating chat.
Desktop receives a validated `assistant.workflow_update` WSS message that the
main process forwards to the trusted renderer. Both clients deduplicate updates
by workflow and revision.

## Device Selection

Device selection is owner-scoped and capability-aware:

- the requesting Desktop targets itself by default;
- Telegram automatically selects the only online compatible PC;
- if two or more compatible PCs are online, the workflow pauses and presents
  a numbered device choice;
- if no compatible PC is online, the workflow reports that fact without
  creating a command;
- a follow-up selection is accepted only in the same conversation and for the
  same owner.

The selected device is pinned to the workflow. It cannot silently change after
planning or confirmation.

## Search and Opaque Candidates

Search is an ordinary observe action, not a special intent. The planner may
turn "on drive F" or "на диске ф" into a validated location such as `F:\`, but
the Desktop search implementation resolves and bounds the location.

Search results exposed outside the Desktop execution boundary use temporary
opaque candidate IDs plus minimal display metadata. The trusted Desktop keeps
the actual path, type, dangerous-extension flag, and expiry. A later open or
reveal action references the candidate ID, and Desktop revalidates that:

- the ticket exists and belongs to the active workflow/device;
- it has not expired or already been consumed where applicable;
- the current filesystem object still matches the expected type;
- a folder-open action resolves only to a directory;
- a safe-document-open action cannot resolve to an executable or script.

The planner cannot replace a candidate's path between search and execution.
Direct paths explicitly typed by the user continue through path validation and
the same local type checks.

If search finds no candidates, Jarvis reports the searched scope. If it finds
one high-confidence candidate, the workflow may continue automatically. If it
finds several plausible candidates, the workflow stores the bounded candidate
set and asks the user to choose. Replies such as "вторую" are interpreted only
against that active set.

## Confirmation and Policy

Confirmation is bound to the request origin:

- a Desktop request is confirmed by a confirmation card on that same Desktop;
- a Telegram request is confirmed in that same Telegram chat;
- another channel, chat, device, or user cannot approve it;
- confirmation has a short TTL and refers to the exact frozen action and
  candidate, not a newly planned target.

Observe and low-risk actions may run without confirmation. These include
search, directory listing, opening a locally verified folder, revealing an
item, focusing a window, and restoring a window. A regular document may open
without confirmation only after Desktop classifies the frozen candidate as
non-dangerous.

Changing actions retain confirmation as required by the product safety
contract. This includes create, rename, move, copy, delete, application
launch/close, and changing window layout or geometry. Executables and scripts,
including `.bat`, `.cmd`, `.exe`, `.ps1`, `.msi`, `.reg`, `.vbs`, `.js`, `.jar`,
`.scr`, and `.com`, require confirmation before opening. Permanent or batch
destructive actions retain strong confirmation.

Desktop and Telegram render the same server-owned confirmation summary. A
confirmation response resumes the persisted workflow from the frozen step. A
rejection cancels that step and ends the workflow unless the user starts a new
request.

## Conversation Continuity

The planner receives bounded recent history plus the active workflow summary.
This lets "найди сам его" continue a prior request to open a named folder
without relying on a phrase-specific parser.

Only one workflow per conversation may wait for an ambiguous user answer.
Starting an unrelated task explicitly expires that waiting workflow before a
new one is created. The assistant never guesses which of several simultaneous
candidate lists a reply refers to.

## Error Handling

Failures are normalized into user-safe categories:

- target device offline or revoked;
- unsupported capability;
- tool timeout;
- no search result or ambiguous result;
- candidate expired or changed;
- confirmation rejected or expired;
- local policy rejection;
- execution failed;
- execution outcome unknown;
- planner output invalid or step limit reached.

Internal paths, provider errors, stack traces, credentials, and WSS tokens are
not copied into public error text. Unknown execution outcomes are never retried
automatically. The user receives the workflow ID for diagnosis when useful.

## Testing Strategy

Testing is designed to reject point fixes rather than merely prove one example.

### Deterministic contract tests

- strict planner decisions for `answer`, `ask_user`, and `tool_call`;
- unknown actions, extra fields, invalid arguments, oversized results, and
  prompt-injection attempts fail closed;
- owner, origin channel, origin device/chat, capability, and confirmation TTL
  checks cannot be bypassed;
- command results are persisted before continuation and duplicate results do
  not execute or advance twice;
- server restart, offline device, timeout, cancellation, and unknown execution
  outcomes have explicit terminal behavior;
- Desktop candidate tickets reject substitution, expiry, type changes, and
  dangerous files presented as folders or safe documents.

### Scenario matrix

The acceptance corpus includes Russian and English names, spaces, Unicode,
mixed case, nested paths, common typos, drive letters spoken in Russian, and
follow-up pronouns. It covers folders, text documents, PDFs, images, archives,
scripts, executables, applications, and windows.

Representative scenarios include, but are not limited to:

- find a game folder on a named drive and open it;
- find a project folder by partial name across the computer;
- find the newest PDF in Documents and reveal it;
- locate an image with a Cyrillic name and open it;
- search for a `.bat` file and verify that opening pauses for confirmation;
- select the second of several similarly named folders;
- resolve and focus an already running application;
- ask on Telegram with one online PC and with several online PCs;
- continue "найди сам", "открой второй", and "нет, другой" against active
  workflow state.

### Seeded generative tests

Tests generate temporary directory trees, filenames, extensions, drive-like
locations, paraphrases, benign spelling errors, and candidate orderings. Every
run records its random seed. CI uses a fixed rotating seed set; a local stress
command accepts a seed and iteration count. Any failure prints the seed and
minimal scenario so it is exactly reproducible.

Properties include:

- the planner can select only declared actions;
- the chosen object always belongs to the returned candidate set;
- a folder action never opens a file;
- a safe-open action never opens a dangerous extension;
- changing actions never execute before valid origin-bound confirmation;
- duplicate delivery never produces a second Tool Gateway invocation;
- no success response exists without a verified successful result.

### Live filesystem smoke tests

An optional manual/local suite discovers candidates from allowlisted roots such
as the repository test fixtures, a generated temporary tree, and explicitly
selected standard folders. It randomly selects several safe directories and
non-executable files, asks for them through varied natural-language forms, and
verifies search, candidate freezing, and dry-run/open behavior.

The live suite never scans private roots not placed in scope, never opens an
executable, never deletes or modifies discovered files, and logs only bounded
test metadata. Its seed and selected candidate types are reported so a failure
can be reproduced without depending on one hard-coded product or filename.

## Rollout

The orchestrator is introduced behind a server configuration flag. Structured
commands remain available during rollout. Deployment order is:

1. database migration and server code with orchestration disabled;
2. Desktop client with candidate tickets and workflow-update protocol;
3. compatibility verification of advertised capabilities;
4. enable orchestration for Desktop chat;
5. run seeded and live acceptance suites;
6. enable Telegram orchestration;
7. monitor workflow failure categories and command audit records without
   logging private content or credentials.

Rollback disables new workflow creation while allowing already confirmed
commands to reach a terminal state. Existing conversations, devices, commands,
and `/desktop` diagnostics remain compatible.
