# Jarvis Unknown App Recovery Implementation Plan

Date: 2026-08-25
Status: implementation and automated verification complete

Implementation summary (2026-08-30): the two-stage recovery flow, strict AI
candidate matching, same-channel confirmation, structured server-side launch,
learned alias storage, and script/custom-command fingerprint policy are in
place. Syntax checks and 26 focused regression tests pass. Renderer startup was
smoke-tested; the existing blur-to-hide behavior prevented the frameless main
window from remaining targetable by the Windows automation tool, so recovery
UI behavior is additionally covered by renderer and IPC tests.

Design reference:
`docs/superpowers/specs/2026-08-25-jarvis-unknown-app-recovery-design.md`

## Goal

Add a safe recovery path for application launch requests that miss the current
local resolver. Jarvis will discover local candidates in two stages, let a
strict AI matcher rank only those candidates, confirm through the originating
text or voice channel, launch the server-side candidate, and persist a learned
mapping only after success.

## Constraints

- Keep Electron, Node.js, and CommonJS.
- Preserve deterministic local resolution before discovery or AI.
- Keep the Node main process and Tool Gateway as execution authority.
- Never accept a launch path, command, arguments, or tool name from model
  output.
- Do not launch a recovery candidate from a renderer-supplied app object.
- Preserve current launcher, history, file-selection, voice, and Desktop Agent
  behavior outside the new recovery flow.
- Do not add a production dependency without explicit user approval.
- Keep filesystem scanning bounded, cancellable, and Windows-specific.
- Do not inspect network or removable drives by default.
- Do not send absolute paths, usernames, file contents, script contents, or
  hashes to an AI provider.
- Keep generated/machine-specific learned data out of Git.
- Use injected filesystem, clock, process, IPC, and AI dependencies in tests;
  automated tests must not launch real programs or require network access.
- Preserve unrelated worktree changes.

## Implementation Order

Build the feature from the trust boundary outward:

1. shared schemas and Unicode identity;
2. learned storage and launch policy;
3. structured launch execution;
4. discovery and validation;
5. strict AI/local matching;
6. recovery orchestration;
7. IPC, renderer, and voice adapters;
8. resolver integration and end-to-end verification.

This order makes every later layer consume already tested, non-model-controlled
launch identities.

## Target Files

Create:

- `tools/appIdentity.js`
- `tools/learnedAppStore.js`
- `tools/launchDescriptor.js`
- `tools/launchPolicy.js`
- `tools/appCandidateValidator.js`
- `tools/appDiscoveryService.js`
- `tools/appDiscoverySources.js`
- `tools/gameAppDiscovery.js`
- `tools/aiAppMatcher.js`
- `tools/appRecoveryService.js`
- `tools/appRecoveryRegistry.js`
- focused test files under `scripts/`

Modify:

- `tools/appResolver.js`
- `tools/appIndexer.js`
- `tools/launchApp.js`
- `tools/runProgram.js`
- `tools/aiClient.js`
- `actions/steamApps.js`
- `main.js`
- `preload.js`
- `renderer/index.html`
- `renderer/renderer.js`
- `renderer/styles.css`
- `voice/voiceService.js`
- `data/ai-settings.json`
- `.gitignore`
- `AGENTS.md`
- `README.md`
- affected existing tests

No generated `data/apps.learned.json` fixture should be committed. Tests use a
temporary injected path.

## Task 1: Define Launch Identity And Unicode Alias Rules

Files:

- Create: `tools/appIdentity.js`
- Create: `tools/launchDescriptor.js`
- Create: `scripts/testAppIdentity.js`
- Create: `scripts/testLaunchDescriptor.js`
- Read: `tools/appResolver.js`
- Read: `tools/runProgram.js`

- [ ] Add a versioned, plain-object launch descriptor contract for `exe`,
  `lnk`, `uwp`, `steam`, `epic`, `script`, and `command`.
- [ ] Require an absolute local target where the type uses a path.
- [ ] Represent arguments only as a string array; reject embedded NULs,
  non-string values, and oversized entries.
- [ ] Represent scripts with an explicit interpreter, script target, and
  arguments.
- [ ] Permit explicitly configured PowerShell `-Command` text only as one
  explicit argument; do not expose a helper that composes shell text.
- [ ] Implement canonical descriptor serialization for equality,
  deduplication, and fingerprints.
- [ ] Add Unicode alias normalization using NFKC, lowercase, `ё -> е`,
  punctuation-to-space, whitespace collapse, and trim.
