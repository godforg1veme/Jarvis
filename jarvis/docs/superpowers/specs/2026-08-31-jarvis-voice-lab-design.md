# Jarvis Voice Lab and Adaptive STT Calibration Design

Status: implemented; automated settings, profile, controller, monitor, advisor,
quality-filter, and renderer contract checks pass on 2026-09-01. Live
microphone UX remains a manual verification boundary.

## Goal

Add a dedicated Voice Lab where the user can inspect the live microphone
signal, manually tune all supported speech-capture and Faster Whisper settings,
run a guided calibration, and save named profiles. Jarvis should remain
local-first: local metrics and simple adaptive adjustments run without a
network request, while Gemini acts as an optional advisor when the local
monitor detects a problem or the user explicitly starts a deep analysis.

The user must be able to temporarily test a proposed profile, compare it with
the current profile, save it, or roll it back without restarting the Electron
application.

## Scope

The implementation covers:

1. A separate Voice Lab window opened from the main Jarvis UI.
2. A quick mixer with a live level/noise meter and the most important VAD
   controls.
3. An advanced mixer for every currently supported capture and STT setting.
4. Guided local calibration using quiet-room and spoken-command samples.
5. In-memory quality metrics and anomaly detection during normal use.
6. Temporary profile preview, test, save, revert, and named profile storage.
7. Optional Gemini advisory mode using metrics only for automatic analysis and
   explicitly selected short audio samples for deep analysis.
8. Validation, bounds checking, rate limiting, and graceful fallback when
   Gemini is unavailable.

## Non-goals

- Training or fine-tuning a speech-recognition model.
- Sending microphone audio continuously to Gemini.
- Letting Gemini execute desktop commands, write arbitrary files, or control
  the microphone directly.
- Replacing the existing VoiceService, intent routing, or STT binary transport.
- Adding third-party DSP or VAD dependencies in the first implementation.
  High-pass, low-pass, RNNoise, and Silero/WebRTC VAD remain future extensions
  behind the same settings boundary.
- Storing a permanent archive of microphone recordings.

## Selected Approach

Use a local-first Voice Lab with a two-level control surface:

- The quick screen is the normal entry point. It exposes a profile selector,
  live signal state, one-click calibration, a Gemini status indicator, and the
  five controls most likely to need adjustment.
- The advanced screen exposes the complete validated settings object in
  logical groups. Each numeric field has a slider, an exact numeric input, a
  reset action, and a short explanation.
- Calibration creates a candidate profile in memory. It never overwrites the
  persisted profile before a test succeeds or the user explicitly saves it.

This combines the low-friction behavior of a mixer with the guided workflow of
a wizard without creating two competing configuration systems.

## User Experience

### Quick screen

The window contains:

- active profile selector;
- selected microphone selector;
- live speech level, noise floor, and signal-quality state;
- buttons for `Автокалибровка`, `Тестировать`, `Сохранить`, and `Отменить`;
- compact controls for `startRms`, `continueRms`, `silenceMs`, `preRollMs`, and
  `minSpeechMs`;
- a collapsible explanation of the current recommendation;
- a visible privacy/API state: local only, Gemini metrics, or deep analysis.

The meter must distinguish at least `тишина`, `шум`, `речь`, and `перегрузка`.
It should show the current measured noise floor and speech RMS rather than only
the configured thresholds.

### Advanced screen

Settings are grouped as follows:

1. **Microphone and capture**: device ID, channel count, echo cancellation,
   browser noise suppression, and automatic gain control.
2. **Segmentation/VAD**: minimum speech duration, end-of-speech silence,
   maximum segment duration, start threshold, continuation threshold, and
   pre-roll.
3. **Whisper**: model, device, compute type, language, performance profile,
   beam size, Faster Whisper VAD, initial prompt, and hotwords.
4. **Gemini advisor**: off, problems-only, or manual/deep; minimum sample
   count; cooldown; and whether explicit audio upload is permitted.

API keys are never displayed or persisted by the Voice Lab. The advisor reads
`GEMINI_API_KEY` from the process environment; if it is absent, Gemini is
disabled and local features remain available.

Settings that require a worker or capture restart are labelled as such. The UI
can perform that restart through VoiceService after preserving the previous
known-good profile.

## Configuration and Profiles

`data/stt-settings.json` remains the active persisted configuration for
backwards compatibility. A new local profile store keeps named alternatives,
for example `data/stt-profiles.json`. The profile store is local/generated
state and must not contain API keys or raw audio.

Each profile contains:

```json
{
  "id": "my-microphone",
  "name": "Мой микрофон",
  "deviceId": "",
  "settings": {
    "provider": "faster-whisper",
    "fasterWhisper": {
      "performanceProfile": "quality",
      "minSpeechMs": 600,
      "silenceMs": 900,
      "startRms": 0.022,
      "continueRms": 0.012,
      "preRollMs": 300
    }
  },
  "source": "manual",
  "createdAt": "2026-08-31T00:00:00.000Z"
}
```

The abbreviated settings object is merged with the normal defaults. `source`
is one of `manual`, `local-calibration`, or `gemini`.

The settings loader continues to apply defaults and validate profiles. The
Voice Lab must reject non-finite values, unknown enum values, invalid paths,
oversized prompts, and out-of-range thresholds before a preview or save.

The implementation must define explicit safe bounds for every exposed value.
Candidate values returned by Gemini are clamped or rejected locally; Gemini
cannot introduce new setting names.

## Data Flow

