# Jarvis Desktop/File/App/Window Agent Design

## Goal

Build a real Desktop Agent for Jarvis that can safely operate local files,
folders, applications, and windows on Windows.

The agent must feel like an operator, not just a regex command parser:

- understand when a task is simple enough for local rules;
- escalate to an agent task window when a task needs planning, candidates,
  confirmation, batch handling, or window layout;
- use Python LangGraph for stateful agent orchestration;
- keep all system-changing execution behind a Node/Electron safety gateway;
- call an agent LLM only when local planning cannot confidently solve the task.

The first implementation phase focuses on the Desktop/File/App/Window Agent.
Browser automation is a later phase.

## Selected Architecture

Use a hybrid architecture:

```text
launcher/voice input
  -> smart router
  -> fast local path or Desktop Agent
  -> Python LangGraph runtime
  -> Node tool gateway
  -> local tools / Electron / PowerShell Win32
  -> agent task window / report
```

Python LangGraph is the agent brain and state machine. Node/Electron remains the
trusted system integration layer.

Python must not directly execute shell commands, mutate the filesystem, launch
apps, or manipulate windows. It may request tool calls from Node through an
explicit protocol. Node validates each request against schemas and safety policy
before execution.

## Scope

Desktop Agent v1 supports:

- finding files and folders;
- opening files and folders;
- revealing files and folders in Explorer;
- listing directory contents;
- creating folders;
- renaming files or folders;
- moving files or folders;
- copying files or folders;
- deleting files or folders to the recycle bin by default;
- permanent delete only after strong confirmation;
- batch operations up to 20 items;
- launching indexed/known applications;
- closing whitelisted applications through existing safe process logic;
- finding, focusing, minimizing, maximizing, restoring, closing, moving, and
  resizing windows;
- snap/layout commands for one or multiple windows, including common layouts
  such as code left and browser right;
- Russian and English commands.

Out of scope for v1:

- Browser Agent implementation;
- direct Python shell execution;
- arbitrary process killing outside the existing whitelist;
- unrestricted background task queues;
- more than one active agent task;
- sending file contents to the agent LLM;
- automatic dependency installation at app startup;
- full project-wide mojibake cleanup.

## Smart Routing

Jarvis decides whether to use the agent instead of making the user decide.

Routing behavior:

- Simple, unambiguous commands use the existing fast local path when possible.
- If a command needs candidates, confirmation, batch handling, a multi-step
  plan, app/window layout, or a natural agent phrase, Jarvis opens the Desktop
  Agent task window.
- `/agent ...` explicitly opens the agent runtime, but the runtime still avoids
  LLM calls when local rules can solve the task.
- Natural agent triggers include Russian/English forms such as "агент",
  "Джарвис, сделай", "выполни задачу", "разберись", "организуй", and "agent".
- If the fast path already discovered candidates or a confirmation need, that
  context is transferred into the agent task window instead of restarting from
  zero.
- Auto-escalation is explained to the user, for example: "Открыл агент, потому
  что нужно выбрать файл" or "Открыл агент, потому что нужен план".

## Python Runtime

Create a Python subsystem under `agent_runtime/`.

Required structure:

```text
agent_runtime/
  requirements.txt
  server.py
  client_protocol.py
  agents/
  graphs/
    desktop_graph.py
  llm/
  schemas/
  tests/
```

The runtime requires Python 3.11+.

Dependencies are installed into a local venv using:

```powershell
node scripts/ensureAgentRuntime.js
```

Jarvis must not run dependency installation automatically on startup or the first
agent task. If the runtime is missing, the agent window shows a clear instruction
to run the ensure script.

## Node Runtime

Create a Node orchestration layer under `agents/`.

Expected modules:

```text
agents/
  desktopAgentClient.js
  toolGateway.js
  agentTaskWindow.js
  agentRouter.js
  agentHistory.js
```

Responsibilities:

- start and supervise the Python process;
- speak stdio JSON-lines protocol;
- open and update the agent task window;
- enforce one active task at a time;
- validate and normalize plans;
- call safe file/app/window tools;
- store generated local history;
- emit notifications, tray/taskbar signals, and TTS prompts where appropriate.

## Node/Python Protocol

Transport: stdio JSON lines. One JSON object per line.

Node sends commands such as:

- `ping`
- `start_task`
- `resume_task`
- `cancel_task`
- `stop_after_current_step`
- `tool_result`
- `user_input`
- `confirm_plan`
- `reject_plan`
- `disable_steps`

Python sends events such as:

- `ready`
- `phase_changed`
- `event`
- `tool_request`
- `plan_draft`
- `needs_input`
- `needs_confirmation`
- `final_report`
- `error`

The protocol must include `task_id` on task-specific messages. Malformed,
unknown, or out-of-order messages are rejected and logged without executing any
system action.

If the Python process crashes, Node may restart the process, but it must not
automatically replay mutations. It shows the interrupted task state and asks the
user how to continue.

## Agent State

Desktop Agent state includes:

- `task_id`
- `user_command`
- `phase`
- `messages`
- `observations`
- `candidates`
- `plan`
- `disabled_steps`
- `dependency_errors`
- `pending_confirmation`
- `executed_steps`
- `errors`
- `llm_provider`
- `limits`
- `audit_refs`

State is in memory for active tasks. Pending confirmations are not restored
after app restart.

## LangGraph Design

Use Python LangGraph as a stateful graph.

Core nodes:

- `classify`: decide whether local rules can handle the task or agent LLM is
  needed.
- `observe`: request observe/low-risk tool calls through Node.
- `plan`: build a draft plan with local rules first and agent LLM only when
  needed.
- `normalize_request`: prepare the plan for Node validation and enrichment.
- `wait_for_input`: pause on `ask_user` or missing choices.
- `finalize`: produce a compact final report.

The graph streams phase and event updates so the task window can show what the
agent is doing.

LangGraph may use interrupts or equivalent state pauses for human-in-the-loop
input and confirmations, but the user-facing confirmation policy is enforced by
Node.

## LLM Routing

Keep current OpenRouter behavior for existing simple AI fallback.

Add `agentAi` config in `data/ai-settings.json`:

```json
{
  "agentAi": {
    "provider": "gemini",
    "model": "configured-by-user",
    "timeoutMs": 30000,
    "maxRetries": 1,
    "complexityPolicy": "static-v1"
  }
}
```

v1 implements the config abstraction but only the Gemini backend. A future
OpenRouter agent backend can use the same interface.

Key lookup order:

1. `GEMINI_API_KEY`
2. `GOOGLE_API_KEY`

The agent LLM receives:

- the user command;
- short observations;
- candidates;
- normalized paths;
- app names;
- window titles and app/window identifiers.

The agent LLM must not receive file contents in v1. Window/app planning may send
window titles and app names, but not screenshots or contents of windows.

The LLM returns strict JSON plan data. Do not use model tool-calling in v1. The
model never directly executes tools.

If the agent LLM is unavailable and the local planner cannot solve the task,
Jarvis stops and explains that the agent LLM/key/model is required.

## Tool Gateway

Node tool gateway exposes explicit schemas and policies to Python.

Policy categories:

- `observe`
- `low_risk`
- `requires_confirmation`
- `requires_strong_confirmation`

Examples:

- `observe`: search files, list directory, resolve app, list windows.
- `low_risk`: open safe file/folder, reveal in Explorer, focus/restore window.
- `requires_confirmation`: rename, move, copy, delete to recycle bin, close
  whitelisted app/process, multi-step plans with side effects.
- `requires_strong_confirmation`: permanent delete, overwrite, batch mutation,
  batch delete/move/copy/rename.

Python sends requests; Node decides if they are valid and safe.

## File And Folder Behavior

Allowed path scope: any path on disk, with strict normalization and safety gates.

Rules:

- All paths are normalized and resolved before use.
- Mutating operations must operate on concrete resolved paths, not raw LLM text.
- Create folder is the only mutation allowed without a separate confirmation
  when used as a simple local command; inside an agent plan it is still shown in
  the plan.
- Rename, move, copy, delete always require a plan/confirmation.
- Delete defaults to Windows recycle bin.
- Permanent delete requires strong confirmation.
- If destination exists, agent proposes a safe auto-name such as `file (1).txt`
  by default.
- Overwrite occurs only if the user explicitly asks for replacement and passes
  strong confirmation.
- Batch operations are limited to 20 items.
- If multiple candidates match, show the candidate list instead of guessing.
- If the destination is missing or ambiguous, use candidate-first input. Free
  text is a fallback.

For the demo command:

> "Агент, найди все png на рабочем столе и перемести до 20 штук в папку Images"

If `Images` is not found unambiguously, the agent asks where to create or find
it. It does not choose a location silently.

## Application Behavior

The agent can:

- launch applications from existing app index/aliases;
- use AI fallback only to normalize app intent, never to invent executable paths;
- close apps only through existing whitelisted safe process logic.

Launching indexed/known apps can happen without confirmation for simple
commands. Opening executable files such as `.exe`, `.bat`, `.cmd`, `.msi`, or
scripts as files requires explicit confirmation.

## Window Behavior

Implement window management through PowerShell + Win32 `Add-Type` wrappers in
Node, hidden from Python behind `windowTools`.

Window actions in v1:

- find/list windows;
- focus;
- minimize;
- maximize;
- restore;
- soft close with `WM_CLOSE`;
- move;
- resize;
- snap left/right/top/bottom;
- snap corners/quarters;
- multi-window layouts such as code left and browser right or three columns.

If a layout references a missing window, the agent asks whether to launch the
corresponding app or choose another window.

Minimized windows may be restored automatically when selected by the user or
found unambiguously for focus/layout.

Window close uses soft close only. Killing a process remains a separate
whitelisted app action.

## Plan And Confirmation

The user sees a normalized plan, not the raw LLM draft.

Node enriches the plan with:

- concrete paths;
- selected candidates;
- app ids;
- window handles or stable window ids;
- safety policy;
- dependency information;
- estimated affected items.

The user can disable individual plan steps with checkboxes. If disabling a step
breaks dependencies, Jarvis does not silently disable dependents. It shows
dependency errors and blocks execution until the plan is valid.