- [ ] Add trigger-word removal for Russian and English launch phrases without
  deleting meaningful words inside application names.
- [ ] Preserve exact short aliases while keeping current resolver safeguards
  against fuzzy matching for short queries.
- [ ] Add tests for Cyrillic, mixed Cyrillic/Latin, punctuation, spaces,
  normalized equality, invalid descriptors, and canonical serialization.
- [ ] Run:
  - `node scripts/testAppIdentity.js`
  - `node scripts/testLaunchDescriptor.js`

## Task 2: Add The Learned Application Store

Files:

- Create: `tools/learnedAppStore.js`
- Create: `scripts/testLearnedAppStore.js`
- Modify: `.gitignore`
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] Add `data/apps.learned.json`, its last-known-good backup, quarantine
  names, and sibling temporary files to generated local state and Git ignores.
- [ ] Implement schema-v1 envelope validation and normalize records on read.
- [ ] Treat a missing file as an empty store.
- [ ] Quarantine a corrupt file with a timestamped local filename and continue
  with an empty store.
- [ ] Implement atomic write through a sibling temporary file and replacement.
- [ ] Preserve a last-known-good backup before replacing a valid store.
- [ ] Inject store path, filesystem functions, and clock for tests.
- [ ] Add an upsert API that requires a validated descriptor and successful
  launch provenance.
- [ ] Limit learned aliases to eight unique normalized strings of 2 through 80
  characters.
- [ ] Check each alias against manual and learned entries before writing.
- [ ] Skip conflicting aliases instead of replacing their current target.
- [ ] Never mutate or rewrite `apps.user.json` from recovery learning.
- [ ] Return the actual saved and skipped alias lists for user feedback.
- [ ] Test missing, valid, corrupt, backup, atomic failure, duplicate,
  conflicting, Cyrillic, and manual-precedence cases.
- [ ] Run `node scripts/testLearnedAppStore.js`.

## Task 3: Integrate Learned Records Into Local Resolution

Files:

- Modify: `tools/appResolver.js`
- Modify: `tools/runProgram.js`
- Modify: `scripts/testIntentRouter.js`
- Create: `scripts/testAppResolverLearned.js`

- [ ] Load learned entries through `learnedAppStore`; do not parse the file in
  multiple callers.
- [ ] Set source precedence to manual user entries, learned entries, defaults,
  and then generated/system sources.
- [ ] Convert validated learned launch descriptors to the candidate shape
  expected by resolver callers without losing provenance or trust metadata.
- [ ] Replace ASCII-only matching with the shared Unicode normalization while
  preserving current exact, starts-with, partial, score-gap, and short-query
  rules.
- [ ] Ensure an exact manual alias wins over an exact learned alias.
- [ ] Mark a missing learned target as stale in the resolution result instead
  of auto-launching it.
- [ ] Preserve `/appinfo`, `/debugresolve`, candidate selection, and current
  default/index behavior.
- [ ] Remove or redirect the legacy `learnApp` write path so recovery has one
  learned-store authority; keep `/addapp` as the explicit manual path.
- [ ] Test learned exact resolution without AI, Unicode resolution, manual
  precedence, stale targets, ambiguity, and legacy behavior.
- [ ] Run:
  - `node scripts/testAppResolverLearned.js`
  - `node scripts/testIntentRouter.js`

## Task 4: Implement Fingerprints And Launch Policy

Files:

- Create: `tools/launchPolicy.js`
- Create: `scripts/testLaunchPolicy.js`
- Read: `tools/fileSafety.js`

- [ ] Implement SHA-256 streaming for `.bat`, `.cmd`, and `.ps1` files.
- [ ] Combine script bytes with canonical interpreter and argument data.
- [ ] Fingerprint explicit custom commands from canonical target and argument
  data, including identifiable referenced local scripts.
- [ ] Return `confirmation_required` for every unknown candidate.
- [ ] Return `launch_allowed` for a valid learned ordinary app.
- [ ] Return `confirmation_required` for a learned script/command with missing
  or changed fingerprint.
- [ ] Return `blocked` for an invalid, missing, unsupported, or non-local target.
- [ ] Avoid treating an ordinary executable update timestamp as a script
  fingerprint change.
- [ ] Recompute and persist a new script/command fingerprint only after a new
  confirmed successful launch.
- [ ] Inject hash reader and target validator for deterministic tests.
- [ ] Test every descriptor type and all unknown, trusted, stale, unchanged,
  changed, missing, and blocked cases.
