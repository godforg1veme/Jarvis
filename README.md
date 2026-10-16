# Jarvis

Jarvis is a personal and family assistant with an always-on cloud service and a Windows desktop client. The cloud service manages identity, conversations, memory, model access, Telegram, and device coordination. The desktop client handles approved work with local apps, files, windows, and voice.

Telegram is Jarvis's first cloud client. The project also includes a Windows app and a cloud API used by paired devices.

## Current capabilities

- The cloud service uses Node.js, Fastify, PostgreSQL, and pgvector. Model providers are configured outside product logic.
- The Telegram bot supports allowlisted users, private conversations, guided forms, inline confirmations, memory, documents, devices, VPN, and Operations. The Life OS area includes Mission, Timeline, projects, commitments, people, reminders, preferences, and context recovery.
- Job search collects HH vacancies in a separate background process on DE and sends filtered cards to the owner's Telegram chat. Search controls, saved vacancies, and cover-letter preparation and editing are available in the bot. The model runs on request; submitting an application requires approval of the exact letter. Live application submission still needs acceptance.
- HH CAPTCHA recovery works directly in Telegram: Jarvis sends the picture, the owner replies to that photo, and the browser submits the answer once. Verified access resumes the enabled search from its saved position. This flow passed a real owner check on 16 October 2026; no Tailscale connection or separate web screen is needed. See the [usage and acceptance record](docs/updates/2026-10-16-hh-telegram-captcha.md).
- The knowledge service stores private document metadata and text for owner-scoped search. It supports text and office formats, plus page-linked PDF search. Uploaded content is treated as untrusted data.
- The Windows Electron client provides cloud chat, local wake-word detection, speech, and bounded tools for apps and files. Device credentials are protected with Windows DPAPI.
- Remote device actions use a validated plan and Tool Gateway. Actions that change state require confirmation in the client that started the request.
- The first Vision workflow supports an explicit local camera or screen lease, two-display capture, bounded scene state, and owner-scoped visual memory. Two-display capture and a live Camo camera were tested locally; deployment of the Vision provider remains open.
- Allowlisted Telegram voice notes can be transcribed by the private GigaAM service on DE-4. The service processes `voice` notes under size, duration, and rate limits. Real owner Telegram voice was accepted; paired Desktop voice still needs a client check.
- VPN management supports Happ subscriptions across the DE and NL nodes, with VLESS and Hysteria2 options. The Supervisor can propose a limited service restart after diagnosis; execution requires a fresh owner confirmation. Current verification and remaining client checks are listed in [`docs/README.md`](docs/README.md).

VPN subscriptions prefer positively healthy routes and retain unverified routes as fallbacks. Scheduled proof freshness covers the 15-minute probe interval; owner-confirmed one-shot proofs retain stricter freshness. See the [2026-10-08 verification record](docs/updates/2026-10-08-vpn-probe-resilience.md) for current route uncertainty.

The documentation index records which behavior has been tested locally, deployed, or still needs a real client check. PWA support and live integrations for the Life OS external providers remain planned.

## Start the Windows client

Requirements: Windows x64 and Node.js 22.12 or newer. Node.js 24.14.1 was verified. From the repository root:

```powershell
npm run setup
npm start
```

`npm run setup` installs the locked dependencies and verifies the Vosk native modules and Electron executable. On Windows it handles the known ffi-napi installer probe failure without disabling dependency scripts. If downloading Electron fails, the command stops; retry after restoring network access.

To create the Windows x64 installer:

```powershell
npm run dist:win
```

The installer includes Electron and the wake-word runtime. It is not signed with a code-signing certificate, so Windows may display a SmartScreen warning. See [`AGENTS.md`](AGENTS.md) for runtime details and local asset rules.

## Start the cloud server

The server requires PostgreSQL and environment variables described in [`deploy/env.example`](deploy/env.example).

```powershell
cd server
npm ci
npm test
npm start
```

For VPS setup and operations, see [`deploy/README.md`](deploy/README.md). Never commit `.env`, files from `deploy/secrets/`, user data, or generated runtime state.

## Repository layout

Порядок публикации, проверки веток и синхронизации компьютера с VPS описан в
[руководстве по выпуску](docs/release-workflow.md).

[Как синхронизация работает сейчас: объяснение и схемы](docs/release-workflow.md#как-синхронизация-работает-сейчас).
[Описание выпуска от 9 октября 2026 года](docs/updates/2026-10-09-release-workflow.md).

Проверка установленного кода:

```powershell
py deploy/scripts/release-status.py --fetch --vps --desktop-app "C:/Program Files/Jarvis Desktop/resources/app" --check
```

Команда проверяет версии и состояние; установка выполняется отдельно в рамках
порученного выпуска. [Skill jarvis-release](.agents/skills/jarvis-release/SKILL.md)
использует тот же порядок.

- `server/` contains the cloud API, Telegram bot, persistence, model routing, and Life OS services.
- `renderer/`, `main.js`, and `preload.js` make up the Windows Electron client.
- `agents/`, `actions/`, and `tools/` contain the local execution path and its policies.
- `voice/`, `tts/`, and `vision/` contain desktop voice, speech output, and local capture workflows.
- `host-agent/` contains the restricted Linux-side execution service used by VPN operations.
- `deploy/` contains Compose files and deployment procedures.
- `docs/` contains the current status index, operational guides, specifications, and implementation plans.

## Project guidance

[`AGENTS.md`](AGENTS.md) is the authoritative guide for contributors and coding agents. It covers architecture, security boundaries, local data, Telegram interaction rules, and verification commands. [`docs/README.md`](docs/README.md) is the index for current status and project records.
