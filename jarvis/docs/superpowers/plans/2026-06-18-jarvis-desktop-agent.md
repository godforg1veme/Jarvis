# Jarvis Desktop Agent Implementation Plan

Goal: implement the Desktop/File/App/Window Agent described in
`docs/superpowers/specs/2026-06-18-jarvis-desktop-agent-design.md`.

The implementation should progress in thin, testable slices. Each slice must
preserve the rule that Python LangGraph plans and manages state, while Node owns
tool execution and safety.

## Phase 1: Runtime Skeleton And Protocol

- [x] Add `agent_runtime/requirements.txt`.
- [x] Add `agent_runtime/server.py` with JSON-lines stdio loop.
- [x] Add `agent_runtime/client_protocol.py` for message parsing/validation.
- [x] Add `agent_runtime/schemas/desktop_state.py` or equivalent typed schema.
- [x] Add `agent_runtime/graphs/desktop_graph.py` with a minimal graph that can
  classify a task and emit a simple plan/report without system mutation.
- [x] Add Python tests for ping, malformed messages, and simple task planning.
- [x] Add `scripts/ensureAgentRuntime.js` to create/check a Python 3.11+ venv
  and install requirements.
- [x] Add a Node script to smoke-test the Python process: ping and simple plan.

## Phase 2: Node Agent Client And Task Window Shell

- [x] Add `agents/desktopAgentClient.js` to spawn/supervise Python over stdio.
- [x] Add request id/task id correlation and timeout handling.
- [x] Add process crash handling that does not replay mutations.
- [x] Add `agents/agentHistory.js` with retention of 100 tasks or 30 days.
- [x] Add `agents/agentTaskWindow.js` to create a separate Electron
  BrowserWindow without stealing focus.
- [x] Add `renderer/agent-task/` HTML/CSS/JS using the approved B v3 layout.
- [x] Add preload exposure for agent task events/actions only.
- [x] Add IPC for cancel, stop-after-current-step, confirm, strong confirm,
  and user input.
- [ ] Add IPC for disabling plan steps.
- [x] Add a smoke path that opens the task window and displays a simple plan.

## Phase 3: Smart Router And Escalation

- [x] Add `agents/agentRouter.js` for `/agent`, natural triggers, multi-step
  detection, batch detection, candidate/confirmation escalation.
- [x] Integrate text launcher routing without breaking simple fast paths.
- [x] Integrate voice routing for agent triggers.
- [ ] Transfer existing fast-path candidates/confirmations into an agent task.
- [ ] Explain auto-escalation in the task timeline.
- [x] Enforce one active task at a time.
- [x] Add router tests for simple local commands, `/agent`, natural triggers,
  multi-step commands, and escalation on `needsSelection`/`needsConfirmation`.

## Phase 4: Tool Gateway And Safety Model

- [x] Add `agents/toolGateway.js` with explicit tool schemas.
- [x] Implement policy categories: `observe`, `low_risk`,
  `requires_confirmation`, `requires_strong_confirmation`.
- [x] Validate every Python tool request before execution.
- [x] Normalize paths and reject malformed requests.
- [x] Normalize app ids and window ids through local resolvers.
- [x] Return structured observations and errors to Python.
- [x] Add tests for allowed, rejected, malformed, and policy-requiring requests.

## Phase 5: File/Folder Mutation Tools

- [x] Extend file tools to handle folders as first-class candidates.
- [x] Add create folder.
- [x] Add rename.
- [x] Add move.
- [x] Add copy.
- [x] Add delete to recycle bin.
- [x] Add permanent delete behind strong confirmation.
- [x] Add auto-name conflict resolution.
- [x] Add batch limit enforcement at 20 items.
- [ ] Add tests for all file policies, including overwrite and batch mutation.

## Phase 6: App Gateway

- [x] Expose app resolve/launch through the gateway using existing app index and
  aliases.
- [x] Keep AI app normalization separate from execution.
- [x] Expose whitelisted app close through existing safe process logic.
- [x] Add tests for known app launch, unknown app rejection, and close whitelist.

## Phase 7: Window Tools

- [x] Add `tools/windowTools.js` backed by hidden PowerShell + Win32 `Add-Type`.
- [x] Implement list/find/focus/minimize/maximize/restore/soft-close.
- [x] Implement move/resize.
- [x] Implement snap halves, quarters, and multi-window layouts.
- [x] Restore minimized windows automatically when selected or unambiguous.
- [x] Keep process killing out of window close.
- [x] Add tests for script builders and mocked exec behavior.

## Phase 8: Planning, Input, Confirmation, And Execution

- [x] Normalize Python draft plans into concrete Node plans.
- [x] Add dependency checks for disabled steps.
- [x] Add candidate-first `ask_user` UI.
- [ ] Add voice selection support for `ask_user` steps.
- [x] Add ordinary confirmation.
- [x] Add two-step strong confirmation in UI.
- [ ] Add two-step strong confirmation by voice: `понимаю`, then
  `подтверждаю`.
- [ ] Execute plans step by step through the gateway.
- [x] Stop on first execution error.
- [x] Produce compact final reports with completed/skipped/failed steps.

## Phase 9: Agent LLM

- [x] Add `agent_runtime/llm/` provider interface.
- [x] Implement Gemini through LangChain integration.
- [x] Read `agentAi` config from `data/ai-settings.json`.
- [x] Use `GEMINI_API_KEY`, then `GOOGLE_API_KEY`.
- [x] Keep LLM output as strict JSON plan data, not tool calls.
- [x] Ensure prompts exclude file contents and screenshots.
- [x] Add no-key and configured-key behavior tests where feasible.

## Phase 10: Verification

- [x] Run Python tests.
- [x] Run Node agent protocol tests.
- [x] Run file command tests.
- [x] Run router/gateway/window tests.
- [x] Run `node scripts/testVoskLoad.js`.
- [x] Run at least one `node voice/testCommand.js "<agent command>"`.
- [ ] Run `npm start` and visually verify the agent task window.
- [ ] Manually smoke the acceptance command:
  `Агент, найди все png на рабочем столе и перемести до 20 штук в папку Images`.
- [x] Record any missing local model/key/runtime limitations honestly.

Verification notes:

- `node voice/testCommand.js "Agent, find all png on desktop and move up to 20 files to Images"` parses `desktop_agent`, but standalone execution returns "Desktop Agent недоступен" because the CLI test does not provide Electron's `startAgentTask` callback.
- `node scripts/testDesktopAgentClient.js` covers the demo agent flow through fake search, ordinary confirmation, strong confirmation, batch move, and final report without touching real files.
- In-app browser blocked direct `file://` visual verification by policy. No workaround server was started.
