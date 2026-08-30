# Jarvis Unknown App Recovery Design

Date: 2026-08-25
Status: implemented and verified

## Goal

Allow Jarvis to recover when normal local application resolution cannot find a
requested launch target. Jarvis searches the PC in two stages, asks an AI model
to rank only locally discovered candidates, requests confirmation through the
same channel as the original command, launches the confirmed target through
Node, and learns the successful mapping for future local-only resolution.

The feature supports:

- Windows executables and Start Menu shortcuts;
- UWP applications;
- Steam and Epic games;
- `.bat`, `.cmd`, and `.ps1` scripts;
- explicitly configured custom commands.

Future requests that match a learned ordinary application launch locally and
do not call AI. Learned scripts and custom commands may also launch locally
without confirmation while their SHA-256 fingerprint is unchanged.

## Current Context

Jarvis already contains most of the required primitives, but they are not
connected into a safe recovery flow:

- `tools/appResolver.js` searches `apps.user.json`, `apps.default.json`, the
  generated app index, and `where.exe` results;
- `tools/appIndexer.js` indexes Start Menu shortcuts, UWP apps, App Paths,
  configured scan roots, and a small list of popular commands;
- `tools/runProgram.js` calls OpenRouter only after deterministic app
  resolution fails, but the model may return only another application name;
- `tools/launchApp.js` launches resolved candidates;
- `tools/runProgram.js#learnApp` and the `learn-app` IPC handler can persist a
  selected mapping, but that path is not part of the successful launch flow;
- Russian aliases are currently damaged by normalization based on
  `[^a-z0-9]`;
- the Python/Gemini Desktop Agent intentionally cannot launch arbitrary
  LLM-selected applications, while the Node Tool Gateway remains execution
  authority.

Unknown App Recovery preserves that authority boundary. AI interprets and
ranks; local Node code discovers, validates, confirms, launches, and writes.

## Product Decisions

### Confirmation follows the input channel

- A typed request opens an inline confirmation card. The user chooses
  `Запустить` or `Отмена`; Enter activates the selected action and Escape
  cancels.
- A spoken request produces a spoken confirmation and accepts only the active
  confirmation vocabulary: `да`, `нет`, `первый`, `второй`, `третий`, or
  `отмена`, including existing voice-normalization variants.
- A new command cancels any pending confirmation before it is routed.
- A confirmation expires after 30 seconds unless the current voice UX already
  uses a shorter global interaction timeout.

An ordinary application is trusted for subsequent launches after one confirmed
successful launch. Scripts and custom commands additionally require an
unchanged fingerprint.

### Search is staged

Recovery does not immediately crawl every disk.

1. Quick discovery refreshes cheap system sources and searches configured
   roots. It targets a five-second response budget and streams any early
   candidates.
2. If quick discovery has no confident candidate, extended discovery walks
   fixed local disks in the background, reports progress, and supports cancel.
   Network and removable drives are excluded by default. Extended discovery
   has a configurable default deadline of 120 seconds; partial results survive
   timeout or cancellation.

The scan skips high-cost or irrelevant trees such as `$Recycle.Bin`,
`System Volume Information`, `Windows\\WinSxS`, temporary directories,
browser caches, package caches, `.git`, `node_modules`, virtual environments,
and generated build directories. Registered system apps remain available from
the quick sources even when their underlying Windows trees are excluded from a
recursive scan.

### AI ranks candidates but cannot create launch data

The model receives the original human phrase and a bounded shortlist of
locally validated metadata. It returns only a candidate ID, confidence,
aliases, and a short reason. Any response containing a path, command, shell
text, arguments, tool call, unknown field, or unknown candidate ID is rejected.

The default recovery ranker uses the existing OpenRouter text configuration.
The ranker has a provider-neutral interface so the existing Gemini runtime can
implement the same strict contract later without changing discovery or launch
policy. Gemini support is optional for the first implementation; deterministic
local ranking remains the offline fallback.

### Learning is automatic only after success

After a confirmed launch succeeds, Jarvis automatically stores:

- the original app phrase after removing launch trigger words;
- non-conflicting aliases proposed by AI;
- the validated structured launch descriptor;
- discovery and confirmation provenance;
- trust timestamps;
- a fingerprint for a script or custom command.

