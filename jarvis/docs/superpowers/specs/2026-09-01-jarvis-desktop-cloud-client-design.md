# Jarvis Desktop Cloud Client Design

Status: approved for implementation on 2026-09-01.

## Purpose

Turn the existing local Windows Jarvis into a family-ready Desktop client.
The cloud control plane is the source of truth for identity, conversations,
memory, model routing, documents, and speech recognition. The installed
Windows application remains the local interface and device execution edge.

The first release must let an allowed Telegram user install one Windows
application, pair it with a one-time code, chat with the same cloud Jarvis,
and use a hands-free voice flow initiated with the Russian wake word
"Джарвис".

## Scope

Included in the first Desktop cloud release:

- signed-installable Windows application target, with no required Node.js,
  Python, CUDA, Faster Whisper, or Large Whisper model on family devices;
- device pairing from Telegram with a one-time, expiring code;
- per-device, outbound authenticated connection and online/offline/revoked
  state;
- Desktop text chat backed by the existing cloud conversation and assistant
  services;
- local wake-word detection, voice activity detection, and microphone status;
- one completed voice utterance sent to a server ASR abstraction;
- text transcript and Jarvis answer displayed in the Desktop chat;
- local text-to-speech for answers to voice-originated requests, with a user
  preference for typed requests;
- client request idempotency and user/device isolation.

Not included:

- committing an ASR model choice before the DE-4 benchmark;
- an offline local ASR fallback;
- document ingestion, durable-memory implementation, PWA, camera, or
  arbitrary remote shell execution;
- remote changing actions. Existing local execution remains local until a
  separate confirmation-bound remote-action design is implemented.

## Architecture

```text
Desktop microphone
  -> local wake-word detector + VAD + short rolling buffer
  -> authenticated HTTPS voice request
  -> server ASR provider
  -> cloud conversation + AssistantService
  -> Desktop chat response + local TTS

Desktop text chat
  -> authenticated HTTPS message request
  -> cloud conversation + AssistantService
  -> Desktop chat response

Desktop device session
  -> outbound WSS hello/capabilities/heartbeats
  -> server device presence and future validated command delivery
```

The cloud server is the authoritative owner of a user. The Desktop token
identifies a device and is resolved to its user on the server; no request may
select an arbitrary `user_id`. Desktop and Telegram have separate conversations
but retrieve the same future durable memories, all scoped by that user.

The ASR contract is model-independent:

```js
transcribe({ audio, mimeType, languageHint, requestId })
// -> { text, language, confidence, durationMs }
```

The first deployment will benchmark Qwen3-ASR 1.7B Q4 against Faster Whisper
Medium INT8 on the real DE-4. The selected server provider is configuration;
the client and conversation flow do not change with that decision.

## Device Pairing and Authentication

1. The already allowlisted user requests a code through Telegram.
2. The server stores only a SHA-256 hash, expiry, desired device name, and
   owner id. Codes are single-use and expire after ten minutes.
3. Desktop submits that code over HTTPS together with bounded device metadata
   and its capabilities.
4. The server consumes the code atomically, creates a device row, returns a
   random device token once, and stores only the token hash.
5. Desktop persists the token through Windows Credential Manager/DPAPI rather
   than a renderer-accessible file, then opens an outbound WSS session.
6. The server authenticates every API request and WSS handshake from the token
   hash, verifies that the device is not revoked, and derives `user_id` from
   the device record.
7. Revocation invalidates the token and closes or rejects future sessions.

No secret, database password, Telegram token, model-provider key, or ASR model
is distributed inside the Desktop installer.

## Voice Privacy and UX

The application can start in the Windows tray and, only with explicit user
permission, keep a lightweight local wake-word listener active. The listener
maintains only a small in-memory ring buffer. Audio is neither saved nor sent
until the local detector hears "Джарвис" and VAD identifies a bounded spoken
utterance.

The UI exposes `offline`, `ready`, `слушаю`, `распознаю`, `отвечаю`, and
`ошибка` states. Voice-originated responses always appear as text and are
spoken through local TTS. Typed responses are spoken only when the user opts
in. Audio is removed after a completed, cancelled, or failed transcription;
the server must not retain raw audio after processing.

## Transport and Idempotency

HTTPS handles the initial pairing, text messages, and complete voice utterance
uploads. WSS is reserved for authenticated device presence, heartbeats, and
the future bounded remote-command channel. This keeps voice uploads resilient
to reconnects without placing long-lived audio streams on the command channel.

Every message has a UUID `clientMessageId`. The server records it in the
conversation message's external id domain, scoped to its conversation, so a
retry returns the original result rather than creating another user message or
model invocation. Audio requests additionally use a bounded server-side
idempotency record before expensive transcription.

## Server Components

- `devices/`: pairing code generation/claim, device repository, token hashing,
  authentication, and WSS presence;
- `desktop/`: validated HTTP routes for paired Desktop text and voice input;
- `assistant/`: shared orchestration that persists the user message, builds
  bounded history, calls `AssistantService`, and persists the answer;
- `asr/`: server-side model-independent transcription service. An unavailable
  provider produces an explicit safe error rather than a fabricated transcript;
- `conversations/`: preserves user and conversation scoping and idempotency.

All untrusted payloads are bounded and validated with Zod. SQL remains
parameterized. Tokens, pairing codes, raw audio, and provider errors are never
included in client responses or logs. Voice requests receive tighter rate and
size limits than text requests.

## Desktop Components

- `cloud/`: server URL resolution, secure device-token storage, authenticated
  HTTP/WSS client, reconnect policy, and request-id generation;
- `renderer/cloud-chat/`: a focused Desktop chat surface with connection and
  voice state. It renders messages through `textContent`, never injected HTML;
- `voice/cloudVoiceController`: local wake-word/VAD orchestration and one-shot
  cloud transcription request. It uses the existing voice capture and local
  TTS boundaries where possible;
- `main.js` and `preload.js`: only explicit IPC capabilities. Renderer code
  cannot read device credentials or execute arbitrary OS operations.

The existing local Faster Whisper/Vosk flow is kept as a development and
future fallback capability. It is not started for the cloud-first family path.

## Failure Handling

- Pairing code invalid, expired, consumed, or revoked: show a generic
  re-pairing message without revealing ownership details.
- Server disconnected: show `offline`, retry WSS with capped backoff, and let
  the user retry chat or voice deliberately.
- ASR unavailable or audio invalid: discard audio, preserve no transcript,
  show an honest error, and do not invoke the assistant.
- Assistant unavailable: preserve the user message exactly once, show failure,
  and do not claim a response or OS action occurred.
- TTS unavailable: retain the text answer and show non-blocking local speech
  failure.

## Verification

Automated tests must prove:

- one user cannot claim, use, revoke, send chat as, or read the status of
  another user's device;
- tokens and codes are hashed, absent from logs and API responses, and rejected
  after expiry or revocation;
- duplicate `clientMessageId` values invoke neither ASR nor the model twice;
- Desktop text and voice use only their device owner's conversation;
- invalid payloads, oversized audio, unsupported mime types, missing
  authentication, and rate limits fail safely;
- WSS hello/heartbeat authentication and presence transitions work;
- wake-word flow sends no audio before activation and clears temporary audio
  after every terminal state;
- renderer treats message text as plain text and cannot access credentials;
- existing Telegram, prompt, Tool Gateway, voice, and remote-protocol tests
  still pass when touched.

Manual acceptance on a clean Windows machine requires successful installation,
pairing through Telegram, cloud chat, a wake-word voice request with spoken
response, device revocation, and no local Large Whisper download.
