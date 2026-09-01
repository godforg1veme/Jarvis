# Jarvis Unified Intent Routing Implementation Plan

Date: 2026-08-23
Status: implementation and verification complete

Documentation status: completed local-routing record. Consult `AGENTS.md` for
the newer cloud/server architecture before changing provider ownership.

Design reference:
`docs/superpowers/specs/2026-08-23-jarvis-unified-intent-routing-design.md`

## Execution Status

- Completed on 2026-08-23: unified schema-v2 OpenRouter resolver, shared voice
  router, launcher escalation, strict model-output validation, cache-v2
  migration, Node LangGraph removal, dependency cleanup, and documentation.
- Automated Node routing, Desktop Agent, Tool Gateway, syntax, and Python agent
  tests pass.
- Electron startup, local fast paths, Desktop Agent escalation, friendly
  missing/invalid-key behavior, and clean shutdown were verified. A live
  OpenRouter request was unavailable because the configured value is not a
  valid header-safe API key; the injected-transport test suite verifies the
  configured-provider path without exposing or editing secrets.

## Goal

Replace the separate Node LangGraph voice fallback and legacy app-only AI
fallback with one validated OpenRouter intent resolver, while keeping the
Python/Gemini Desktop Agent as the only stateful planning layer.

## Constraints

- Keep CommonJS.
- Preserve existing renderer candidates, history, and confirmations.
- Preserve deterministic parsing before any AI call.
- Do not add production dependencies.
- Remove the unneeded Node LangChain/LangGraph dependencies.
- Do not change Python Desktop Agent planning or Node Tool Gateway behavior.
- Never execute model-provided paths, commands, or arbitrary tool names.
- Use injected AI transports in automated tests; do not require network calls.
- Preserve unrelated user changes in the dirty worktree.

## Target Files

Create:

- `tools/intentRouter.js`
- `scripts/testIntentRouter.js`

Modify:

- `tools/aiIntentResolver.js`
- `tools/runProgram.js`
- `voice/voiceService.js`
- `voice/testCommand.js`
- `renderer/renderer.js`
- `package.json`
- `package-lock.json`
- relevant routing documentation/status notes

Delete:

- `agents/router/routerGraph.js`
- `agents/router/routerState.js`

Read-only behavioral references:

- `voice/intentParser.js`
- `actions/executeIntent.js`
- `tools/appResolver.js`
- `tools/aiClient.js`
- `agents/agentRouter.js`
- `agent_runtime/`
- `agents/toolGateway.js`

## Task 1: Lock Down The Unified Schema

Files:

- Create: `scripts/testIntentRouter.js`
- Modify: `tools/aiIntentResolver.js`

- [x] Add tests for the schema-v2 normalized envelope:
  - `route: direct` with `launch_app` and `appQuery`;
  - `route: direct` with file action, `query`, and known `location`;
  - `route: desktop_agent`;
  - `route: unknown`.
- [x] Add tests rejecting:
  - invalid JSON;
  - non-object JSON;
  - unknown route;
  - unknown action;
  - executable `path`, `command`, or tool-call fields;
  - arbitrary file locations/paths;
  - missing required fields;
  - non-finite or out-of-range confidence;
  - confidence below `0.75`.
- [x] Add capability-filter tests so an app-only caller cannot receive file or
  translation actions.
- [x] Add an immediate missing-`OPENROUTER_API_KEY` test proving that the
  injected transport is not called.
- [x] Add schema-versioned cache tests:
  - v2 keys include mode, model, and normalized input;
  - legacy cache records are ignored;
  - different capability modes do not share incompatible results.
- [x] Implement pure helpers in `tools/aiIntentResolver.js` for parsing,
  normalization, capability enforcement, and cache identity.
- [x] Keep model output as JSON data only; do not enable model tool calling.
- [x] Keep the existing public API temporarily only if a compatibility wrapper
  is needed during migration; remove it after all callers use the new API.
- [x] Run `node scripts/testIntentRouter.js` and verify all schema tests pass.

## Task 2: Implement The Shared OpenRouter Resolver

Files:

- Modify: `tools/aiIntentResolver.js`
- Read: `tools/aiClient.js`
- Read: `data/ai-settings.json`

- [x] Add one public resolver such as
  `resolveCommandWithAi(rawText, options)`.