Cancellation, failed launch, ambiguous selection, or failed validation never
creates a learned entry. A failure to write the learned entry does not turn an
already successful launch into a failure; Jarvis reports that it launched the
target but could not remember it.

## Target Architecture

```text
typed command / voice command
            |
            v
      existing local parser
            |
            v
       appResolver.resolve
        |             |
        | hit         | miss
        v             v
 existing launch   appRecoveryService
                        |
          +-------------+--------------+
          |                            |
          v                            v
   quick discovery             extended discovery
          |                            |
          +-------------+--------------+
                        v
                candidateValidator
                        |
                        v
                  aiAppMatcher
                 or local fallback
                        |
                        v
             confirmationCoordinator
                 |               |
                 v               v
             text UI         voice dialog
                 |               |
                 +-------+-------+
                         v
                    launchPolicy
                         |
                         v
                    launchApp
                         |
                  successful launch
                         |
                         v
                  learnedAppStore
```

## Components

### `appRecoveryService`

This is the orchestration boundary for one recovery attempt. It owns the state
machine, cancellation token, time budgets, progress events, candidate session,
AI ranking request, confirmation request, launch result, and learning result.
It does not scan files, call a provider, write JSON, or spawn a process itself.

Each attempt has an opaque `recoveryId`. Asynchronous results are accepted only
while that attempt is active. Starting a new user command cancels the previous
attempt. This prevents a slow disk scan or provider response from presenting or
launching stale work.

### `appDiscoveryService`

This component exposes quick and extended discovery behind one streaming
interface. Source adapters return a common candidate shape and can be tested in
isolation.

Quick adapters cover:

- current learned, manual, default, and generated indexes;
- Start Menu shortcuts;
- Windows App Paths;
- `Get-StartApps` UWP records;
- exact `PATH`/`Get-Command` resolution;
- a query-guided, time-bounded pass over configured `scanRoots` that stops at
  the quick-stage deadline rather than invoking the existing full recursive
  index rebuild;
- Steam library manifests;
- Epic launcher manifests.

Extended discovery enumerates fixed local disks and looks for supported launch
targets. It is query-guided: directories and filenames that resemble expanded
query tokens are visited and ranked first. Results stream in batches so the UI
can show useful candidates without waiting for traversal to finish.

Discovery produces data; it never launches a candidate and never writes to the
persistent indexes. Existing `appIndexer` behavior remains available for a
manual full index refresh. Shared source adapters should be extracted rather
than duplicating PowerShell and registry logic.

### `candidateValidator`

The validator converts raw discovery records into launch candidates. It:

- canonicalizes and checks local paths;
- resolves shortcut metadata without trusting model output;
- verifies the expected file type;
- records file size, modification time, product name, description, publisher,
  and signature status when available;
- identifies interpreter-backed scripts;
- classifies installer, uninstaller, updater, crash handler, service helper,
  and other low-quality executable names;
- deduplicates by canonical launch identity;
- assigns an opaque session candidate ID.

Low-quality helpers receive a ranking penalty and are omitted from the AI
shortlist unless the query explicitly names them. They are hard-rejected only
when they cannot be represented by an allowed structured launch descriptor.
`cmd.exe`, `powershell.exe`, and equivalent interpreters are candidates only
when explicitly requested or when they are the interpreter for a discovered
script.

Candidate IDs are held in a server-side session map for ten minutes and are
never persisted. Confirmation and launch resolve the ID through that map.

### `aiAppMatcher`

The matcher accepts at most 30 top locally ranked candidates. A provider sees:

- opaque candidate ID;
- display name and filename;
- launch type;
- product description and publisher;
- signature status;
- generalized location such as `Program Files`, `user apps`, or `other local
  drive`;
- the original user phrase.

It does not receive the absolute path or Windows account name. The strict
response schema is:

```json
{
  "schemaVersion": 1,
  "candidateId": "candidate-17",
  "confidence": 0.93,
  "aliases": ["obsidian portable", "обсидиан", "заметки обсидиан"],
  "reason": "Название продукта и описание соответствуют запросу"
}
```

