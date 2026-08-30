# Jarvis STT Audio Transport Optimization Design

## Goal

Reduce CPU work, temporary allocations, and memory growth in Jarvis voice
capture without changing recognition quality by default. Quality-affecting STT
settings remain selectable through an explicit performance profile.

This work must not modify Windows autostart, `main.js`, the registry, or running
Electron processes. Jarvis and its Whisper model must not be started during
verification.

## Scope

The implementation covers five related changes:

1. Replace `ScriptProcessorNode` with `AudioWorklet` as the primary microphone
   processing path, retaining ScriptProcessor as a compatibility fallback.
2. Send PCM to STT workers as binary frames instead of Base64 embedded in JSON.
3. Remove unused `audioBase64` data from Faster Whisper and Vosk results.
4. Stop Vosk from accumulating full utterance audio solely for that unused
   result field.
5. Add explicit `quality`, `efficient`, and `custom` Faster Whisper performance
   profiles. The default remains `quality`.

## Non-goals

- Changing Electron autostart behavior or login registry entries.
- Starting, stopping, or inspecting the existing Electron process tree.
- Launching Jarvis, acquiring the microphone, or loading Whisper during tests.
- Changing TTS lifecycle or provider behavior.
- Changing voice intent, app recovery, or desktop-agent behavior.
- Introducing a new production dependency.

## Selected Approach

Use a versioned length-prefixed binary protocol over each STT worker's existing
standard input. Standard output remains newline-delimited JSON.

This approach avoids Base64 and JSON parsing for continuous PCM while keeping a
single ordered input stream. It is preferred over an additional Windows pipe,
which would require concurrent reads and lifecycle synchronization in Python,
and over an Electron utility-process redesign, which would be disproportionate
for a raw stream of approximately 32 KB/s.

## Binary Frame Protocol

Every input frame has a fixed header followed by a payload:

| Field | Size | Value |
| --- | ---: | --- |
| Magic | 4 bytes | ASCII `JSTT` |
| Version | 1 byte | `1` |
| Type | 1 byte | `1` for PCM, `2` for control JSON |
| Payload length | 4 bytes | Unsigned little-endian integer |
| Payload | variable | PCM16 bytes or UTF-8 JSON |

PCM payload requirements:

- mono;
- 16 kHz;
- signed 16-bit little-endian samples;
- non-empty and even byte length;
- no individual payload larger than 1 MiB.

Control payloads are UTF-8 JSON objects. Initially the only required command is
`{"type":"stop"}`. Unsupported frame types, invalid magic or version, truncated
frames, malformed control JSON, and oversized payloads produce an actionable
worker error. A corrupted stream is not silently resynchronized because the
parent and worker are a trusted, version-matched pair.

A focused CommonJS module owns Node-side constants, encoding, and incremental
decoding. The Python worker implements the same small protocol locally without
adding a dependency.

## Audio Capture

The primary path uses a dedicated `AudioWorkletProcessor`:

1. Read mono input on the browser audio-render thread.
2. Downsample from the actual AudioContext rate to 16 kHz with a stateful
   averaging resampler suitable for speech.
3. Convert samples to PCM16.
4. Batch roughly 100-150 ms of audio per transferable `ArrayBuffer`.
5. Post the buffer to the capture renderer, which forwards it through the
   existing preload API as binary Electron IPC.

The worklet does not perform Electron IPC, logging per block, network access, or
other blocking work. It transfers ownership of completed buffers to avoid an
extra worklet-to-renderer copy.

If loading or constructing the AudioWorklet fails, the current
ScriptProcessor-based implementation is used as a fallback. Capture status logs
identify which backend is active. Stop closes the stream, nodes, AudioContext,
and retry timer regardless of backend.

## VoiceService Input Writer

`VoiceService` converts incoming Buffer, ArrayBuffer, or typed-array data into a
validated Buffer and writes an encoded PCM frame to the active worker.

The writer observes Node stream backpressure. Once `stdin.write` returns false,
it drops later real-time PCM blocks until `drain` rather than allowing an
unbounded queue while Whisper is transcribing. It records the number of dropped
blocks and logs a single summary after recovery. Small control frames remain
writable so shutdown cannot be blocked by PCM backpressure.

Writer state and listeners are reset whenever a worker exits, is stopped, or is
replaced. Existing legacy `voice:pcm` IPC continues to feed the same binary
writer, so the change does not require a simultaneous renderer migration.

## Worker Behavior

### Faster Whisper

The worker reads complete framed messages from `sys.stdin.buffer`. PCM frames go
directly to the existing RMS segmentation logic. Control frames dispatch the
stop command.

Final recognition events contain only the recognized text. The worker no longer
imports Base64 utilities or encodes the utterance audio in its response.

### Vosk

The worker incrementally decodes framed input from Node's stdin data events.
PCM is passed directly to `VoskStreamRecognizer`. Final recognition events no
longer include audio data.

Because no supported consumer needs full utterance audio, the recognizer stops
growing an `audioPcm` Buffer through repeated concatenation and removes the
unused Base64 accessor.

## Performance Profiles

`fasterWhisper.performanceProfile` accepts:

| Profile | Beam size | Faster Whisper VAD | Purpose |
| --- | ---: | --- | --- |
| `quality` | 5 | enabled | Current behavior; default |
| `efficient` | 1 | disabled | Lower decoding and duplicate-VAD work |
| `custom` | configured `beamSize` | configured `vadFilter` | Explicit tuning |

Unknown profile names fail settings validation with a clear message rather than
silently selecting a different quality level. Existing configurations without
the field resolve to `quality`, preserving behavior.

The local checked-in STT settings explicitly select `quality`. Switching to
`efficient` is a one-field change and does not require code edits.

## Error Handling and Compatibility

- AudioWorklet initialization failure activates the tested compatibility path.
- Malformed PCM is rejected before worker input.
- Worker protocol violations surface through the existing worker error channel.
- Worker crashes continue to follow the current restart policy.
- Standard-output JSON and VoiceService recognition events remain unchanged
  except for removal of the unused `audioBase64` property.
- Existing app-recovery changes in `voiceService.js` must be preserved.
- `main.js` is outside the patch to avoid conflict with the concurrent autostart
  work.

## Verification

Automated tests cover:

1. Encoding and decoding one frame.
2. A frame split across arbitrary input chunks.
3. Multiple frames in one chunk.
4. Invalid magic, version, type, size, and truncated input.
5. VoiceService writing binary PCM and a framed stop command.
6. Backpressure dropping PCM and recovering on `drain`.
7. Faster Whisper and Vosk source contracts containing no PCM Base64 transport
   or final `audioBase64` result.
8. Selection of `quality`, `efficient`, and `custom` profiles.
9. AudioWorklet as the primary path and ScriptProcessor as fallback.
10. Existing STT provider, VoiceService, audio-capture, and intent tests.

No verification command may launch Electron, request microphone access, load a
Whisper model, modify the registry, or terminate a process.

## Success Criteria

- Continuous PCM reaches both STT providers without Base64 or JSON encoding.
- Recognition-result audio is no longer accumulated or returned.
- Default recognition settings remain beam size 5 with Faster Whisper VAD.
- Efficient mode is available through one configuration field.
- AudioWorklet is used when supported and capture has a safe fallback.
- Worker input cannot grow without bound under backpressure.
- All relevant non-runtime tests pass without starting Jarvis.
- Concurrent autostart changes remain untouched.
