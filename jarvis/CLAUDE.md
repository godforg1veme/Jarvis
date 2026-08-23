# CLAUDE.md

## Project

Jarvis is a personal Windows desktop assistant built with Electron and Node.js.
It provides a Spotlight-like launcher, local voice recognition, app
launching, local tools, command history, and optional AI intent resolution.

## Runtime

- Target OS: Windows.
- Runtime: Electron + Node.js, CommonJS modules.
- UI lives in `renderer/`.
- Main Electron lifecycle, tray, shortcuts, and IPC live in `main.js`.
- Preload bridge lives in `preload.js`.
- Voice recognition lives in `voice/`.
- Optional faster-whisper runtime lives in `stt_runtime/`.
- Text-to-speech lives in `tts/`.
- Local tools live in `tools/`.
- Simple single-step AI fallback lives in `tools/intentRouter.js` and
  `tools/aiIntentResolver.js`; it uses OpenRouter only after deterministic
  parsing fails.
- Intent execution lives in `actions/`.
- Desktop Agent orchestration and its safe tool gateway live in `agents/`.
- The Python LangGraph/Gemini runtime in `agent_runtime/` is the only stateful
  AI planning layer; Node Tool Gateway remains the execution authority.
- Local/generated state lives in `data/`.
- Local TTS voice/model files live in `voices/`.

## Commands

- Start app: `npm start`
- Prepare TTS models/dependencies: `node scripts/ensureTts.js`
- Test selected TTS provider: `node scripts/testTtsSpeak.js "<text>"`
- Test Piper fallback directly: `node scripts/testPiperSpeak.js "<text>"`
- Test Vosk model loading: `node scripts/testVoskLoad.js`
- Prepare faster-whisper STT dependencies: `node scripts/ensureStt.js`
- Test STT settings/provider wiring: `node scripts/testSttSettings.js` and `node scripts/testVoiceServiceSttProvider.js`
- Test voice intent parsing/execution manually: `node voice/testCommand.js "<command text>"`

## Safety

- Do not run commands that can modify the user's system unless the task requires it.
- Be careful with app launch, PowerShell, and runProgram behavior because this project controls the local PC.
- Do not edit secrets or add API keys to the repo. Use environment variables such as `OPENROUTER_API_KEY`.
- Ask before adding new production dependencies.
- Do not edit `node_modules/`, `models/`, `voices/`, `build/`, or large generated files unless explicitly requested.
- Treat `data/app-index.json`, `data/history.json`, `data/ai-cache.json`, `data/ui-state.local.json`, `data/tts-cache/`, and logs as generated/local state.
- `start.bat` runs `node scripts/ensureTts.js` and `node scripts/ensureStt.js` before Electron so the selected local speech runtimes are prepared automatically.

## Code Style

- Keep CommonJS unless the project is intentionally migrated.
- Prefer small focused modules over growing `main.js` or `renderer/renderer.js`.
- Keep IPC contracts explicit between main, preload, renderer, and voice windows.
- Keep TTS behind the provider interface in `tts/ttsService.js`; voice command handling should call `speak(text)` and avoid depending on Silero/Piper details.
- Preserve UTF-8 Russian text. If mojibake is present, fix it deliberately with nearby context.
- Avoid broad refactors while fixing narrow behavior.

## Verification

- For voice changes, run the relevant STT provider test, `node scripts/testVoiceServiceSttProvider.js`, and at least one intent parser test.
- For TTS changes, run `node scripts/ensureTts.js`, `node scripts/testTtsProvider.js`, `node scripts/testSileroService.js`, and `node scripts/testTtsSpeak.js "<text>"` when audio verification is needed.
- For launcher/app resolver changes, test against known aliases in `data/app-aliases.json`.
- For UI changes, verify the renderer visually when possible.
- For AI intent changes, test both missing-key and configured-key behavior.
