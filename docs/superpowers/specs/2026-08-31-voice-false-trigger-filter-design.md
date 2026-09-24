# Voice false-trigger filtering design

Status: implemented; the focused Faster Whisper quality-filter test passes on
2026-09-01.

## Goal

Prevent non-speech audio from being transcribed as a launch command, especially
for Dota, without changing the existing confirmation or application-launch
behaviour.

## Scope

- Remove application names (`дота`, `стим`) from the active Faster Whisper
  `initialPrompt` and `hotwords` in `data/stt-settings.json`.
- Evaluate Faster Whisper segment quality before returning a final transcript.
- Treat rejected transcripts as empty results in Voice Lab metrics.
- Add focused automated coverage for accepted and rejected segments.

## Non-goals

- Do not add a confirmation prompt before app or game launches.
- Do not change the voice command grammar, app aliases, or action execution.
- Do not save raw microphone audio or transcriptions to a new log.

## Design

`faster_whisper_worker.py` will inspect metadata already returned for every
Whisper segment: `no_speech_prob` and `avg_logprob`. A final transcript is
accepted only when it contains text and at least one segment satisfies both
quality thresholds. Otherwise the worker emits only segment metrics with
`resultEmpty: true`; it never sends a `final` message to Node.

The quality thresholds are persisted under `fasterWhisper` in the existing STT
settings, with validation and defaults in `voice/sttSettings.js`. Defaults will
be conservative: reject a segment when Whisper reports more likely non-speech
than speech, or when its average log probability is far below a normal command.
The exact values are covered by tests and remain editable through the existing
advanced settings storage path.

The active prompt and hotword list retain neutral voice-command guidance but do
not name games or application targets. This avoids biasing ambiguous audio
toward Dota while preserving Russian recognition and the Jarvis wake word.

## Data flow

Microphone PCM -> RMS/VAD segmentation -> Faster Whisper segments -> quality
filter -> final text -> existing intent router -> existing execution.

Rejected segments stop at the quality filter. Voice Lab receives metrics marking
the result as empty, so its existing false-trigger/empty-result counters reflect
the rejection without retaining audio.

## Failure handling

- Missing segment metadata is treated as a rejected segment rather than an
  unverified command.
- Invalid configured thresholds are rejected by the existing settings validator.
- A normal command whose segments pass the filter follows the current route and
  launch behaviour unchanged.

## Verification

- Settings test: defaults, bounds, and persistence for both thresholds.
- Worker-focused test: non-speech/high-probability or very-low-logprob segments
  produce no final text; a normal high-quality command is returned.
- Existing provider and voice intent parser tests still pass.
