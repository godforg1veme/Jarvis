# Jarvis Unified Intent Routing Design

Date: 2026-08-23
Status: approved design, pending implementation planning

## Goal

Reduce Jarvis from three overlapping AI decision paths to two clearly bounded
AI levels:

1. a Node-based OpenRouter fallback that normalizes simple, single-step
   commands after deterministic parsing fails;
2. the existing Python/Gemini Desktop Agent for complex, stateful, batch, and
   multi-step tasks.

The change must preserve the current launcher UX, voice fast paths, candidate
selection, confirmations, local app resolution, and the Node Tool Gateway as
the authority for system-changing execution.

## Problem

Jarvis currently has three partially overlapping AI paths:

- `tools/aiIntentResolver.js` is an OpenRouter fallback used by
  `tools/runProgram.js` when local app resolution fails;
- `agents/router/routerGraph.js` is a separate Node LangGraph pipeline used by
  voice input, with its own Gemini/OpenRouter/OpenAI selection, prompt, JSON
  shape, and error handling;
- `agent_runtime/` is the Python LangGraph Desktop Agent that plans multi-step
  tasks and requests safe tools from Node.

The first two paths both normalize simple commands but disagree on providers,
configuration, action names, missing-key behavior, caching, and supported
routes. The same wording can therefore behave differently when typed and when
spoken. The Node LangGraph graph also adds several production dependencies for
a two-node `regex -> LLM` flow that does not need stateful graph machinery.

The Python Desktop Agent is not redundant. It owns planning and task state, not
simple intent normalization, and remains a separate AI level.

## Decisions

### Provider ownership

- Simple Node fallback uses only OpenRouter through the existing
  `tools/aiClient.js` transport and the top-level text settings in
  `data/ai-settings.json`.
- Python Desktop Agent continues to use `agentAi` settings and Gemini.
- Node simple routing does not inspect `GEMINI_API_KEY` or `GOOGLE_API_KEY`.
- Python Desktop Agent does not use OpenRouter in v1.

Expected key ownership:

```text
OPENROUTER_API_KEY
  -> simple Node intent fallback

GEMINI_API_KEY / GOOGLE_API_KEY
  -> Python Desktop Agent planning
```

### Deterministic parsing remains source-aware

The text launcher and voice service keep their existing deterministic fast
paths. They have different interaction requirements:

- launcher parsing owns slash commands, history, result candidates, and visual
  confirmation UI;
- voice parsing owns wake aliases, recognition variants, and voice-specific
  intent handling.

These parsers are local code, not competing AI contours. Both call the same
OpenRouter resolver only after their local path cannot confidently handle the
input.

### AI never executes tools

The unified resolver returns semantic data only. It must not return or execute:

- executable paths;
- shell or PowerShell commands;
- arbitrary tool names;
- registry commands;
- filesystem mutations;
- model tool calls.

Existing local resolvers, `executeIntent`, `runProgram`, `fileCommander`, and
the Desktop Agent Tool Gateway remain responsible for validation and execution.

## Target Architecture

```text
launcher text                         voice text
     |                                    |
     v                                    v
launcher deterministic parser       voice parseIntent
     |                                    |
     +---------- confidently handled -----+
     |                  |
     |                  v
     |            existing local executor
     |
     +---------- unresolved ---------------+
                        |
                        v
          unified OpenRouter intent resolver
                        |
              +---------+---------+
              |                   |
              v                   v
        direct semantic      desktop_agent
            intent                route
              |                   |
              v                   v
       local executor       Python/Gemini planner
                                  |
                                  v
                           Node Tool Gateway
```

The unified OpenRouter resolver is shared, while caller-specific adapters may
restrict which actions they can consume. This keeps one provider, schema,
validation policy, cache format, and error model without rewriting the entire
renderer command pipeline.

## Unified AI Result Contract

The resolver returns a normalized object with schema version 2:

```json
{
  "schemaVersion": 2,
  "route": "direct",
  "action": "launch_app",
  "appQuery": "Visual Studio Code",
  "query": null,
  "location": null,
  "confidence": 0.91,
  "reason": "",
  "source": "openrouter"
}
```

### Routes

Allowed `route` values:

- `direct`: one supported, single-step command;
- `desktop_agent`: task requires planning, multiple steps, batch behavior, or
  user input;
- `unknown`: unsupported or insufficiently confident input.

### Direct actions

Allowed `action` values for `direct`:

- `launch_app`
- `search_app`
- `close_app`
- `open_file`
- `reveal_file`
- `find_file`
- `translate_selected`