Read-only exploration can run before showing a plan. Safe open/reveal actions
may also run during exploration when appropriate. Mutations and dangerous opens
must wait for confirmation.

If a plan only contains observe/open/reveal steps, no confirmation is required.
If it contains app/window side effects or executable opens, confirmation is
required according to policy.

Execution stops on the first failed step. The report shows completed, skipped,
and failed steps.

## Strong Confirmation

Strong confirmation is required for:

- permanent delete;
- overwrite;
- any batch mutation;
- batch delete, move, copy, or rename.

UI strong confirmation uses two sequential confirmation actions, for example:

1. "Понимаю"
2. "Подтверждаю"

Voice strong confirmation also uses two distinct phrases:

1. "понимаю"
2. "подтверждаю"

Strong voice confirmation is accepted only while the agent task is actively
waiting for that confirmation. The agent window must be visible, but it does not
steal focus.

## Agent Task Window

Use a separate Electron `BrowserWindow` for agent tasks.

Chosen layout: B v3 from the brainstorming mockup.

Structure:

- narrow left rail with agent name, task id, phases, tiny limits text, stop/hide;
- large main live process area;
- compact plan draft/details panel;
- bottom status/action bar;
- final report remains visible after success.

The window opens immediately for agent mode. It does not automatically take focus
for voice input or confirmations.

If the task needs user attention, Jarvis should use available signals:

- taskbar flash;
- Windows notification/tray notification;
- TTS for voice-started tasks.

Notifications are used for `failed`, `blocked`, and `needs_input`, especially if
the window is not foregrounded.

Paths are shortened by default in the UI, with full paths available by hover,
click, expansion, or copy. Notifications use short names/paths to avoid leaking
long private paths.

## Interaction Model

Candidate-first input:

- show choices as buttons/list rows;
- voice can select numbered candidates when the list is explicit;
- free text is available only when choices are insufficient.

Cancel behavior:

- before execution: cancel the task;
- during execution: stop after the current step;
- no normal hard-kill button for in-flight file/window actions.

Only one active agent task is allowed in v1. A new agent command while one is
active shows the existing task window and asks the user to finish or cancel it.

After success, the task window remains open with the report. It does not
auto-close.

## History And Local State

Store generated local agent history in `data/agent-history.json`.

Retention:

- keep up to 100 tasks;
- also remove entries older than 30 days.

History may include:

- user command;
- phases;
- normalized plan;
- paths and app/window identifiers;
- observations and candidate lists;
- statuses;
- errors;
- final report;
- raw protocol/debug references where useful.

History must not store file contents. If a future feature reads file contents,
it needs a separate privacy policy before logging or sending that content.

`data/agent-history.json` is generated local state and must not be committed.

## Encoding

New agent files should use UTF-8 and normal Russian text.

Do not do a project-wide mojibake cleanup in this feature. If files are touched
for agent work and nearby text is mojibake, fix only the relevant touched text
deliberately.

## Browser Agent Next Phase

Browser Agent is out of scope for this spec.

Future phase summary:

- use Firefox;
- prefer connecting to the user's Firefox when feasible;
- fallback to a separate Playwright Firefox profile/context;
- do not use Chrome DevTools Protocol as the primary Firefox path;
- do not bypass CAPTCHA, paywalls, bot protection, or site restrictions;
- do not enter passwords, banking data, 2FA codes, or private data without
  explicit confirmation.

## Verification

Required checks for v1:

- Python runtime smoke: process start, ping, simple plan.
- Python unit tests for graph/state/planner protocol behavior.
- Node integration tests for stdio gateway.
- Tool gateway tests for schema validation and safety policy.
- File operation tests for search, create folder, move/copy/rename/delete,
  batch limit, recycle bin/permanent delete policy, conflict auto-name.
- App tests for indexed launch and whitelisted close behavior.
- Window tests for PowerShell Win32 script generation and safe mocked execution.
- Router tests for fast path vs agent escalation.
- Voice tests for agent trigger, confirmation, strong confirmation phrases.
- `node scripts/testVoskLoad.js`.
- At least one `node voice/testCommand.js "<agent command>"`.
- UI smoke by running `npm start` and visually checking the agent task window.

If Vosk models, agent LLM keys, or Python dependencies are missing, record that
as an environment limitation instead of pretending the check passed.

## Acceptance Scenario

Critical v1 demo command:

> "Агент, найди все png на рабочем столе и перемести до 20 штук в папку Images"

Expected behavior:

1. Jarvis opens the Desktop Agent task window.
2. The agent performs read-only exploration.
3. It finds up to 20 PNG files on Desktop.
4. If `Images` is missing or ambiguous, it asks the user where to create/find it.
5. It builds a normalized plan with concrete file paths and destination.
6. It marks the batch move as requiring strong confirmation.
7. The user can disable steps, but dependency errors block invalid plans.
8. After confirmation, Node executes through the safe gateway.
9. Execution stops on first error.
10. The report shows completed, skipped, and failed steps.
11. History is written to generated local state without file contents.

