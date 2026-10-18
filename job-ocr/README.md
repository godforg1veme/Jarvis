# Local HH captcha OCR

## Optional fine-tuned backend (installed on DE, 18 October 2026)

The owner's `hh-ru-captcha` model is integrated through its original pipeline:
curve rectification, two crops, greedy/beam CTC selection and insertion rescue.
The default ONNX build below remains available. The owner approved the optional
Paddle/OpenCV/RapidFuzz image, which is built and installed on DE through its
overlay. See [release and live limits](../docs/updates/2026-10-18-hh-trained-ocr-release.md)
and [local results](../docs/updates/2026-10-18-hh-trained-ocr-development.md).

`frozen-source.json` pins source revision, code, dictionary, config and both
checkpoints. Prepare the ignored bundle without copying datasets or environments:

```powershell
python job-ocr/prepare_frozen.py 'F:/OCR Learning'
```

Preparation verifies all pinned files before creating a new output directory;
an existing bundle is never overwritten. Two recorded portability changes guard
Windows DLL discovery and cap the rectifier's output width at 1024 before mesh
allocation. Normal frozen inference is preserved; all 1,509 prior predictions
matched. `bundle.json` hashes the resulting files. The image build receives its
digest as `FROZEN_BUNDLE_SHA256`; runtime verifies it before importing code or
loading either checkpoint. Model/source artifacts remain outside Git.

`Dockerfile.frozen` and `deploy/job-ocr-frozen.yml` retain the networkless UNIX
socket and read-only filesystem. The installed image uses CPU, one thread and a
1 GiB limit. An isolated Linux container matched the fixture through the actual
socket, rejected an invalid image and peaked at 416,694,272 bytes without OOM.
Socket/directory permissions are 0600/0700 under UID 1001. Docker/WSL remain absent
on the Windows PC; these checks ran on DE without a production profile. The first
live attempt stopped as unknown and sent the human photo, so actual HH acceptance
has not been established.

The trained backend accepts only the studied 250×90 PNG geometry, using the
existing byte/decompression limits and exactly `{answer: string}`. It supports
`/ocr/frozen`; legacy workers refuse that endpoint, so automatic mode cannot
silently use the old general model. The browser calls no external OCR provider.
Scores remain internal and are not treated as whole-string probabilities.
The optional state extension is understood by this browser version. Rolling
back to an older binary during an active recovery needs a reviewed conversion
that preserves all claims; resolving the recovery to idle removes the extension.

With `JARVIS_HH_CAPTCHA_AUTOMATIC=1` in both browser and server, Telegram mode is
required. Each recovery has at most two persisted OCR attempts on distinct
pictures, each with at most one native answer. Invalid OCR consumes a slot.
Unknown/interrupted dispatch stops automatic work early. A single `preparing`
outcome keeps the worker quiet between steps. Failure hands over a fresh photo
through the existing owner/private reply binding; refresh/restart cannot reset
the incident budget. Defaults remain zero.

Offline reproduction with the existing local environments:

```powershell
& 'F:/OCR Learning/.venv-training/Scripts/python.exe' job-ocr/evaluate_frozen.py 'F:/OCR Learning' --device gpu:0 --new-set data/hh-ocr-evaluation/new-geometry-20261018 --output data/hh-ocr-evaluation/new-run
& 'F:/OCR Learning/PaddleOCR/.venv/Scripts/python.exe' job-ocr/verify_frozen_cpu.py --reference data/hh-ocr-evaluation/new-run --output data/hh-ocr-evaluation/new-cpu-report.json
```

Evaluation preserves previous outputs. The new-geometry set has seed 2026101801
and 200 samples from the original generator using held-out final vocabulary;
it is a new geometry draw, not a new independent vocabulary test. Full answers,
images and local manifests are ignored. Historical Telegram photo bindings do
not retain image bytes, and the Bot API cannot list old outgoing chat messages.
The nine available originals are a regression set used during model development.

