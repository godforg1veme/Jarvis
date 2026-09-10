# Telegram voice through private GigaAM ASR — design

**Date:** 2026-09-11
**Status:** implemented and enabled on DE-4

## Goal

Turn an allowlisted Telegram `voice` update into a normal Jarvis conversation
turn through the already-private GigaAM `v3_e2e_rnnt` worker on DE-4. The
feature must not make Telegram audio a knowledge-base attachment or create a
new public endpoint.

## Scope

- Process Telegram `message.voice` only. `audio`, `video`, `video_note`, and
  documents retain the existing private attachment-ingest path; music and
  uploaded recordings must not unexpectedly consume ASR capacity.
- Keep the existing access-policy, update-deduplication, owner-scoped user and
  conversation lookup before any Telegram file download.
- Bound a voice update to 5 MiB and 120 seconds. Apply an in-memory per-owner
  rate limit of three voice updates per minute before download.
- Download via the existing token-safe Bot API helper. Never log the download
  URL, raw bytes, transcript failure details, or a bot token.
- Send the temporary bytes to the private ASR provider and store only the
  resulting transcript as the user message (`contentType: voice_transcript`).
  Raw voice bytes must not enter document storage, memory, telemetry, or the
  conversation table.
- Route the transcript through the current command, orchestration, memory,
  retrieval, assistant, and confirmation policies, exactly as equivalent text
  would be handled.
- Enable the path only by explicit production configuration. Disabled remains
  backward-compatible attachment ingestion.

## Audio boundary

Telegram voice notes are OGG/Opus, unlike the paired Desktop WAV path. The
OpenAI-compatible client must declare a safe, matching file extension. The
private worker will accept the fixed supported media types, write only to its
existing temporary filesystem, transcode OGG/Opus to a mono 16 kHz WAV with a
fixed `ffmpeg` invocation, infer under its single model lock, and remove both
temporary files in `finally`. No user-controlled executable, path, or command
argument is introduced.

## Failure behavior

- Invalid, oversized, over-duration, throttled, unavailable, or undecodable
  voice updates return a generic retry-safe Telegram error without exposing
  internal routes, model details, tokens, or audio.
- A Telegram update remains claimed before ASR work, preserving the existing
  at-most-once update behavior and avoiding parallel duplicate inference.
- The GigaAM worker stays private on the Compose backend network with its
  existing 4 CPU, 8 GiB, read-only, capability-drop, PID, and tmpfs limits.

## Acceptance evidence

1. Unit tests cover voice normalization, allowed-owner routing, transcript
   persistence without raw bytes, attachment fallback while disabled, bounds,
   throttling, and OpenAI multipart OGG naming.
2. The full server suite, deploy preflight, Compose config, health checks, and
   public smoke check pass.
3. A synthetic non-sensitive OGG probe exercises the deployed server's
   Telegram-message service through the private worker. A real inbound user
   Telegram voice is a separate client acceptance check and is reported
   explicitly rather than implied.

## Deployment record

The full local server suite passed (173 tests). The focused Linux run of the
changed Telegram, ASR, and configuration tests passed in the VPS server image;
the worker Python source compiled and the rendered Compose configuration and
DE-4 preflight passed. The worker and server were rebuilt, both became healthy,
and the public deployment smoke check passed.

With `JARVIS_TELEGRAM_VOICE_ENABLED=true`, a non-sensitive public speech sample
was converted to OGG and passed through the deployed
`TelegramMessageService → OpenAI-compatible provider → private GigaAM` chain.
The probe returned non-empty text (not emitted to logs), persisted only
`voice_transcript`, and left no files in the worker temporary directory. The
worker remains unexposed on the private Compose network. No real incoming
Telegram update from an owner account was sent, so that client-level acceptance
is deliberately still unclaimed.