- [ ] Run `node scripts/testLaunchPolicy.js`.

## Task 5: Make Launch Execution Structured And Server-Side

Files:

- Modify: `tools/launchApp.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/renderer.js`
- Modify: `agents/toolGateway.js` if its app launch request still accepts a
  caller-provided object
- Create: `scripts/testLaunchAppStructured.js`
- Modify: `scripts/testToolGateway.js`

- [ ] Add one launch entry point that accepts only a normalized launch
  descriptor produced by trusted main-process code.
- [ ] Use `spawn(executable, args, { shell: false })` for executable,
  interpreter-backed script, and command descriptors.
- [ ] Keep platform APIs for shortcuts, UWP, Steam, and Epic, but construct
  their endpoints only from locally validated descriptor fields.
- [ ] Add explicit Epic launch support using a locally discovered launch
  identity.
- [ ] Return type-specific structured success/failure data without exposing
  secrets or provider payloads.
- [ ] Detect immediate non-zero exit where a child process handle exists; allow
  a clean one-shot exit to count as success.
- [ ] Replace the renderer `launch-selected-app(app)` trust boundary with a
  server-side candidate/recovery ID flow for recovery candidates.
- [ ] Preserve legacy deterministic selections during migration, then route
  them through a main-owned candidate record before removing direct object
  launch.
- [ ] Require existing Tool Gateway confirmation for `app.launch` and prevent a
  model/renderer from supplying arbitrary descriptors.
- [ ] Use injected spawn/shell/platform launchers in tests; never start a real
  process.
- [ ] Run:
  - `node scripts/testLaunchAppStructured.js`
  - `node scripts/testToolGateway.js`
  - `node scripts/testExecuteIntentWithoutElectronShell.js`

## Task 6: Extract Quick Discovery Sources

Files:

- Create: `tools/appDiscoverySources.js`
- Create: `tools/gameAppDiscovery.js`
- Modify: `tools/appIndexer.js`
- Modify: `actions/steamApps.js`
- Create: `scripts/testAppDiscoverySources.js`
- Create: `scripts/testGameAppDiscovery.js`

- [ ] Extract reusable Start Menu, UWP, App Paths, and exact command source
  adapters from `appIndexer` without changing full-index behavior.
- [ ] Give every adapter a bounded async contract with cancellation and
  per-source diagnostics.
- [ ] Add a query-guided configured-root adapter that respects the quick-stage
  deadline instead of running a full recursive rebuild.
- [ ] Extend Steam parsing to enumerate library manifests and return app name,
  numeric app ID, install location, and launch descriptor.
- [ ] Add Epic manifest discovery from known ProgramData launcher metadata and
  return app name, catalog identity, install location, and launch descriptor.
- [ ] Parse manifests as data; never execute manifest-provided commands.
- [ ] Normalize all adapter results to one raw candidate shape.
- [ ] Preserve `appIndexer.indexAll()` and `/refresh-apps` behavior by composing
  the extracted sources.
- [ ] Test absent registries/directories, malformed output/manifests, multiple
  Steam libraries, Epic manifests, cancellation, and deadlines.
- [ ] Run:
  - `node scripts/testAppDiscoverySources.js`
  - `node scripts/testGameAppDiscovery.js`

## Task 7: Add Candidate Validation And Local Ranking

Files:

- Create: `tools/appCandidateValidator.js`
- Create: `scripts/testAppCandidateValidator.js`
- Read: `tools/appResolver.js`

- [ ] Canonicalize local targets and reject unsupported or missing endpoints.
- [ ] Resolve shortcut metadata locally and produce a structured descriptor.
- [ ] Extract safe metadata fields: display name, filename, product name,
  description, publisher, signature status, file size, and modification time.
- [ ] Avoid requiring a valid signature; record signature as ranking metadata.
- [ ] Deduplicate by canonical descriptor identity, not display name alone.
- [ ] Add helper/updater/installer/crash/service name classification and score
  penalties.
- [ ] Allow an explicitly named helper target to remain selectable.
- [ ] Restrict raw interpreters to explicit user queries or script
  descriptors.
- [ ] Issue opaque random candidate IDs and keep paths out of serializable
  provider metadata.
- [ ] Implement deterministic local ranking from Unicode tokens, exact names,
  product metadata, source priority, explicit-query overrides, and penalties.
- [ ] Test symlink/reparse/canonical path handling as supported by Windows test
  fixtures, helper penalties, duplicates, interpreters, signatures, and
  metadata redaction.
