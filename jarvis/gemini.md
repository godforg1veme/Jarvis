# GEMINI.md

The authoritative agent instructions are in [`AGENTS.md`](AGENTS.md). Read that
file completely before inspecting or changing code; do not rely on an older
desktop-only description of Jarvis.

Jarvis is a hybrid personal/family AI-assistant platform: an always-on cloud
control plane provides Telegram access, persistent user-scoped conversations,
model routing, and future memory/device orchestration, while the Electron
application remains the Windows execution edge for voice, applications, files,
windows, and approved remote actions.

Gemini is an optional provider/advisor, not Jarvis's identity and not the sole
AI architecture. Current status and historical design records are indexed in
[`docs/README.md`](docs/README.md). Secrets, user data, generated state, and
deployment archives must not be committed.
