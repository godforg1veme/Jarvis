# AGENTS.md

## Project

Jarvis is a personal Windows desktop assistant built with Electron and Node.js.
It provides a Spotlight-like launcher, voice recognition through Vosk, app
launching, local tools, command history, and optional AI intent resolution.

## Runtime

- Target OS: Windows.
- Runtime: Electron + Node.js, CommonJS modules.
- UI lives in `renderer/`.
- Main Electron lifecycle, tray, shortcuts, and IPC live in `main.js`.
- Preload bridge lives in `preload.js`.
- Voice recognition lives in `voice/`.
- Text-to-speech lives in `tts/`.
- Local tools live in `tools/`.
- Intent execution lives in `actions/`.
- Local/generated state lives in `data/`.
- Local TTS voice/model files live in `voices/`.

## Commands

- Start app: `npm start`
- Prepare TTS models/dependencies: `node scripts/ensureTts.js`
- Test selected TTS provider: `node scripts/testTtsSpeak.js "<text>"`
- Test Piper fallback directly: `node scripts/testPiperSpeak.js "<text>"`
- Test Vosk model loading: `node scripts/testVoskLoad.js`
- Test voice intent parsing/execution manually: `node voice/testCommand.js "<command text>"`

## Safety

- Do not run commands that can modify the user's system unless the task requires it.
- Be careful with app launch, PowerShell, and runProgram behavior because this project controls the local PC.
- Do not edit secrets or add API keys to the repo. Use environment variables such as `OPENROUTER_API_KEY`.
- Ask before adding new production dependencies.
- Do not edit `node_modules/`, `models/`, `voices/`, `build/`, or large generated files unless explicitly requested.
- Treat `data/app-index.json`, `data/history.json`, `data/ai-cache.json`, `data/tts-cache/`, and logs as generated/local state.
- `start.bat` runs `node scripts/ensureTts.js` before Electron so Silero/Piper dependencies and model files are prepared automatically.

## Code Style

- Keep CommonJS unless the project is intentionally migrated.
- Prefer small focused modules over growing `main.js` or `renderer/renderer.js`.
- Keep IPC contracts explicit between main, preload, renderer, and voice windows.
- Keep TTS behind the provider interface in `tts/ttsService.js`; voice command handling should call `speak(text)` and avoid depending on Silero/Piper details.
- Preserve UTF-8 Russian text. If mojibake is present, fix it deliberately with nearby context.
- Avoid broad refactors while fixing narrow behavior.

## Verification

- For voice changes, run a Vosk load test and at least one intent parser test.
- For TTS changes, run `node scripts/ensureTts.js`, `node scripts/testTtsProvider.js`, `node scripts/testSileroService.js`, and `node scripts/testTtsSpeak.js "<text>"` when audio verification is needed.
- For launcher/app resolver changes, test against known aliases in `data/app-aliases.json`.
- For UI changes, verify the renderer visually when possible.
- For AI intent changes, test both missing-key and configured-key behavior.
