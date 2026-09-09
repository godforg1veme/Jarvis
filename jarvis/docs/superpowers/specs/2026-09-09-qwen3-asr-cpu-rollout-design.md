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

## Faster Whisper comparison protocol

The next isolated check uses `faster-whisper==1.2.1` with
`Systran/faster-whisper-medium`, `device=cpu`, `compute_type=int8`, and four
OpenMP threads. The process is separate from Docker Compose, has no network
listener, and does not change the Jarvis ASR configuration. It measures model
load time and warm transcription latency with the same short public audio
probe used for Qwen. This is a CPU-latency comparison only: Russian command
accuracy requires a separate, owner-approved corpus of real recordings before
any provider can be enabled.

### Result

On 2026-09-10 the target DE-4 ran `faster-whisper==1.2.1` Medium INT8 with four
CPU threads against the same 15.051-second public English probe. Initial load,
including the first model download, took 27.410 seconds. With the model warm,
beam size 1 took 8.468 and 8.115 seconds; beam size 5 took 9.393 seconds. Peak
resident memory was 1,960 MiB. The worker removed itself after the benchmark;
only the private 1.53-GB model cache remains for repeatability.

This is approximately four times faster than the Qwen 0.6B result and faster
than real time (about 0.54 real-time factor in the fast profile), but it misses
the absolute 3/6-second target for this 15-second utterance. Do not enable it
yet: measure 1-to-3-second Russian commands, Russian names, and latency while
the control plane is under normal load before selecting the provider.

## Russian CPU comparison follow-up

The owner approved three further isolated benchmarks. Each is limited to four
CPU cores, has no listener or Jarvis configuration change, and uses the same
public Russian GigaAM example audio (not family audio):

1. GigaAM v3 CTC, exported to the official FP32 ONNX path and run through the
   CPU execution provider. The GigaAM source is pinned to commit
   `7447938d791c4f3e643386ee22c33777004293a5`.
2. OpenAI Whisper large-v3-turbo with `faster-whisper==1.2.1`, CPU INT8, four
   threads, and beam size 1 and 5.
3. Whisper Medium using `whisper.cpp` at commit
   `c44b60b8053bbf2a5c1e014f11323fb3f2485177`, compiled with OpenBLAS and
   its official GGML Q8_0 checkpoint.

The benchmark records warm transcription latency, resident memory when
available, and the public test transcription. It is not an accuracy acceptance
test: only a later corpus of owner-approved Russian command recordings can
choose the production provider.

### Results

On 2026-09-10, all candidates ran serially on the same public 11.290-second
Russian GigaAM demonstration recording, with four CPU cores pinned on the
target DE-4. The reported fast value is the second warm run where applicable.

| Candidate | Fast / greedy | Beam 5 | Observation |
| --- | ---: | ---: | --- |
| GigaAM v3 CTC, official ONNX CPU path | 1.277 s | n/a | Correct-looking Russian transcript; 0.11 real-time factor |
| Faster Whisper Medium INT8 | 9.569 s | 11.797 s | 1,597 MiB peak process RSS |
| Faster Whisper large-v3-turbo INT8 | 10.908 s | 11.089 s | 1,665 MiB peak process RSS |
| Whisper.cpp Medium Q8_0 with OpenBLAS | 11.290 s | 16.842 s | CLI process restart/load is included in wall time |

GigaAM's 4.12-GiB peak during this job is not a production-memory estimate: the
one-off process held both the PyTorch checkpoint needed to export ONNX and the
ONNX session. An ONNX-only worker must be measured separately. Its dramatic
latency win makes it the leading candidate, but the public vendor demonstration
audio is not an independent quality corpus. Keep every provider disabled until
the same runs are repeated with short owner-approved Russian commands, names,
noise, and normal control-plane load.