```text
AudioWorklet/compatibility capture
  -> VoiceService binary PCM transport
  -> local metrics collector and existing STT worker
  -> recognition/status events
  -> quality monitor and anomaly detector
  -> optional Gemini advisor
  -> validated candidate profile
  -> temporary worker/capture restart
  -> local test
  -> save or rollback
```

The metrics collector operates on PCM chunks and recognition events already
inside Jarvis. It keeps rolling aggregates in memory only. It must not log raw
PCM or write recordings during normal operation.

The metrics include noise RMS, speech RMS, estimated signal-to-noise ratio,
segment duration, speech/silence timing, empty-result count, worker errors,
input backpressure drops, and user-marked test success/failure. They are
aggregated over a bounded window rather than sent one request per command.

## Local Calibration

The guided calibration asks the user to:

1. remain silent for a short baseline sample;
2. speak several normal Jarvis commands;
3. optionally repeat them with the usual background noise.

The local calibrator calculates a noise floor and proposes conservative values
for the existing RMS and timing controls. The proposal is shown with the
reason for each change. It is applied to a temporary candidate only.

The local test accepts a small set of successful commands or an explicit user
approval. If the worker fails, the test times out, or the user cancels, the
previous settings are restored.

## Gemini Advisor

Gemini is an advisor behind a narrow structured interface.

### Automatic metrics mode

Normal use never sends audio. The quality monitor evaluates local metrics and
only requests Gemini when an anomaly threshold is reached, such as repeated
missed starts, false triggers, unusually short segments, or rising empty
results. A cooldown and an input-window minimum prevent frequent requests.
If the metrics are healthy, no API request is made.

The request contains a bounded JSON summary and the current validated values.
The response must be a small JSON object containing only allowed setting
changes, confidence, and a human-readable explanation. Malformed, unsafe, or
low-confidence responses are ignored.

### Deep manual mode

The user explicitly starts `Глубокая калибровка` and records the requested
samples. Raw audio is kept only for the duration of the analysis and is sent
only when the user has enabled audio analysis. After the request completes, the
temporary samples are released. Gemini may return a candidate profile, but the
same local validation, temporary test, and save/rollback flow applies.

If the API key is absent, the network fails, quota is exhausted, or Gemini
returns invalid data, Voice Lab stays fully usable with local calibration and
manual controls. The UI reports the degraded mode without blocking voice use.

## IPC and Module Boundaries

Keep the following responsibilities separate:

- `VoiceService`: owns active settings, worker lifecycle, preview/restart,
  capture restart, and recognition events.
- `voice/sttSettings.js`: defaults, profile validation, safe bounds, and
  persistence helpers.
- `voice/qualityMonitor.js`: bounded local metrics, rolling aggregates, and
  anomaly detection; no Gemini calls.
- `voice/localCalibrator.js`: guided sample state and local candidate values.
- `tools/geminiVoiceAdvisor.js`: Gemini transport, structured request/response
  validation, cooldown, and error mapping; no direct system actions.
- `voice/voiceLabIpc.js`: explicit IPC commands for get settings, preview,
  test, save, revert, calibration state, and advisor state.
- `renderer/voice-lab/`: the separate UI, with no Node or filesystem access.

Preload exposes only the Voice Lab API needed by the renderer. The renderer
never reads `data/stt-settings.json` directly.

Suggested IPC operations:

- `voice-lab:get-state`
- `voice-lab:set-preview`
- `voice-lab:start-calibration`
- `voice-lab:submit-calibration-step`
- `voice-lab:test-preview`
- `voice-lab:save-profile`
- `voice-lab:revert-preview`
- `voice-lab:request-gemini-analysis`

All operations return `{ ok, state, error? }`-shaped results and preserve the
existing voice IPC contracts.

## Error Handling and Safety

- Missing Gemini configuration never disables local STT.
- Preview changes are isolated from persisted settings.
- Worker and capture restarts have a rollback path to the last known-good
  profile.
- A second preview or calibration cancels the previous candidate cleanly.
- Gemini requests are rate-limited and deduplicated by a hash of the metrics
  window and active profile.
- Raw audio is never written to logs, profile files, or telemetry.
- API errors show a short actionable status; detailed provider errors stay in
  local diagnostics without secrets.
- The Voice Lab cannot run arbitrary code from a Gemini response.

## Verification

Automated tests cover:

1. Profile defaults, merge behavior, safe bounds, and invalid-value rejection.
2. Persistence and round trips for named profiles without secrets or audio.
3. Metrics aggregation, bounded memory, anomaly thresholds, and deduplication.
4. Local calibration proposals for quiet, noisy, and low-volume samples.
5. Preview, test, save, revert, and worker-restart rollback behavior.
6. Gemini disabled, missing-key, timeout, malformed-response, and valid-response
   behavior with mocked transport.
7. Audio upload being impossible in automatic metrics mode and requiring an
   explicit deep-analysis action.
8. IPC and preload contracts, including renderer error states.
9. Existing STT provider, audio capture, binary transport, VoiceService, and
   intent parser tests.

Manual verification must confirm that the Voice Lab can be opened without
starting a second microphone stream, that a temporary profile can be tested
and reverted, and that the normal Jarvis voice path continues to work when
Gemini is disabled or unavailable.

## Success Criteria

- The user can adjust every currently supported capture and STT parameter from
  one Voice Lab without editing JSON manually.
- A guided calibration produces a temporary profile from the user's actual
  noise and speech samples.
- Normal operation performs local monitoring without an API call per command.
- Gemini is called only after a local anomaly or explicit deep-analysis action,
  with clear privacy state and rate limits.
- Every Gemini recommendation is validated, previewed, tested, and reversible.
- Local STT remains functional without an API key or network access.
- Profiles survive app restarts and contain no raw audio or secrets.
