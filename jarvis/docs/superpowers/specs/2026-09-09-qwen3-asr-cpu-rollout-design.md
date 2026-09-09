# Qwen3-ASR CPU rollout design

Status: implemented as a disabled benchmark profile on 2026-09-10; not
accepted as the production ASR provider.

## Decision

Deploy Qwen/Qwen3-ASR-1.7B as a private, CPU-only ASR worker on the existing
DE-4 VPS. The public Jarvis server remains the only network-facing speech API.
The worker implements the narrow OpenAI-compatible `POST /v1/audio/transcriptions`
contract already consumed by the server.

The official CUDA/vLLM path is out of scope because the DE-4 has no NVIDIA GPU.
The first rollout uses the official `qwen-asr` Transformers backend, pinned to
version 0.0.6 and the Qwen model revision
`7278e1e70fe206f11671096ffdd38061171dd6e5`. It is deliberately single-flight;
streaming and timestamps are not enabled.

## Boundaries

- `qwen-asr` is a separate Docker service with no published host ports, Docker
  socket, privileged mode, or secret mounts.
- Model files live in a named volume and the request audio is held only in a
  request-scoped temporary directory which is removed before the response ends.
- The Fastify server may reach only the exact private Compose DNS name
  `qwen-asr` over HTTP. All other production ASR endpoints continue to require
  HTTPS. This preserves the current no-public-worker policy without creating a
  general insecure-URL exception.
- The server sends bounded Desktop utterances and does not add a raw-audio log,
  durable queue, or public ASR route.

## Resources and acceptance

Start with one worker process, four CPU cores and an 8 GiB memory cap. Keep the
existing PostgreSQL and Jarvis server caps unchanged. Deploy only after the
worker's model load and health check succeed, then benchmark Russian commands
on the real VPS under a single request and two queued requests.

The rollout is accepted only if a 3--7 second command has median post-utterance
latency at most 3 seconds, p95 at most 6 seconds, total VPS memory remains
below 85 percent, and names/application aliases are accurate enough for the
existing command corpus. On failure, disable the worker and compare
Qwen3-ASR-0.6B and Faster Whisper Medium INT8 rather than leaving an unstable
provider enabled.

## Benchmark result

The private worker was built and run on the target DE-4 (six CPU cores, 15 GiB
RAM). Qwen3-ASR-1.7B exceeded 30 seconds on a short official speech probe.
Qwen3-ASR-0.6B produced a correct transcript but took 34.535 seconds on the
same probe. Both violate the 3/6-second latency target by a wide margin.

The profile is stopped and `JARVIS_ASR_PROVIDER` remains `disabled`. The model
cache is retained in its private named volume to permit a reproducible later
comparison. Do not enable either Qwen checkpoint for normal Desktop voice
traffic on this CPU-only VPS; measure Faster Whisper Medium INT8 next if a
server-side ASR provider is still required.
