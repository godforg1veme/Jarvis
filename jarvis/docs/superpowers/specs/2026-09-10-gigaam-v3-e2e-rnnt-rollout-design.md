# GigaAM v3 E2E RNNT private ASR rollout

## Status

Approved by the owner on 2026-09-10. This supersedes the disabled Qwen3-ASR
benchmark profile only for the configured Desktop voice provider; the Qwen
profile and model cache remain available for comparison and are not deleted.

## Goal and scope

Run `salute-developers/GigaAM` `v3_e2e_rnnt` as the Jarvis server's Russian
Desktop ASR provider on the DE-4 VPS. The public Jarvis server remains the only
network-facing API. The worker exposes just the OpenAI-compatible
`POST /v1/audio/transcriptions` contract on the private Compose network.

The source must be pinned to GigaAM commit
`7447938d791c4f3e643386ee22c33777004293a5`, the revision used in the VPS
benchmark. The worker uses GigaAM's official CPU ONNX Runtime implementation,
not a reimplementation of its decoder.

## Considered approaches

1. Replace the existing `qwen-asr` service. This would make rollback and
   comparative troubleshooting ambiguous, so it is rejected.
2. Start the benchmark container for every request. It has no service contract,
   repeatedly loads models, and cannot provide bounded request handling, so it
   is rejected.
3. Add a separate private `gigaam-asr` Compose service and allowlist precisely
   its internal URL. This preserves the security boundary and supports a
   configuration-only rollback. It is selected.

## Architecture and request flow

`Desktop -> public Jarvis server -> http://gigaam-asr:8000/v1 -> GigaAM ONNX
Runtime CPU -> Jarvis server -> Desktop`.

The worker has no host `ports`, public route, Docker socket, privileged mode,
secret mount, or shell/action capability. It runs as an unprivileged user with
read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`,
a 64-MiB request-temp `tmpfs`, four CPU cores, and an 8-GiB memory cap. Its
model checkpoints and exported ONNX files are held only in a private named
volume. One async lock serializes transcription; excess concurrent requests
remain bounded by the existing Jarvis HTTP limits and timeout.

At cold cache initialization the worker downloads the pinned checkpoint and
exports the three RNNT ONNX files once. It then creates CPU ONNX sessions and
discards the bootstrap PyTorch model before reporting ready. On later starts it
uses the cached ONNX files directly. A temporary startup peak is expected; the
4.12--4.16-GiB earlier benchmark figure is not treated as the steady-state
service footprint.

The multipart endpoint accepts up to 5 MiB of request audio, uses a
request-scoped temporary WAV file, removes it in `finally`, never logs audio or
transcript content, returns only validated non-empty text, and maps internal
failures to HTTP 503. `/health/ready` returns success only after the ONNX
sessions are loaded.

## Configuration and rollback

The server configuration validation will continue to require HTTPS for all
production ASR endpoints except exact private Compose endpoints. It will accept
only `http://qwen-asr:8000/v1` or `http://gigaam-asr:8000/v1`, with no userinfo,
query, fragment, alternate path, or alternate port.

The deployed private configuration is:

```text
JARVIS_ASR_PROVIDER=openai-compatible
ASR_BASE_URL=http://gigaam-asr:8000/v1
ASR_MODEL=GigaAM/v3_e2e_rnnt
JARVIS_ASR_TIMEOUT_MS=60000
```

No ASR API key is needed because traffic never leaves the Compose network. To
roll back, set `JARVIS_ASR_PROVIDER=disabled`, recreate `server`, and stop the
`gigaam-asr` service. Do not delete its cache without an explicit owner request.

## Verification and acceptance

Before deployment: update focused configuration tests for the two exact private
worker URLs, run the server test suite, and validate Compose rendering and
deployment preflight. On the VPS: build only the `gigaam-asr` profile, wait for
its readiness endpoint from the backend network, send a non-sensitive public
WAV through the worker's multipart endpoint, then verify the public server
health and deployment smoke checks. Finally send an owner-approved paired
Desktop voice request and verify an end-to-end transcript without emitting raw
audio or sensitive content in logs.

The rollout is accepted only when the service remains private, reports ready,
handles the live contract, preserves server health, and stays within the
existing 60-second request timeout. Record steady-state memory and response
latency; if they violate capacity or reliability expectations, immediately
apply the configuration-only rollback.