- [x] Read only the top-level simple-intent configuration:
  - `provider` must be `openrouter` for this implementation;
  - use `textModel`, `fallbackModels`, `maxRetries`, and `timeoutMs` through
    existing `aiClient.js` behavior;
  - do not read or use `agentAi` settings.
- [x] Require `OPENROUTER_API_KEY` before invoking the transport.
- [x] Build one base prompt that:
  - describes the schema-v2 envelope;
  - lists only caller-allowed actions;
  - permits `desktop_agent` only when enabled by the caller;
  - forbids paths, shell commands, executable commands, and tool calls;
  - requires `unknown` when confidence is insufficient.
- [x] Pass responses through the pure normalizer from Task 1.
- [x] Cache only validated normalized results.
- [x] Return structured resolver errors without throwing raw provider payloads
  into renderer/voice UI.
- [x] Test valid configured-key behavior through an injected fake transport.
- [x] Test timeout, provider error, and malformed response behavior.

## Task 3: Add The Non-Stateful Intent Router

Files:

- Create: `tools/intentRouter.js`
- Modify: `scripts/testIntentRouter.js`
- Read: `voice/intentParser.js`

- [x] Implement `routeIntent(rawText, options)` with this order:
  1. call the injected/existing deterministic `parseIntent`;
  2. return immediately when local parsing succeeds;
  3. otherwise call the unified OpenRouter resolver;
  4. convert validated semantic data to the existing `executeIntent` shape;
  5. preserve `rawText`, `confidence`, `source`, and a concise reason.
- [x] Prove with a spy that known commands never call OpenRouter.
- [x] Map file actions to the existing `open_file`, `reveal_file`, and
  `find_file` intent contract.
- [x] Map `translate_selected` without adding new execution behavior.
- [x] Map `desktop_agent` using the original raw user text as `command`.
- [x] Resolve AI-proposed application names only through local known-app data.
  Unknown or ambiguous app queries must not auto-launch.
- [x] Return `ok: false` for unknown, malformed, disabled, missing-key, and
  low-confidence results.
- [x] Keep this module free of tool execution and task/conversation state.
- [x] Run `node scripts/testIntentRouter.js`.

## Task 4: Migrate Voice Routing

Files:

- Modify: `voice/voiceService.js`
- Modify: `voice/testCommand.js`
- Modify: `scripts/testVoiceServiceSttProvider.js` only if its dependency stubs
  require the new module boundary
- Delete later: `agents/router/routerGraph.js`
- Delete later: `agents/router/routerState.js`

- [x] Replace `runIntentRouter` imports with `routeIntent` from
  `tools/intentRouter.js`.
- [x] Preserve the existing cooldown, status broadcasting, confirmation,
  `executeIntent`, TTS, and error behavior.
- [x] Ensure regex/local results remain offline and fast.
- [x] Ensure an AI `desktop_agent` result reaches the existing
  `startAgentTask` callback unchanged.
- [x] Ensure unknown/missing-key AI fallback produces an ignored/error status
  without crashing or attempting execution.
- [x] Update `voice/testCommand.js` to use the shared router without changing
  its explicit warning that execution may affect the system.
- [x] Run:
  - `node scripts/testIntentRouter.js`
  - `node scripts/testCloseAppIntent.js`
  - `node scripts/testTranslateSelectedIntent.js`
  - `node scripts/testVisualIntent.js`
  - `node scripts/testVoiceIntentAppBeforeFile.js`
  - `node scripts/testVoiceServiceSttProvider.js`

## Task 5: Migrate Launcher AI Fallback

Files:

- Modify: `tools/runProgram.js`
- Modify: `renderer/renderer.js`
- Modify: `scripts/testIntentRouter.js`
- Read: `tools/appResolver.js`

- [x] Replace the legacy app-only resolver consumption with schema-v2 results.
- [x] Call the unified resolver only after existing local app resolution fails.
- [x] Limit `runProgram` capabilities to:
  - `launch_app`;
  - `search_app`;
  - `desktop_agent`;
  - `unknown`.
- [x] Feed `appQuery` back into the existing local app resolver.
- [x] Preserve current auto-launch thresholds and candidate-selection results.
- [x] Reject model paths or direct app endpoints even if present in the raw
  response.