- [ ] Run `node scripts/testAppCandidateValidator.js`.

## Task 8: Implement Cancellable Two-Stage Discovery

Files:

- Create: `tools/appDiscoveryService.js`
- Create: `scripts/testAppDiscoveryService.js`
- Modify: `data/settings.json`

- [ ] Expose `discoverQuick(query, context)` and
  `discoverExtended(query, context)` through one service boundary.
- [ ] Use a five-second default quick deadline and a 120-second default
  extended deadline, both configurable through validated settings.
- [ ] Enumerate fixed local drives for extended search; exclude network and
  removable drives by default.
- [ ] Apply the design exclusion list before descending into directories.
- [ ] Prioritize directory and filename tokens related to the query.
- [ ] Enforce depth, file, candidate, and concurrency limits so a malformed
  tree cannot create unbounded work.
- [ ] Stream progress and candidate batches with the active recovery ID.
- [ ] Stop scheduling directories on cancellation and discard late results.
- [ ] Preserve partial validated candidates after adapter failure, timeout, or
  cancellation.
- [ ] Summarize access-denied counts instead of emitting one UI/log event per
  path.
- [ ] Inject drive enumeration, directory reads, clock, scheduler, and source
  adapters.
- [ ] Test deadlines with a fake clock, fixed-drive filtering, exclusions,
  query priority, limits, progress monotonicity, cancellation, late results,
  partial success, and source isolation.
- [ ] Run `node scripts/testAppDiscoveryService.js`.

## Task 9: Add Strict AI Matching And Offline Fallback

Files:

- Create: `tools/aiAppMatcher.js`
- Create: `scripts/testAiAppMatcher.js`
- Modify: `data/ai-settings.json`
- Modify: `tools/aiClient.js`

- [ ] Add an `appRecovery` settings block with enabled flag, provider,
  thresholds, timeouts, shortlist maximum, and local fallback behavior.
- [ ] Default the first implementation to the existing OpenRouter text
  transport and configured fallback models.
- [ ] Keep a provider adapter boundary; do not add Gemini dependencies or
  implement a second provider in this task.
- [ ] Build provider payloads from at most 30 redacted candidate metadata
  records.
- [ ] Exclude absolute paths, account names, contents, and fingerprints.
- [ ] Require the exact schema-v1 object from the design.
- [ ] Reject markdown wrappers, unknown fields, paths, commands, args, tools,
  unknown IDs, invalid confidence, and oversized/invalid aliases.
- [ ] Apply `>= 0.85` single-candidate, `0.60-0.849` selection, `< 0.60` no-match,
  and `0.08` score-gap rules.
- [ ] Do not let AI confidence bypass confirmation.
- [ ] Implement local fallback selection using the validator's deterministic
  scores and no generated aliases.
- [ ] Abort or ignore provider work when recovery is cancelled.
- [ ] Extend `aiClient` timeout handling to compose its internal timeout abort
  with a caller-provided AbortSignal instead of overwriting the caller signal.
- [ ] Test missing key, configured injected transport, timeout, cancellation,
  malformed data, injection attempts, redaction, thresholds, ambiguity, alias
  normalization, and offline fallback.
- [ ] Run `node scripts/testAiAppMatcher.js`.

## Task 10: Implement Recovery State And Confirmation Authority

Files:

- Create: `tools/appRecoveryRegistry.js`
- Create: `tools/appRecoveryService.js`
- Create: `scripts/testAppRecoveryService.js`

- [ ] Implement the approved states: local search, quick discovery, optional
  extended discovery, AI/local ranking, optional selection, confirmation,
  launch, learning, completed, cancelled, and failed.
- [ ] Generate opaque recovery IDs and candidate IDs with injected randomness
  in tests.
- [ ] Keep canonical candidates and paths only in main-process session state.
- [ ] Expire candidate sessions after ten minutes and confirmations after 30
  seconds.
- [ ] Allow only one active confirmation globally.
- [ ] Cancel the prior recovery when a new command starts.
- [ ] Reject stale IDs, wrong-state actions, expired confirmations, and
  candidates outside the recovery.
- [ ] Revalidate the selected candidate immediately before launch.
- [ ] Call launch policy before every learned and unknown launch.
- [ ] Learn only after a confirmed successful launch and report saved/skipped
  aliases.
- [ ] Preserve a successful launch result if learning fails and add the
  approved warning.
- [ ] Emit serializable state snapshots without canonical paths except in the
  explicit local candidate-details response for renderer display.