The normalizer rejects unexpected fields. Confidence must be finite and in the
range 0 through 1. Initial behavior is:

- `>= 0.85`: present the top candidate for confirmation;
- `0.60` through `0.849`: present up to three candidates for selection;
- `< 0.60`: treat the AI result as no confident match.

Confidence never bypasses confirmation. Local score separation is also
required for a single-candidate presentation: if the two best candidates are
within 0.08 after combined local and AI ranking, Jarvis presents a selection.

When no AI provider is available, local ranking uses Unicode token similarity,
filename/product-name equality, publisher metadata, source priority, and helper
penalties. It can present candidates but does not generate extra aliases.

### `confirmationCoordinator`

The coordinator stores one pending confirmation independent of UI. Its record
contains `recoveryId`, candidate IDs, input channel, expiry, prompt text, and
allowed responses. Renderer and voice service are adapters over this state,
not separate policy implementations.

For text with one candidate, the card shows display name, publisher, launch
type, and a readable path. For voice, Jarvis reads the display name and a short
location label; it does not read a full absolute path unless the user asks for
details.

For multiple candidates, text renders up to three choices. Voice reads up to
three numbered choices and accepts the number word or cancellation. A bare
`да` is valid only when exactly one candidate is pending.

### `launchPolicy`

This component turns a validated candidate and learned trust record into one of
three decisions:

- `confirmation_required`;
- `launch_allowed`;
- `blocked`.

An unknown candidate always requires confirmation. A learned executable,
shortcut, UWP app, or store game may launch without another prompt while its
structured target still validates. Executable updates do not require a new
confirmation merely because modification time changed.

Scripts and custom commands use SHA-256:

- a `.bat`, `.cmd`, or `.ps1` fingerprint covers the script bytes plus a
  canonical serialization of its interpreter and argument array;
- a custom command fingerprint covers the canonical executable target and
  exact argument array, and includes referenced local script files when those
  can be identified;
- a missing or changed fingerprint requires confirmation;
- the new fingerprint replaces the old value only after a confirmed successful
  launch.

The AI may never create a custom command. Such commands must already exist in a
local discovery source or be explicitly configured by the user.

### `learnedAppStore`

AI-learned records are isolated from manual records:

```text
data/apps.user.json       manual user entries
data/apps.learned.json    confirmed recovery mappings
data/app-index.json       replaceable generated index
```

Resolver priority becomes:

```text
apps.user
apps.learned
apps.default
start-menu
app-paths
uwp
registry
scan-roots
where
```

Writes are atomic: serialize to a sibling temporary file, flush and close it,
then replace the destination. The store retains a last-known-good backup before
replacing a valid file. A corrupt learned file is quarantined and does not stop
manual/default/index resolution.

Aliases use Unicode NFKC normalization, lowercase conversion, `ё` to `е`,
punctuation-to-space conversion, whitespace collapse, and trim. Cyrillic is
preserved. The store accepts at most eight unique aliases per entry, each 2 to
80 characters after normalization.

Before saving an alias, the store resolves it against manual and learned data.
An alias that already identifies a different target is skipped. AI never
replaces a manual alias. The original phrase is treated by the same collision
policy after launch trigger words are removed.

## Persistent Record Schema

`data/apps.learned.json` uses a versioned envelope:

```json
{
  "schemaVersion": 1,
  "apps": [
    {
      "id": "learned-obsidian",
      "displayName": "Obsidian",
      "aliases": ["obsidian portable", "обсидиан"],
      "launch": {
        "type": "exe",
        "target": "D:\\Apps\\Obsidian\\Obsidian.exe",
        "args": []
      },
      "provenance": {
        "source": "disk-scan",
        "aiProvider": "openrouter",
        "originalQuery": "открой обсидиан",
        "confirmedVia": "voice"
      },
      "trust": {
        "confirmedAt": "2026-08-25T12:00:00.000Z",
        "lastSuccessfulLaunchAt": "2026-08-25T12:00:02.000Z"
      },
      "fingerprint": null
    }
  ]
}
```

Allowed `launch.type` values are:

- `exe`: absolute executable plus argument array;
- `lnk`: absolute shortcut path;
- `uwp`: locally discovered AUMID;
- `steam`: numeric Steam app ID;
- `epic`: locally discovered Epic launch identity;
- `script`: explicit interpreter, script target, and argument array;
- `command`: canonical executable target and argument array.

Raw shell command lines are not an allowed persisted launch representation.
If an explicitly configured PowerShell command uses `-Command`, its command
text is stored as one explicit argument, fingerprinted, and never synthesized
or edited by AI.

## End-to-End Flow

For `Открой Obsidian Portable`:

1. The normal parser recognizes a launch request and `appResolver` tries the
   existing local sources.
2. A miss starts recovery with `inputChannel=text` or `voice`.
3. Quick discovery streams raw candidates through validation and local
   ranking.
4. If no good candidate exists by the quick deadline, extended discovery
   starts and progress is emitted.
5. The matcher receives the best validated metadata and returns an existing
   candidate ID and alias suggestions. Offline local ranking is used if needed.
6. A high-confidence unique candidate is presented for confirmation. A close
   or medium-confidence result becomes a maximum-three candidate selection.
7. Confirmation resolves the candidate ID from the active session map and
   revalidates the target immediately before launch.
8. `launchApp` executes a structured launch without accepting model-controlled
   shell text.
9. Success is type-specific:
   - executable/script/command: process creation succeeds; an immediate
     non-zero exit is failure, while a clean one-shot exit may be success;
   - shortcut/UWP/Steam/Epic: the platform launch API returns without an error.
10. The store filters aliases, computes any required fingerprint, and writes
    the learned record atomically.
11. Jarvis reports the launch and the aliases it actually saved.
12. A later request resolves through `apps.learned.json` before generated
    sources and uses `launchPolicy` to decide whether another prompt is needed.

## State Machine and Concurrency

One recovery attempt moves through:

```text
local_search
  -> quick_discovery
  -> extended_discovery (only when needed)
  -> ai_ranking or local_ranking
  -> awaiting_selection (only when ambiguous)
  -> awaiting_confirmation
  -> launching
  -> learning
  -> completed
```

`cancelled` and `failed` are terminal from every active state. Only one attempt
may own the global confirmation slot. All scan, AI, selection, confirmation,
and launch messages carry the same `recoveryId`; mismatched and terminal IDs
are ignored.

Cancellation stops scheduling new directory work. In-flight filesystem reads
may finish, but their results are discarded. The model request is aborted when
the transport supports it and otherwise ignored on completion.

## IPC and Trust Boundaries

Renderer and voice IPC messages use opaque IDs. They do not send an app object
back to main for launching. This replaces the unsafe recovery pattern of
accepting renderer-provided path, command, or AUMID values.

Conceptual IPC operations are:

- start recovery with query and channel;
- subscribe to progress/state snapshots;
- select an opaque candidate ID;
- confirm or cancel the active recovery ID;
- inspect candidate details;
- cancel recovery.

Main verifies the active recovery, candidate membership, confirmation state,
and expiry on every state-changing IPC call.

The Node Tool Gateway remains execution authority. If Desktop Agent support is
added to the same flow, Gemini may request observation through discovery and
may propose a candidate ID, but `app.launch` still requires the shared Node
confirmation and launch policy. The first implementation does not grant Gemini
arbitrary application launch capability.

## Error Handling

- Quick-source failure is recorded per adapter and does not abort other
  sources.
- Extended scan timeout or cancellation retains already validated candidates.
- Provider timeout, invalid JSON, unknown fields, unknown ID, or low confidence
  falls back to local ranking.
- If a learned target disappears, the record is marked stale in memory and a
  new recovery begins. The persistent record is retained until a replacement
  is successfully learned or the user removes it.
- A changed script moves to confirmation instead of launching.
- Launch failure returns to results with diagnostic text and does not learn.
- Learning write failure reports `Запустил, но не смог запомнить` and leaves
  the previous valid store intact.
- A corrupt learned store is quarantined, logged without secrets, and treated
  as empty.
- Disk access errors and protected paths are summarized rather than logged for
  every inaccessible file.

## Privacy