No action outside this allowlist survives normalization.

### Application fields

AI may return only a human-facing `appQuery`. It may not return an executable
path or launch command. Local app resolution remains authoritative.

For typed app commands, `runProgram` feeds `appQuery` back into the existing
`tools/appResolver.js`, preserving score thresholds, candidate selection, and
local aliases.

For voice commands, the intent adapter resolves `appQuery` through local known
application data. A query that is unknown or ambiguous must not be silently
launched. The adapter returns an unknown/selection result and may show the main
window rather than guessing.

### File fields

File intents may contain:

- `query`: file or folder name;
- `location`: one known location identifier.

Allowed locations are limited to identifiers understood by the existing file
location layer, such as `desktop`, `downloads`, `documents`, `pictures`,
`videos`, `music`, `home`, and `computer`. Arbitrary model-provided paths are
rejected.

### Confidence

The normalized confidence must be a finite number from 0 to 1. The initial
acceptance threshold is `0.75`. Results below the threshold become `unknown`.
Deterministic local results do not use this AI threshold.

### Desktop Agent route

For a complex task the resolver returns:

```json
{
  "schemaVersion": 2,
  "route": "desktop_agent",
  "action": null,
  "confidence": 0.94,
  "reason": "multi-step batch file task",
  "source": "openrouter"
}
```

The original user text, not an LLM rewrite, is passed to `startAgentTask`.
OpenRouter decides only the route. Python/Gemini independently produces the
plan and concrete tool requests.

## Component Design

### `tools/aiIntentResolver.js`

This becomes the single Node AI command-normalization service.

Responsibilities:

- load top-level AI intent settings;
- fail locally and clearly when `OPENROUTER_API_KEY` is absent;
- call OpenRouter through `tools/aiClient.js`;
- request strict JSON without model tool calling;
- parse and normalize the schema-v2 envelope;
- reject unknown actions, locations, paths, and malformed fields;
- enforce the confidence threshold;
- cache only normalized schema-v2 results;
- support caller-provided capability restrictions.

Capability restrictions prevent a caller from receiving an action it cannot
safely integrate. For example:

- `runProgram` consumes `launch_app`, `search_app`, `desktop_agent`, and
  `unknown`;
- voice consumes the complete simple-action allowlist plus `desktop_agent` and
  `unknown`.

All capability variants share the same base schema, provider, validation,
settings, error handling, and cache implementation.

### `tools/intentRouter.js`

This is a small, non-stateful router for voice and other main-process callers.

Flow:

1. call the existing deterministic `parseIntent(rawText)`;
2. return immediately when the local result is successful;
3. otherwise call the unified OpenRouter resolver;
4. map the normalized result to the existing `executeIntent` contract;
5. preserve `rawText`, confidence, and source metadata;
6. return `ok: false` for missing keys, invalid responses, low confidence, or
   unsupported actions.

This module must not execute commands or hold conversation/task state.

### `tools/runProgram.js`

The existing local resolver remains first.

When local app resolution fails:

1. call the unified resolver with app/agent capabilities;
2. for `launch_app` or `search_app`, feed `appQuery` back into the local app
   resolver;
3. preserve current auto-launch and selection behavior;
4. for `desktop_agent`, return a structured `needsAgent` response containing
   only the original user command;
5. for `unknown` or any unsupported result, return the existing not-found
   response with a concise AI status.

`runProgram` does not directly start the Desktop Agent.

### `renderer/renderer.js`

The renderer keeps its current parser and command UI. It adds one narrow result
branch: when a trusted main-process result contains `needsAgent: true`, call the
existing `window.jarvis.startAgentTask(originalCommand)` and display the agent
startup result.

No general-purpose model intent is executed inside the renderer.

### `voice/voiceService.js` and `voice/testCommand.js`

Replace `agents/router/routerGraph` with `tools/intentRouter`. Existing
`executeIntent` and injected callbacks remain the execution boundary.

### Python Desktop Agent

`agent_runtime/`, its Gemini provider, protocol, plan normalization, task
window, and Node Tool Gateway are not replaced by this work. Only the routing
decision that sends a task to the agent is shared.

## Settings And Cache

Top-level simple intent settings remain in `data/ai-settings.json`:

```json
{
  "provider": "openrouter",
  "textModel": "openrouter/free",
  "fallbackModels": ["openrouter/free"],
  "maxRetries": 2,
  "timeoutMs": 30000,
  "enableAiIntent": true,
  "useAiOnlyOnFallback": true
}
```