- [ ] Test every valid state transition, cancellation edge, stale async result,
  selection branch, confirmation expiry, failed launch, failed learning, and
  repeat learned launch.
- [ ] Run `node scripts/testAppRecoveryService.js`.

## Task 11: Wire Main, Preload, And Renderer UX

Files:

- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/index.html`
- Modify: `renderer/renderer.js`
- Modify: `renderer/styles.css`
- Create: `scripts/testAppRecoveryIpc.js`
- Create: `scripts/testAppRecoveryRendererBehavior.js`

- [ ] Instantiate one recovery service in main with real production adapters.
- [ ] Add narrow IPC handlers for start, select, confirm, cancel, details, and
  current state.
- [ ] Validate sender, active recovery ID, candidate membership, state, and
  expiry in main.
- [ ] Emit progress and state events only to the relevant live renderer.
- [ ] Expose narrow preload methods; never expose filesystem paths as launch
  arguments or a generic recovery executor.
- [ ] Add a renderer recovery model separate from existing file candidates and
  PowerShell confirmation state.
- [ ] Render progress, cancel action, up to three candidates, candidate detail,
  confirmation, launch result, and learned-alias summary.
- [ ] Make `Запустить` the default focused confirmation action and support
  Enter; support Escape for cancel without affecting unrelated dialogs.
- [ ] Cancel an active recovery before routing a new typed command.
- [ ] Do not hide the main window until a confirmed launch succeeds.
- [ ] Preserve existing history and save one coherent history entry for the
  original user phrase.
- [ ] Test IPC rejection and renderer state/keyboard behavior without starting
  Electron or launching programs.
- [ ] Run:
  - `node scripts/testAppRecoveryIpc.js`
  - `node scripts/testAppRecoveryRendererBehavior.js`
  - `node scripts/testAgentTaskRendererBehavior.js`
  - `node scripts/testMainSingleInstanceOrder.js`

## Task 12: Integrate Voice Recovery

Files:

- Modify: `voice/voiceService.js`
- Modify: `main.js`
- Create: `scripts/testVoiceAppRecovery.js`
- Modify: `scripts/testVoiceServiceStateChange.js`
- Modify: `scripts/testVoiceServiceAgentInteractions.js`

- [ ] Route an unresolved spoken app launch into the same recovery service with
  `inputChannel: voice`.
- [ ] Reuse shared recovery confirmation state rather than creating a fourth
  independent voice confirmation authority.
- [ ] Speak one candidate's display name and generalized location, not an
  absolute path.
- [ ] Speak at most three numbered choices for an ambiguous result.
- [ ] Accept normalized `да`, `нет`, `отмена`, and valid ordinal words only in
  the matching active state.
- [ ] Accept bare `да` only for a single pending candidate.
- [ ] Treat an unrelated utterance as a new command: cancel recovery first,
  then route the new utterance.
- [ ] Expire pending voice confirmation through the shared 30-second policy.
- [ ] Preserve existing file selection, dangerous-file confirmation, Desktop
  Agent input, and strong confirmation precedence.
- [ ] Speak launch/learning success and failure messages through the existing
  TTS service interface.
- [ ] Test single candidate, selection, yes/no, ordinal, timeout, new command,
  stale response, TTS-off, and interaction with existing confirmation states.
- [ ] Run:
  - `node scripts/testVoiceAppRecovery.js`
  - `node scripts/testVoiceServiceStateChange.js`
  - `node scripts/testVoiceServiceAgentInteractions.js`
  - `node scripts/testVoiceServiceSttProvider.js`
  - at least one intent parser test

## Task 13: Connect Resolver Misses And Remove Duplicate Learning Paths

Files:

- Modify: `tools/runProgram.js`
- Modify: `tools/intentRouter.js`
- Modify: `actions/executeIntent.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: existing intent tests

- [ ] Trigger typed recovery only after existing deterministic app variants
  fail. Replace the launcher's legacy name-only AI retry with recovery ranking
  for this explicit app-launch path so text does not make a redundant AI call.
- [ ] Add an explicit internal `recover_app` intent shape carrying the original
  phrase and optional normalized `appQuery`, but no endpoint fields.
- [ ] For voice, let the existing AI intent classification return
  `recover_app` when it confidently identifies `launch_app` but the normalized
  `appQuery` is not in the known local registry. The later matcher call has the
  separate job of selecting from discovered candidates.
- [ ] Map `recover_app` in `executeIntent` to an injected `startAppRecovery`
  callback with `inputChannel: voice`.