## Default general ONNX backend

Optional Linux amd64 component for the DE job-search browser. It recognizes a
cropped PNG using the official Cyrillic PP-OCRv5 ONNX model on CPU. It has no LLM,
external solver account, browser profile, cookies, Telegram token or PostgreSQL.

`requirements.lock` pins CPython 3.12 wheels and SHA-256 hashes. `model.json`
pins the official PaddlePaddle snapshot, model hash and character-table hash.
Weights are downloaded during image build and never committed. The image uses
an immutable Python base; OS runtime libraries come from signed Debian packages.
The OS layer and all native code are not claimed to have been exhaustively audited.

The only transport is `/run/job-ocr/ocr.sock`, directory 0700, socket 0600,
UID 1001. Browser mounts this socket volume read-only. Compose profile
`job-captcha-de` runs the worker with `network_mode: none`, read-only rootfs,
no capabilities, no host ports and resource limits. It must be healthy before
enabling `JARVIS_HH_CAPTCHA_RECOVERY=1` in the browser environment.
The default flag is `0`; the worker's profile is separate from `job-search-de`.

POST `/ocr` accepts only PNG bytes, Content-Length 1–262144, width≤2048,
height≤512 and ≤1048576 pixels. It rejects other content types, chunked bodies,
duplicate lengths, animations, corrupt images and unsupported shapes. The
recognizer tests 54 bounded alternatives: unwarped grayscale/contrast/inversion
and polar correction for both upper and lower arcs. Recognition tensors are
limited to height 48 and width 16–1024, including extreme input aspect ratios.
It requires at least
four agreeing, sufficiently confident outputs and 60% consensus among eligible
outputs. The result is exactly `{answer: string}` with two Russian words.
This is not evidence that HH accepted the answer. Browser recovery separately
verifies a read and never repeats an uncertain mutation.

No request content or recognized text is logged. A ten-second browser deadline
and twelve-second worker watchdog bound failures; Docker bounds CPU and memory.
Errors return only fixed codes. The worker reads no image/model paths from a
request and never interprets OCR output as a prompt, command or tool call.
Recognition failure emits the closed `JOB_OCR_NO_CONSENSUS` diagnostic and
returns `OCR_NO_CONSENSUS`; malformed input and invalid model output have separate
closed codes. Arbitrary exception messages are never forwarded or logged.
Browser read RPC has a 90-second outer deadline to cover navigation, the bounded
OCR request, the one answer and read-only reconciliation; application RPC keeps
its existing 120-second deadline.

## Verification

Build the image, then run `python -m unittest -v test_worker` in a constrained
networkless container with `test_worker.py` mounted read-only into `/opt/worker`.
Browser tests include `captchaProtocol.test.js`, `captchaDispatch.test.js`,
`captchaJournal.test.js`, `ocrClient.test.js`, `captchaRecoveryAcceptance.cjs`
and `captchaHttpsAcceptance.cjs`. The HTTPS acceptance needs container-only
`--add-host hh.ru:127.0.0.1`, loopback port 443 and OpenSSL; it generates an
ephemeral certificate in private tmpfs and never contacts HH.

Actual images, answers and temporary experiment artifacts stay outside Git.
The upper/lower-arc change was installed on DE from `8de0cfa`;
see [deployment and remaining browser issue](../docs/updates/2026-10-16-hh-native-captcha-request.md)
and [offline results and limits](../docs/updates/2026-10-15-hh-ocr-preprocessing-development.md).
See [design](../docs/superpowers/specs/2026-10-15-hh-captcha-recovery-design.md)
and [security review](../docs/updates/2026-10-15-hh-captcha-ocr-review.md).

## Attribution

The model and character dictionary are from
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and
[PaddlePaddle's official model repository](https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx),
Apache License 2.0. Snapshot and dictionary source revision are recorded in
`model.json` and `characters.json`. Other runtime packages retain their own
licenses in the built image's distribution metadata.