- [x] For `desktop_agent`, return a narrow main-process result:

  ```json
  {
    "ok": false,
    "type": "agent",
    "needsAgent": true,
    "command": "original user input"
  }
  ```

- [x] Add one renderer branch that handles `needsAgent` by invoking the
  existing `window.jarvis.startAgentTask(command)`.
- [x] Do not execute a general model-provided intent inside the renderer.
- [x] Add tests for:
  - AI-normalized app query resolving locally;
  - ambiguous candidates remaining a selection;
  - `desktop_agent` preserving original text;
  - unsupported AI action producing not-found/unknown behavior.
- [x] Run `node scripts/testIntentRouter.js` and existing app resolver checks.

## Task 6: Remove The Redundant Node AI Stack

Files:

- Delete: `agents/router/routerGraph.js`
- Delete: `agents/router/routerState.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Confirm no source file imports `agents/router`, `@langchain/core`,
  `@langchain/google-genai`, `@langchain/langgraph`, or `@langchain/openai`.
- [x] Remove the four Node production dependencies with npm so the lockfile is
  updated mechanically.
- [x] Keep `dotenv`.
- [x] Do not change `agent_runtime/requirements.txt` or remove Python
  LangGraph/Gemini dependencies.
- [x] Run `npm ls --depth=0` and verify the removed Node packages are absent.
- [x] Run `node --check` for every modified/created JavaScript file.

## Task 7: Regression And Safety Verification

Files:

- Modify only if verification exposes a scoped defect.

- [x] Run deterministic routing tests:

  ```powershell
  node scripts/testIntentRouter.js
  node scripts/testAgentRouter.js
  node scripts/testFileCommands.js
  node scripts/testCloseAppIntent.js
  node scripts/testTranslateSelectedIntent.js
  node scripts/testVisualIntent.js
  node scripts/testVoiceIntentAppBeforeFile.js
  node scripts/testVoiceServiceSttProvider.js
  ```

- [x] Run Desktop Agent regressions:

  ```powershell
  node scripts/testAgentRuntimeProtocol.js
  node scripts/testDesktopAgentClient.js
  node scripts/testPlanNormalizer.js
  node scripts/testToolGateway.js
  ```

- [x] Run Python agent tests without making real system changes:

  ```powershell
  agent_runtime\.venv\Scripts\python.exe -m unittest discover -s agent_runtime/tests -v
  ```

- [x] Verify missing-key behavior with `OPENROUTER_API_KEY` absent from the
  injected test environment.
- [x] Verify configured-key behavior with a fake/injected OpenRouter transport.
- [x] Verify no automated test launches an application, mutates user files, or
  requires a live AI request.
- [x] Run `git diff --check`.

## Task 8: Documentation And Manual Smoke

Files:

- Modify: `README.md` if its AI architecture summary needs clarification
- Modify: `AGENTS.md`, `CLAUDE.md`, and `gemini.md` only if command or module
  boundaries changed materially
- Modify: relevant implementation-plan status notes

- [x] Document the two AI levels:
  - OpenRouter simple fallback in Node;
  - Gemini stateful planning in Python Desktop Agent.
- [x] Document that deterministic parsing runs before AI.
- [x] Document that Node Tool Gateway remains the Desktop Agent execution
  authority.
- [x] Mark the unified routing design as fully verified after automated and
  manual verification.
- [x] If authorized to run Electron, manually verify:
  - known voice command uses local fast path;
  - unusual voice app wording uses OpenRouter fallback;
  - unusual typed app wording preserves app candidates;
  - complex command opens Desktop Agent;
  - missing OpenRouter key leaves local commands usable.
- [x] Stop Electron cleanly and confirm no duplicate background process remains.
- [x] Review final `git status --short` and ensure only intended files changed.

## Completion Definition

The implementation is complete when:

- Node has one OpenRouter simple-intent resolver;
- Python/Gemini Desktop Agent remains the sole stateful planning layer;
- known commands do not call AI;
- typed and voice AI fallbacks share schema, provider, validation, cache, and
  error behavior;
- model output cannot directly execute paths, commands, or arbitrary tools;
- Node LangGraph routing files and packages are gone;
- all listed deterministic Node and Python tests pass;
- manual Electron limitations, if any, are recorded honestly.
