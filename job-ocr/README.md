# Local HH captcha OCR

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
recognizer tests a bounded family of polar corrections and requires at least
four agreeing, sufficiently confident outputs and 60% consensus among eligible
outputs. The result is exactly `{answer: string}` with two Russian words.
This is not evidence that HH accepted the answer. Browser recovery separately
verifies a read and never repeats an uncertain mutation.

No request content or recognized text is logged. A ten-second browser deadline
and twelve-second worker watchdog bound failures; Docker bounds CPU and memory.
Errors return only fixed codes. The worker reads no image/model paths from a
request and never interprets OCR output as a prompt, command or tool call.
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
See [design](../docs/superpowers/specs/2026-10-15-hh-captcha-recovery-design.md)
and [security review](../docs/updates/2026-10-15-hh-captcha-ocr-review.md).

## Attribution

The model and character dictionary are from
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and
[PaddlePaddle's official model repository](https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx),
Apache License 2.0. Snapshot and dictionary source revision are recorded in
`model.json` and `characters.json`. Other runtime packages retain their own
licenses in the built image's distribution metadata.
