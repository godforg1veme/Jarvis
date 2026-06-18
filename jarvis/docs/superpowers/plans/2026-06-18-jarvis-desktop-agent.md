# Jarvis Desktop Agent Implementation Plan

Goal: implement the Desktop/File/App/Window Agent described in
`docs/superpowers/specs/2026-06-18-jarvis-desktop-agent-design.md`.

The implementation should progress in thin, testable slices. Each slice must
preserve the rule that Python LangGraph plans and manages state, while Node owns
tool execution and safety.

## Phase 1: Runtime Skeleton And Protocol

- [ ] Add `agent_runtime/requirements.txt`.
- [ ] Add `agent_runtime/server.py` with JSON-lines stdio loop.
- [ ] Add `agent_runtime/client_protocol.py` for message parsing/validation.
- [ ] Add `agent_runtime/schemas/desktop_state.py` or equivalent typed schema.
- [ ] Add `agent_runtime/graphs/desktop_graph.py` with a minimal graph that can
  classify a task and emit a simple plan/report without system mutation.
- [ ] Add Python tests for ping, malformed messages, and simple task planning.
- [ ] Add `scripts/ensureAgentRuntime.js` to create/check a Python 3.11+ venv
  and install requirements.
- [ ] Add a Node script to smoke-test the Python process: ping and simple plan.

## Phase 2: Node Agent Client And Task Window Shell

- [ ] Add `agents/desktopAgentClient.js` to spawn/supervise Python over stdio.
- [ ] Add request id/task id correlation and timeout handling.
- [ ] Add process crash handling that does not replay mutations.
- [ ] Add `agents/agentHistory.js` with retention of 100 tasks or 30 days.
- [ ] Add `agents/agentTaskWindow.js` to create a separate Electron
  BrowserWindow without stealing focus.
- [ ] Add `renderer/agent-task/` HTML/CSS/JS using the approved B v3 layout.
- [ ] Add preload exposure for agent task events/actions only.
- [ ] Add IPC for cancel, stop-after-current-step, confirm, strong confirm,
  disable steps, and user input.
- [ ] Add a smoke path that opens the task window and displays a simple plan.

## Phase 3: Smart Router And Escalation

- [ ] Add `agents/agentRouter.js` for `/agent`, natural triggers, multi-step
  detection, batch detection, candidate/confirmation escalation.
- [ ] Integrate text launcher routing without breaking simple fast paths.
- [ ] Integrate voice routing for agent triggers.
- [ ] Transfer existing fast-path candidates/confirmations into an agent task.
- [ ] Explain auto-escalation in the task timeline.
- [ ] Enforce one active task at a time.
- [ ] Add router tests for simple local commands, `/agent`, natural triggers,
  multi-step commands, and escalation on `needsSelection`/`needsConfirmation`.

## Phase 4: Tool Gateway And Safety Model

- [ ] Add `agents/toolGateway.js` with explicit tool schemas.
- [ ] Implement policy categories: `observe`, `low_risk`,
  `requires_confirmation`, `requires_strong_confirmation`.
- [ ] Validate every Python tool request before execution.
- [ ] Normalize paths and reject malformed requests.
- [ ] Normalize app ids and window ids through local resolvers.
- [ ] Return structured observations and errors to Python.
- [ ] Add tests for allowed, rejected, malformed, and policy-requiring requests.

## Phase 5: File/Folder Mutation Tools

- [ ] Extend file tools to handle folders as first-class candidates.
- [ ] Add create folder.
- [ ] Add rename.
- [ ] Add move.
- [ ] Add copy.
- [ ] Add delete to recycle bin.
- [ ] Add permanent delete behind strong confirmation.
- [ ] Add auto-name conflict resolution.
- [ ] Add batch limit enforcement at 20 items.
- [ ] Add tests for all file policies, including overwrite and batch mutation.

## Phase 6: App Gateway

- [ ] Expose app resolve/launch through the gateway using existing app index and
  aliases.
- [ ] Keep AI app normalization separate from execution.
- [ ] Expose whitelisted app close through existing safe process logic.
- [ ] Add tests for known app launch, unknown app rejection, and close whitelist.

## Phase 7: Window Tools

- [ ] Add `tools/windowTools.js` backed by hidden PowerShell + Win32 `Add-Type`.
- [ ] Implement list/find/focus/minimize/maximize/restore/soft-close.
- [ ] Implement move/resize.
- [ ] Implement snap halves, quarters, and multi-window layouts.
- [ ] Restore minimized windows automatically when selected or unambiguous.
- [ ] Keep process killing out of window close.
- [ ] Add tests for script builders and mocked exec behavior.

## Phase 8: Planning, Input, Confirmation, And Execution

- [ ] Normalize Python draft plans into concrete Node plans.
- [ ] Add dependency checks for disabled steps.
- [ ] Add candidate-first `ask_user` UI and voice selection support.
- [ ] Add ordinary confirmation.
- [ ] Add two-step strong confirmation in UI.
- [ ] Add two-step strong confirmation by voice: `понимаю`, then
  `подтверждаю`.
- [ ] Execute plans step by step through the gateway.
- [ ] Stop on first execution error.
- [ ] Produce compact final reports with completed/skipped/failed steps.

## Phase 9: Agent LLM

- [ ] Add `agent_runtime/llm/` provider interface.
- [ ] Implement Gemini through LangChain integration.
- [ ] Read `agentAi` config from `data/ai-settings.json`.
- [ ] Use `GEMINI_API_KEY`, then `GOOGLE_API_KEY`.
- [ ] Keep LLM output as strict JSON plan data, not tool calls.
- [ ] Ensure prompts exclude file contents and screenshots.
- [ ] Add no-key and configured-key behavior tests where feasible.

## Phase 10: Verification

- [ ] Run Python tests.
- [ ] Run Node agent protocol tests.
- [ ] Run file command tests.
- [ ] Run router/gateway/window tests.
- [ ] Run `node scripts/testVoskLoad.js`.
- [ ] Run at least one `node voice/testCommand.js "<agent command>"`.
- [ ] Run `npm start` and visually verify the agent task window.
- [ ] Manually smoke the acceptance command:
  `Агент, найди все png на рабочем столе и перемести до 20 штук в папку Images`.
- [ ] Record any missing local model/key/runtime limitations honestly.

