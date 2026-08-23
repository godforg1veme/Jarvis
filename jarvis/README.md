# Jarvis

Jarvis is a personal Windows desktop assistant built with Electron and Node.js.
It provides a Spotlight-like launcher, app launching, local tools, command
history, local speech recognition, text-to-speech, and optional AI intent
resolution.

## Project Layout

- `main.js` - Electron lifecycle, tray, global shortcuts, IPC, and app windows.
- `preload.js` - safe renderer bridge.
- `renderer/` - launcher UI, agent task window, voice overlay, and transcription bar.
- `voice/` - speech worker selection, audio capture window, and intent parsing.
- `stt_runtime/` - optional Python runtime for faster-whisper speech recognition.
- `tts/` - provider-based text-to-speech service for Silero and Piper.
- `agents/` - Node orchestration, routing, task history, and the safe tool gateway.
- `agent_runtime/` - Python LangGraph runtime for stateful Desktop Agent tasks.
- `actions/` - intent execution helpers such as app launch and process actions.
- `tools/` - local tools, app resolver/indexer, AI client, screen vision, and selection helpers.
- `scripts/` - setup and verification scripts.
- `data/` - checked-in defaults plus ignored local runtime state.
- `assets/` - small source assets such as tray icons.

## AI Routing

Jarvis has two deliberately separate AI levels:

1. Deterministic launcher and voice parsers run first. If they cannot classify
   a simple one-step command, `tools/intentRouter.js` and
   `tools/aiIntentResolver.js` use OpenRouter to return a validated schema-v2
   intent. The model may name an action, app, file query, or known location,
   but it cannot supply executable paths, shell commands, or arbitrary tools.
2. Complex, stateful, batch, and multi-step work is passed with the original
   user text to the Python/Gemini Desktop Agent in `agent_runtime/`. The Node
   Tool Gateway in `agents/` remains the authority for any system-changing
   execution.

The simple fallback uses `OPENROUTER_API_KEY`. Desktop Agent planning uses
`GEMINI_API_KEY` or `GOOGLE_API_KEY` through the separate `agentAi` settings.

## Setup

```powershell
npm install
node scripts/ensureTts.js
```

`scripts/ensureTts.js` prepares local TTS dependencies and downloads voice
models into `voices/`. `scripts/ensureStt.js` prepares the optional
faster-whisper Python runtime in `stt_runtime/.venv`. Vosk models live in
`models/`. These machine-local assets are ignored when they are large or
generated.

## Run

```powershell
npm start
```

`start.bat` runs `node scripts/ensureTts.js` and `node scripts/ensureStt.js`
before launching Electron.

## Useful Checks

```powershell
node scripts/testVoskLoad.js
node scripts/ensureStt.js
node scripts/testSttSettings.js
node scripts/testVoiceServiceSttProvider.js
node voice/testCommand.js "джарвис включи доту"
node scripts/testTtsProvider.js
node scripts/testSileroService.js
node scripts/testTtsSpeak.js "тест голоса"
```

## Agent Context

Read `AGENTS.md` before changing code. It contains the project-specific safety
rules, module boundaries, generated-file policy, and verification expectations.

Do not commit local runtime state:

- `data/app-index.json`
- `data/apps.user.json`
- `data/history.json`
- `data/ai-cache.json`
- `data/agent-history.json`
- `data/ui-state.local.json`
- `data/tts-cache/`
- `models/`
- `voices/`
- logs and temporary audio files

Use environment variables for secrets such as `OPENROUTER_API_KEY`; never write
API keys into the repository.
