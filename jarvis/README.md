# Jarvis

Jarvis is a personal Windows desktop assistant built with Electron and Node.js.
It provides a Spotlight-like launcher, app launching, local tools, command
history, local speech recognition, text-to-speech, and optional AI intent
resolution.

## Project Layout

- `main.js` - Electron lifecycle, tray, global shortcuts, IPC, and app windows.
- `preload.js` - safe renderer bridge.
- `renderer/` - launcher UI and voice capture renderer code.
- `voice/` - speech worker selection, audio capture window, and intent parsing.
- `stt_runtime/` - optional Python runtime for faster-whisper speech recognition.
- `tts/` - provider-based text-to-speech service for Silero and Piper.
- `actions/` - intent execution helpers such as app launch and process actions.
- `tools/` - local tools, app resolver/indexer, AI client, screen vision, and selection helpers.
- `scripts/` - setup and verification scripts.
- `data/` - checked-in defaults plus ignored local runtime state.
- `assets/` - small source assets such as tray icons.

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

`start.bat` runs `node scripts/ensureTts.js` before launching Electron.

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
- `data/tts-cache/`
- `models/`
- `voices/`
- logs and temporary audio files

Use environment variables for secrets such as `OPENROUTER_API_KEY`; never write
API keys into the repository.