Desktop Agent settings remain isolated under `agentAi`.

Cache entries must include enough identity to prevent schema or capability
collisions. The logical key includes:

- schema version;
- capability mode;
- configured model;
- normalized input text.

Example:

```text
v2:voice:openrouter/free:открой синий редактор
```

Legacy entries without schema version 2 remain on disk but are ignored. The
implementation must not treat legacy app-only JSON as a schema-v2 command.

## Error Handling

### Missing OpenRouter key

The resolver returns a clear local failure without a network attempt. Local
deterministic commands continue to work.

### Missing Gemini key

Only Desktop Agent planning is unavailable. Simple commands and OpenRouter
fallback continue to work.

### Invalid JSON or schema

Malformed JSON, unknown routes/actions, invalid locations, executable paths,
missing required fields, and low confidence become `unknown`. No command is
executed.

### Network, timeout, and rate-limit errors

Use the existing `aiClient.js` retry, timeout, and OpenRouter error formatting.
The caller receives a concise failure result and remains usable for local
commands.

### Ambiguous applications

The local app resolver decides whether there is a clear winner. Ambiguous
results produce candidates instead of an automatic launch.

## Safety Invariants

- Deterministic parsing always runs before AI fallback.
- AI fallback runs only when enabled and unresolved locally.
- Model output is data, never executable code.
- AI does not provide executable paths or arbitrary filesystem paths.
- App launch still goes through local app resolution.
- File actions still go through existing location, safety, and confirmation
  logic.
- Complex tasks use the original user text when starting Desktop Agent.
- Python never directly mutates the system.
- Node Tool Gateway remains the only Desktop Agent tool-execution authority.
- Unknown, malformed, unsupported, or low-confidence output performs no action.

## Dependency Changes

Remove these Node production dependencies:

- `@langchain/core`
- `@langchain/google-genai`
- `@langchain/langgraph`
- `@langchain/openai`

Remove the unneeded Node router files:

- `agents/router/routerGraph.js`
- `agents/router/routerState.js`

Keep `dotenv`, which is used to load local environment variables.

Python LangGraph dependencies in `agent_runtime/requirements.txt` are unchanged.

## Verification

Add deterministic tests for:

- local regex success without an AI call;
- immediate missing-key behavior without a network call;
- valid OpenRouter direct intent normalization;
- valid `desktop_agent` routing using the original input;
- invalid JSON;
- unknown route and action;
- executable/path field rejection;
- invalid file location;
- confidence below `0.75`;
- schema-v2 cache identity and legacy-cache rejection;
- app query passing through the local resolver;
- ambiguous app candidates remaining non-executable;
- renderer handling of `needsAgent`;
- caller capability restrictions.

Run the relevant existing regression checks:

```powershell
node scripts/testIntentRouter.js
node scripts/testAgentRouter.js
node scripts/testFileCommands.js
node scripts/testCloseAppIntent.js
node scripts/testTranslateSelectedIntent.js
node scripts/testVisualIntent.js
node scripts/testVoiceIntentAppBeforeFile.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testDesktopAgentClient.js
npm ls --depth=0
```

Configured-key behavior should use an injected/mock OpenRouter transport in
deterministic tests. A real network call is optional manual verification and
must not be required for the automated suite.

## Acceptance Criteria

1. Known voice commands complete locally without invoking OpenRouter.
2. Typed app fallback and voice fallback share one OpenRouter resolver,
   schema, settings source, validation policy, and cache format.
3. A missing `OPENROUTER_API_KEY` causes no network request and does not break
   local commands.
4. Node no longer imports or installs LangChain/LangGraph/Google/OpenAI client
   packages for simple routing.
5. Complex or batch input can route to Desktop Agent, passing the original
   command unchanged.
6. Python/Gemini Desktop Agent and Node Tool Gateway behavior remain intact.
7. AI output cannot directly provide executable paths, arbitrary tool calls,
   or unvalidated filesystem paths.
8. Ambiguous app resolution still presents candidates instead of launching a
   guessed app.
9. Existing voice, file, app, and Desktop Agent regression tests pass.

## Out Of Scope

- replacing Python Desktop Agent with Node;
- rewriting the entire renderer command pipeline;
- adding model tool calling;
- adding new AI providers;
- browser automation;
- conversation memory for simple commands;
- changing confirmation policy or Tool Gateway behavior;
- broad cleanup of unrelated voice, renderer, or agent code.

