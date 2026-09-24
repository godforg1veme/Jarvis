# Jarvis Voice Lab and Adaptive STT Calibration Implementation Plan

Status: implemented; automated settings, profile, controller, monitor, advisor,
quality-filter, and renderer contract checks pass on 2026-09-01. Live
microphone UX remains a manual verification boundary.

1. Extend `voice/sttSettings.js` with validated capture/advisor defaults,
   explicit safe bounds, profile persistence, and active-profile helpers while
   preserving the existing `data/stt-settings.json` and Faster Whisper profile
   behavior.
2. Add `voice/qualityMonitor.js` and `voice/localCalibrator.js` for bounded
   in-memory PCM/recognition metrics, anomaly detection, guided local samples,
   and conservative candidate VAD settings. Add focused unit tests without
   loading Electron, a microphone, or Whisper.
3. Instrument the Faster Whisper worker with throttled meter/segment metrics
   and expose the same observability through `VoiceService` without changing
   final recognition or intent contracts.
4. Add `tools/geminiVoiceAdvisor.js` using the official REST `generateContent`
   shape, `GEMINI_API_KEY`, structured JSON prompting, request cooldown and
   response validation. Metrics mode must never accept audio; deep mode must
   require an explicit request and a bounded temporary sample.
5. Add Voice Lab IPC and preload APIs for state, preview, calibration, test,
   save, revert, and advisor requests. Ensure every renderer value is
   validated in the main process and that preview failures roll back the
   known-good STT worker/capture state.
6. Add a separate `renderer/voice-lab/` window matching Jarvis visual language:
   quick mixer, live signal state, advanced controls, profile actions,
   calibration steps, Gemini privacy status, and accessible error/loading
   states. Opening the window must not create a second microphone stream.
7. Wire the main process to open and close Voice Lab, broadcast metrics and
   calibration state, and preserve existing shutdown/window behavior.
8. Run configuration, profile, monitor, advisor, IPC, audio-capture,
   VoiceService STT, and intent tests; perform a renderer contract check and a
   manual smoke test with Gemini disabled. Do not launch Jarvis or change
   Windows system state during automated verification.