- [ ] Preserve direct known-app launch behavior and current response shapes.
- [ ] Return a narrow `needsRecovery` result carrying only original query,
  optional normalized query, and input channel when orchestration must cross
  an existing module boundary.
- [ ] Ensure text and voice both preserve the original phrase for provenance
  and history.
- [ ] Retire the `learn-app` IPC endpoint if no manual UI caller remains; do not
  remove `/addapp`.
- [ ] Ensure a stale learned entry automatically enters recovery rather than
  ending as generic not-found.
- [ ] Test local hit with no discovery/AI calls, miss recovery, AI-name retry
  reuse, stale learned entry, cancellation, and repeated learned local hit.
- [ ] Run:
  - `node scripts/testIntentRouter.js`
  - `node scripts/testVoiceIntentAppBeforeFile.js`
  - the new recovery integration tests

## Task 14: Documentation, Security Review, And Full Verification

Files:

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: design/plan status after verified implementation
- Modify only scoped source files if verification exposes defects

- [ ] Document staged discovery, cancellation, learned data, alias conflict
  behavior, fingerprints, provider fallback, and privacy.
- [ ] Document that `data/apps.learned.json`, backups, quarantines, and scanner
  logs are generated local state.
- [ ] Search source for remaining recovery paths that accept renderer/model
  `path`, `command`, `args`, or arbitrary app objects.
- [ ] Search for `shell: true` in application launch paths and justify or remove
  each occurrence in scope.
- [ ] Verify provider requests contain no absolute Windows path with injected
  payload capture tests.
- [ ] Run syntax checks for every changed/created JavaScript file.
- [ ] Run all new tests from Tasks 1 through 13.
- [ ] Run existing relevant tests:
  - `node scripts/testIntentRouter.js`
  - `node scripts/testToolGateway.js`
  - `node scripts/testAgentRouter.js`
  - `node scripts/testDesktopAgentClient.js`
  - `node scripts/testAgentIntegrationWiring.js`
  - `node scripts/testVoiceServiceSttProvider.js`
  - `node scripts/testVoiceServiceStateChange.js`
  - `node scripts/testVoiceServiceAgentInteractions.js`
  - `node scripts/testExecuteIntentWithoutElectronShell.js`
  - `node scripts/testMainSingleInstanceOrder.js`
- [ ] Test missing-key behavior with no network.
- [ ] Test configured-provider behavior through an injected transport.
- [ ] Run one Electron smoke startup and clean shutdown.
- [ ] Visually verify text recovery progress, three-candidate selection,
  Enter/Escape confirmation, cancellation, error, and learned summary.
- [ ] Manually verify Russian voice confirmation with TTS/STT enabled.
- [ ] With explicit awareness that it changes local runtime state, manually
  test one harmless installed app, one portable executable if available, one
  UWP app, one Steam/Epic game if installed, and disposable scripts in a
  temporary directory.
- [ ] Confirm no generated learned/index/cache/log files are staged.
- [ ] Update design and plan status only after all required checks pass.

## Delivery Checkpoints

Checkpoint 1 — local trust foundation:

- Tasks 1 through 5 complete;
- learned records resolve locally;
- fingerprints and structured launching are tested;
- no recovery UI yet.

Checkpoint 2 — discovery and matching:

- Tasks 6 through 9 complete;
- quick/extended discovery, Steam/Epic parsing, strict AI ranking, and offline
  fallback pass injected tests;
- no production launch from AI-controlled data is possible.

Checkpoint 3 — end-to-end UX:

- Tasks 10 through 13 complete;
- text and voice recovery both confirm, launch, learn, and cancel safely;
- repeated learned launches stay local.

Checkpoint 4 — release readiness:

- Task 14 complete;
- regression, security, Electron, renderer, and voice verification pass;
- generated local state is not committed.

## Definition Of Done

- A deterministic resolver miss can enter staged recovery.
- Extended search is bounded, reports progress, and cancels safely.
- AI selects only an existing opaque candidate ID from redacted metadata.
- First recovered launch requires same-channel confirmation.
- Renderer/model data cannot introduce a launch endpoint.
- A successful launch writes only non-conflicting learned aliases.
- A repeated ordinary app request resolves locally without AI.
- A repeated script/custom command skips confirmation only while its
  fingerprint is unchanged.
- Russian aliases remain valid and searchable.
- Offline local ranking works without an API key.
- All scoped automated and manual checks pass.
- No generated local state or secrets are committed.