- Full candidate paths remain local.
- Cloud ranking receives generalized locations, not user profile names or
  absolute paths.
- File contents are never sent for candidate ranking.
- Script contents and hashes remain local.
- Provider logs contain recovery ID, provider/model, duration, response class,
  and candidate count, but not API keys or full paths.
- The user can cancel extended discovery before any provider request is made.

## Testing

### Unit tests

- quick and extended source adapters, exclusions, fixed-drive filtering,
  deadlines, progress, cancellation, and partial results;
- candidate canonicalization, shortcut/script representation, helper penalties,
  deduplication, and opaque ID expiry;
- AI request redaction and strict response rejection for paths, commands,
  arguments, unknown fields, invalid confidence, and unknown IDs;
- confidence thresholds, score-gap ambiguity, and offline ranking;
- Unicode alias normalization, trigger removal, maximums, deduplication, and
  collision precedence;
- atomic learned-store replacement, backup behavior, corrupt-file quarantine,
  and schema validation;
- launch policy for unknown, trusted, stale, missing, unchanged-hash, and
  changed-hash targets;
- canonical fingerprints for `.bat`, `.cmd`, `.ps1`, and custom commands;
- confirmation expiry and stale `recoveryId` rejection.

### Integration tests

- local miss -> quick discovery -> AI match -> text confirmation -> launch ->
  learn -> next local launch without AI;
- equivalent voice flow with spoken confirmation;
- multiple candidates with text selection and voice ordinal selection;
- new command cancelling pending confirmation;
- quick miss -> extended scan with progress -> cancel and partial results;
- missing OpenRouter key and provider timeout using local candidate ranking;
- invalid provider response that attempts to inject a path or command;
- script launch, unchanged repeat launch, content change, and renewed
  confirmation;
- launch failure followed by absence of a learned entry;
- successful launch with simulated learned-store write failure;
- stale learned target followed by a successful replacement recovery.

### Regression and manual verification

- run the existing intent router, launcher resolver, Tool Gateway, voice service,
  and Electron IPC tests affected by the change;
- verify both missing-key and configured-key AI behavior;
- verify known aliases from `data/app-aliases.json` still use the deterministic
  fast path;
- manually test Enter/Escape focus and cancellation in the renderer;
- manually test Russian voice `да`, `нет`, and ordinal selection;
- manually confirm that provider payloads contain no absolute paths;
- manually test at least one target of each supported launch type available on
  the development PC without committing generated index or learned data.

## Scope Boundaries

Included in the first implementation:

- staged local discovery with progress and cancellation;
- executables, shortcuts, UWP, Steam, Epic, scripts, and explicit custom
  commands;
- OpenRouter candidate ranking with a provider-neutral matcher boundary;
- deterministic offline ranking;
- text and voice confirmation;
- structured launch descriptors;
- automatic non-conflicting alias learning;
- SHA-256 revalidation for scripts and custom commands.

Explicitly deferred:

- local embedding/vector indexes;
- cloud reputation services and antivirus verdict aggregation;
- network/removable-drive search by default;
- AI generation of shell commands or scripts;
- automatic repair of moved apps without confirmation;
- more than three spoken candidate choices;
- synchronization of learned mappings between PCs.

## Acceptance Criteria

1. A request missed by the existing resolver can find a locally installed or
   portable supported target through staged discovery.
2. No model response can introduce or modify a launch path, executable,
   command text, interpreter, or argument.
3. The target is never launched before confirmation on its first recovered
   use.
4. Text requests confirm in the renderer; voice requests confirm through voice.
5. Only a confirmed successful launch creates or updates a learned record.
6. A learned ordinary app resolves locally on the next request without AI.
7. A learned script or custom command resolves locally without confirmation
   only while its SHA-256 fingerprint is unchanged.
8. Russian aliases remain non-empty and match using Unicode-aware
   normalization.
9. Conflicting aliases and manual records are never overwritten silently.
10. Extended search can report progress, return partial results, and be
    cancelled without a stale launch or prompt.
11. The feature remains usable with local ranking when OpenRouter is missing or
    unavailable.
12. Absolute candidate paths and script contents are not sent to cloud AI.
