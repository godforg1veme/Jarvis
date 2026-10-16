# Jarvis server deployment

Current production target: Ubuntu 24.04 LTS on the Jarvis VPS. Docker Compose
runs the Fastify server and a private PostgreSQL/pgvector instance. The current
host also runs Xray on ports 443 and 8443, so Jarvis uses the `tunnel` profile and a
Cloudflare Tunnel instead of binding public web ports.

The original Ubuntu 22.04/Caddy-only deployment plan is historical. The
`direct` Caddy profile remains available for a different host where ports 80
and 443 are free, but it must not be started on the current Xray host.

## Layout and trust boundaries

- production directory: `/home/deploy/apps/jarvis`;
- SSH access: configured via `~/.ssh/config` (`jarvis-vps` for `87.120.187.202`, `jarvis-vps-new` for new `94.183.208.56`);
- `server` listens only inside the Compose network on port 3210;
- `postgres` has no host port and must remain private;
- Cloudflare must publish the selected Jarvis hostname to `http://server:3210`;
- persistent data uses the `postgres-data` and `document-data` volumes;
- secrets live only in `deploy/.env` and
  `deploy/secrets/cloudflare-tunnel-token` on the VPS.

Do not commit or paste real values from those files. Use `deploy/env.example`
as the variable-name reference.

## Canonical source and VPS checkouts

Общий порядок GitHub, веток, VPS и Desktop находится в
[руководстве по выпуску](../docs/release-workflow.md). До staging обнови чистый
source через fast-forward, затем выполни source guard. Из Windows всю цепочку
можно проверить командой `py deploy/scripts/release-status.py --fetch --vps`;
`--check` возвращает ненулевой результат при незавершённой синхронизации.
Одна копия source и установленный runtime проверяются отдельно.

Use `https://github.com/godforg1veme/Jarvis.git` as the project remote and
`main` as the shared source branch. The Windows checkout is `F:\test\jarvis`.
Both VPSs keep source at `/home/deploy/apps/jarvis`: `jarvis-vps` runs the
Jarvis Server, and `jarvis-vps-new` runs VPN services and Host Agent.

Before uploading Host Agent files or installing VPN probe units, verify the
source checkout. The Windows deploy script checks its own checkout and the VPS
before it uploads anything. Run the same check directly on a VPS with:

```bash
python3 /home/deploy/apps/jarvis/deploy/scripts/verify-source-checkout.py source /home/deploy/apps/jarvis
```

The check confirms that the directory is a clean checkout of current `main`,
uses the canonical GitHub remote, has no nested `jarvis/` project, and has no
leftover branch references. VPS backups, deployment staging files, and the
pending-operation marker stay at their existing paths and remain outside Git.
For a detached server release, record its full commit SHA and check that exact
revision against `main`:

```bash
python3 deploy/scripts/verify-source-checkout.py release <recorded-full-sha> <release-path>
```

If a SHA, source, or Compose check fails, stop and inspect the difference.
Prepare a fresh sibling checkout and preserve the existing runtime files before
switching paths. Do not use `git reset --hard` or `git clean` to repair a
production checkout.

Before removing an old source directory, inspect Docker's bind mounts. A
running container keeps the file inode mounted from its start time even after
the host path changes. Keep that inode available until the container is
recreated, or preserve a verified hard link in a private ignored directory.
Check the new container IDs and health before removing that preservation copy.

## Desktop EXE update reminder

When deployment work also changes the Windows client or its packaged resources,
check whether the installed Jarvis Desktop EXE is stale. If it is, offer to run
`npm run dist:win` and install the current EXE; do not build or install it
automatically without a user request. `AGENTS.md` is authoritative for this rule.

### Current public endpoint

`jarvis.rilora.ru` routes through Cloudflare Tunnel to `http://server:3210` and
its `/health/ready` endpoint was verified on 2026-09-01. Use it for Desktop
pairing and smoke checks. Do not expose port 3210 or PostgreSQL directly.

## First-time preparation

The checked-in `bootstrap-ubuntu-22.04.sh` is retained as a historical/bootstrap
helper and has not been rewritten for the already-provisioned Ubuntu 24.04
host. Do not run it blindly on production. Verify the current user, SSH access,
Docker, firewall, Xray, and existing projects first.

For the existing host, create an isolated application directory and verify the
runtime:

```bash
mkdir -p /home/deploy/apps/jarvis
chmod 700 /home/deploy/apps/jarvis
cd /home/deploy/apps/jarvis
docker --version
docker compose version
```

Copy the repository deployment files without overwriting unrelated projects.
Create the environment file on the server:

```bash
cp deploy/env.example deploy/.env
chmod 600 deploy/.env
```

Create the Cloudflare token file without echoing its value into terminal logs:

```bash
mkdir -p deploy/secrets
chmod 700 deploy/secrets
nano deploy/secrets/cloudflare-tunnel-token
chmod 600 deploy/secrets/cloudflare-tunnel-token
```

The `cloudflared` image runs as an unprivileged user by default, while a
file-backed Compose secret is owner-readable. The Compose service therefore
runs as root only inside the isolated ingress container, solely to read the
read-only mounted token. Keep the host file at mode `0600`; never replace it
with a token printed in a terminal transcript.

The Cloudflare dashboard route must target `http://server:3210`. `DNS only` on
an old A record is not itself a tunnel; the remotely managed tunnel and its
published hostname must both exist.

## Start with Cloudflare Tunnel

On the temporary host with less than 15 GB RAM, only the control plane,
PostgreSQL, Telegram, and cloud model APIs are supported:

```bash
cd /home/deploy/apps/jarvis
JARVIS_ALLOW_LOW_MEMORY=1 bash deploy/scripts/preflight.sh
docker compose --profile tunnel --env-file deploy/.env \
  -f deploy/docker-compose.yml up -d --build
docker compose --profile tunnel --env-file deploy/.env \
  -f deploy/docker-compose.yml ps
bash deploy/scripts/smoke.sh "$JARVIS_PUBLIC_URL"
```

After upgrading to DE-4, run preflight without `JARVIS_ALLOW_LOW_MEMORY=1`.
Server-side ASR or a local LLM must still be enabled only after measuring their
peak RAM, latency, and interaction with PostgreSQL load.

## Direct HTTPS profile on another host

Use this only when nothing else owns ports 80/443:

```bash
docker compose --profile direct --env-file deploy/.env \
  -f deploy/docker-compose.yml up -d --build
```

Never enable `direct` on the current host while Xray owns port 443.

## Routine operations

```bash
docker compose --profile tunnel --env-file deploy/.env -f deploy/docker-compose.yml ps
docker compose --profile tunnel --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=200 server
docker compose --profile tunnel --env-file deploy/.env -f deploy/docker-compose.yml up -d --build server
bash deploy/scripts/smoke.sh "$JARVIS_PUBLIC_URL"
```

Run migrations through the server startup path and inspect health before
replacing a running container. Never delete volumes as part of an ordinary
update. The backup path no longer stops Jarvis, but a real encrypted backup
and isolated restore drill are still required production acceptance steps.

## Operations Panel

The owner-only panel is served under `/ops/` on the configured exact
operations origin. A new browser must be approved once through the main Jarvis
Telegram bot. Active sessions remain valid until they are explicitly forgotten.

The root-owned Host Agent is installed with:

```bash
sudo bash /home/deploy/apps/jarvis/deploy/host-agent/install.sh
systemctl status jarvis-host-agent --no-pager
```

Do not mount the Docker socket into the application container. Service actions
remain unavailable unless both the Host Agent allowlist and the matching
`ops_service_capabilities` row are enabled. The Telegram parser is observation
only and must never receive an action capability.

## Life OS

Migrations `013_life_os_core.sql`, `016`–`018`, and `019` create the owner-scoped Event
Spine, v2 domains, durable reminders, and uncertain orchestrator outcomes. Life
OS v2 is deployed as of 2026-09-15; the exact phrase completed the isolated
PostgreSQL-backed Orchestrator/Tool Gateway workflow exactly once and its
verified result updated the proposal, commitment, Timeline, and Context
Recovery. Authenticated read-only Desktop bootstrap/Mission Control/Timeline,
readiness, and public smoke also passed. For a new host, roll it out in stages: first set
`JARVIS_LIFE_OS_ENABLED=true` with enrichment and proactivity disabled, rebuild
`server`, and verify the same gates.
Enable `JARVIS_LIFE_OS_PROACTIVITY_ENABLED=true` only after the current Desktop
Mission Control build is installed, because proposals are delivered over the
validated `life.proposal` WSS message. Model enrichment remains independently
optional through `JARVIS_LIFE_OS_ENRICHMENT_ENABLED`.

Migration 019 and the native Telegram Life OS adapter were deployed on
2026-09-15. The production image passed 61 focused Telegram/runtime/migration
tests after the complete 414-test local server suite. The server, PostgreSQL,
GigaAM, and Cloudflare containers were healthy; public live/ready smoke and
`/ops/` passed; Xray, Hysteria2, and Host Agent remained active without restart.
The first smoke request briefly received 502 while the replacement container
was still `health: starting`; the bounded readiness retry then passed. Real
owner/member Telegram tapping remains a separate client acceptance check.

Life OS must never receive raw voice bytes, screen/camera frames, OCR text,
document bodies, private storage paths, VPN artifacts, or credentials. Changing
proposals remain frozen declared actions and still require confirmation in the
originating Telegram/Desktop client.

## Happ VPN

The 2026-10-08 release aligns scheduled proof freshness with the 15-minute
peer timers: cached snapshots expire after 20 minutes, while owner-confirmed
one-shot installation/recheck proofs still expire after five minutes. Unknown
routes remain subscription fallbacks behind positively healthy routes and never
authorize key replacement. Current deployment and live route evidence are in
[`the verification record`](../docs/updates/2026-10-08-vpn-probe-resilience.md).

The current host runs a dedicated hardened `xray.service` with VLESS + REALITY
+ XTLS Vision on TCP 443 and a managed 8443 fallback for unstable client
routes. Happ exports prefer 8443 and retain 443 as a rollback listener. Its
authoritative client state is root-only under
`/etc/jarvis-vpn/`; `/etc/xray/config.json` is generated from that state. Do
not edit either file by hand and do not restore x-ui while Xray is active.

Initial installation or an intentional rebuild uses a directly verified
REALITY target and keeps a root-only x-ui rollback backup:

```bash
sudo bash deploy/vpn/install.sh VPS_ADDRESS REALITY_SERVER_NAME Owner-Happ
sudo bash deploy/host-agent/install.sh
sudo bash deploy/host-agent/enable-safe-actions.sh
systemctl is-active xray jarvis-host-agent
sudo /usr/local/bin/xray run -test -c /etc/xray/config.json
```

The owner controls access from Telegram or a paired Desktop with `/vpn` buttons
and `/vpn_issue LABEL`; manual client actions accept labels rather than IDs.
All mutations require confirmation in the originating client. Never print or
archive the resulting VLESS URI; Telegram
sends it as a one-time document and Desktop writes it under its private runtime
data directory.

### Hysteria2 fallback

The optional Hysteria2 path is isolated from Xray. It binds the second public
IPv4 address on UDP 443, uses a DNS-only hostname with a trusted ACME
certificate, and keeps independent root-owned client credentials. Hysteria2
v2.12.2 is pinned by SHA-256 because the current binary has no dry-run config
check command; Jarvis validates its generated JSON exactly and treats the real
process/listener probe as the activation check.

For DE, create a DNS-only A record for `vpn.rilora.ru` pointing to
`87.120.187.109`. The installer now checks this on every invocation, including
when cached certificates exist, because ACME HTTP-01 renewal needs the hostname
to resolve to the same node. Then run:

```bash
sudo bash deploy/vpn/install-hysteria2.sh 87.120.187.109 vpn.rilora.ru admin@rilora.ru Owner-iPhone
sudo bash deploy/host-agent/install.sh
sudo bash deploy/host-agent/enable-safe-actions.sh
sudo PYTHONPATH=/opt/jarvis-host-agent python3 deploy/vpn/hysteria2_acceptance.py
```

For NL, use a separate DNS-only hostname resolving to `94.183.208.56` and
issue a matching certificate before relying on unattended renewal. Do not use
`vpn.rilora.ru` for a fresh NL install: it resolves to DE. The existing NL
certificate for that name expires on 2026-12-12; its renewal is not verified.
Do not change the live NL SNI/config until the new DNS record and certificate
are ready and the new endpoint has passed a real-client test.

The installer opens only UDP 443 on the second address plus TCP 80 for ACME
HTTP-01, and verifies that Xray remains active on TCP 443/8443. Its bootstrap
URI is protected at `/etc/jarvis-vpn/hysteria2-bootstrap-client.txt`; deliver it
through the owner-only Telegram artifact path and remove that bootstrap file
after acceptance. Never print it in a terminal, log, issue, or chat.

### Happ domestic RU split-routing and web activation

To direct Russian services (Gosuslugi, banks, marketplaces, domestic media, `.ru`/`.su` domains)
through the device's physical IP without going through the VPN, while keeping international
and blocked resources routed through Hysteria 2:
- the owner taps `🇷🇺 Обход РФ` or sends `/vpn_routing` in Telegram;
- the server provides a 1-click web activation endpoint at `https://jarvis.rilora.ru/happ-routing`
  which redirects to the `happ://routing/onadd/...` deeplink;
- the routing profile configures Yandex DNS `77.88.8.8` with `IPIfNonMatch` for Russian domains
  and direct routing for `geosite:category-ru`, `geosite:ru`, `geoip:ru`, `domain:ru`, `domain:su`,
  and private LANs (`geoip:private`), falling back to `proxy` for everything else.


## Model configuration

The production model is selected through environment variables. The current
deployment uses the OpenRouter-compatible provider; the exact model may change
without changing Jarvis identity. Salad support is an architectural target and
configuration surface, not a guarantee that a Salad endpoint is currently
active.

Keep the canonical Jarvis behavior in `server/src/prompts/`, not in provider
dashboard prompts. After changing a model, run `server/npm test` locally and a
manual identity, correction, and prompt-injection contract probe without
printing keys or hidden prompts.

For resilient text-only answers, primary provider selection remains
`JARVIS_MODEL_PROVIDER=salad` or `openrouter`. Configure
`OPENROUTER_FALLBACK_API_KEY` and `OPENROUTER_FALLBACK_MODEL` for the second
OpenRouter account/model, then optionally `GEMINI_API_KEY` and `GEMINI_MODEL`
as the final fallback. Keep all values only in `deploy/.env`. Tool-capable
requests are deliberately never replayed on fallback.

## Private knowledge base and backups

Telegram attachments are limited by the official Bot API download limit of 20
MiB. Jarvis stores them only in the private `document-data` volume using opaque
keys. TXT, Markdown, CSV, JSON, XML, HTML, and DOCX are indexed by text. PDF
text is extracted with `pdftotext` and includes page citations. Images,
archives, and generic files are indexed by private metadata; audio/video also
have their container metadata probed with `ffprobe`. Telegram `voice` notes are
an explicit exception when server ASR and `JARVIS_TELEGRAM_VOICE_ENABLED=true`
are configured: they are transcribed request-temporarily and never enter the
document volume. Telegram `audio`, video, and other media remain attachments.
Do not expose the volume through a public static-file route. The server image
creates the mountpoint with the unprivileged `node` owner before Docker creates
a fresh named volume; do not replace it with a root-only bind mount.

Encrypted off-VPS backup setup and the restore drill live in
[`backup/README.md`](backup/README.md). A backup is not accepted until the
restore drill has populated an explicitly empty test directory and database.

## Private ASR for Desktop and Telegram voice notes

The Desktop HTTP endpoint returns `ASR_UNAVAILABLE` while
`JARVIS_ASR_PROVIDER=disabled`. The selected DE-4 worker is the private
GigaAM `v3_e2e_rnnt` Compose service. Enable it only with
`JARVIS_ASR_PROVIDER=openai-compatible`,
`ASR_BASE_URL=http://gigaam-asr:8000/v1`, and
`ASR_MODEL=GigaAM/v3_e2e_rnnt` in the VPS-only `deploy/.env`. Set
`JARVIS_TELEGRAM_VOICE_ENABLED=true` only to route allowlisted Telegram
`message.voice` updates; it does not transcribe Telegram `audio` files. Voice
notes are limited to 5 MiB, 120 seconds, and three per owner per minute before
download. Then run
`docker compose --profile asr --env-file deploy/.env -f deploy/docker-compose.yml up -d --build gigaam-asr server`.
No ASR API key is needed for this private hop. Any other production endpoint
must use HTTPS and implement the OpenAI-compatible
`POST /audio/transcriptions` contract. The worker accepts fixed WAV/OGG/Opus
media types and uses a fixed ffmpeg conversion in tmpfs; it has no public port.
Verify worker and server readiness, then send a non-sensitive voice probe from
a paired test Desktop and a real allowlisted Telegram account. Do not log or
retain raw audio outside the request path.

## Jarvis Vision

Vision is fail-closed while `JARVIS_VISION_PROVIDER=disabled`. To stage the
OpenRouter-compatible provider, set `JARVIS_VISION_PROVIDER=openrouter`, its
dedicated API key/model, and one randomly generated 32-byte
`JARVIS_VISION_MEMORY_KEY` only in `deploy/.env`. Keep the `vision-data` volume
private; it contains AES-256-GCM blobs and must never be served as static files.
Server startup applies migration `012_visual_memory.sql` before accepting frames.

After rebuilding, verify the fake-provider and route suites first. Production
acceptance then requires one paired Desktop, an explicitly started local Vision
Lease, a non-sensitive camera frame, the combined two-display frame, Timeline
read/delete, immediate STOP, and a Telegram observation through that already
active lease. Telegram cannot start or extend capture. Do not enable Vision
until the memory key has been backed up securely: losing it makes retained frames
unrecoverable, while changing it without re-encryption breaks existing memory.

## Job search (DE, opt-in; first release 2026-10-15)

The `job-search-de` profile adds `job-browser` and `job-collector` on DE only.
The bot server connects to the browser RPC network. No host ports/CDP are
published; the browser receives neither PostgreSQL nor model/Telegram secrets.
The collector receives a read credential; only the bot and browser receive
the distinct apply credential when explicitly enabled. See
[browser runtime and tests](../job-browser/README.md) and
[current readiness](../docs/updates/2026-10-15-job-search-development.md).

First production deployment is recorded in the
[release result](../docs/updates/2026-10-15-job-search-release.md). DE services
are enabled; the owner's search settings still require Telegram activation.

Publish only after owner authorization under the release workflow. Preserve
the existing private HH profile volume; configure its external volume name,
the actual Jarvis owner UUID, random read/apply credentials and the opt-in flags
in the private DE environment. Never replace the saved profile with a fresh
volume or print environment values. The selected primary resume and employer
exclusions must remain unchanged. NL receives source updates but runs no job
collector/browser. Desktop does not need rebuilding for these server changes.

Enabling the feature exposes the Telegram job path, but searches start only
after the owner activates settings. «Подключить HH» verifies the saved login
and primary resume. Confirm the fact profile/examples before generating letters.
Use the dedicated job model/budget settings; the existing OpenRouter key is
reused without changing the main assistant model. Live acceptance covers
cards, edits/translation and restart/dedup; any real application requires a
selected vacancy and an explicit confirmation of the exact letter in Telegram.
Keep fixture send results separate from that live acceptance.

### Manual HH captcha from a phone (installed on DE, opt-in)

The approved [mobile design](../docs/superpowers/specs/2026-10-16-hh-mobile-manual-design.md)
adds the `job-manual-de` profile. Enable only on DE, after an authorized release.
The [16 October release result](../docs/updates/2026-10-16-hh-mobile-manual-release.md)
records the installed topology and outstanding phone acceptance.
The permanent owner URL ends in `/hh/`; it contains no credential and has no
automatic expiry. The browser still owns the single original HH profile.
Pending, active and checking manual states block collection and applications.
The owner starts the screen and selects «Готово»; only a successful read-only
HH verification resumes collection. A search disabled by its owner stays disabled.

The pinned browser image installs Xvfb `2:21.1.12-1ubuntu1.8` and x11vnc
`0.9.16-10` from Ubuntu Noble repositories. `displayMain.js` runs one Xvfb
display with TCP disabled and x11vnc on container loopback `127.0.0.1:5900`.
Display-child failure stops the browser. Chromium keeps its non-root sandbox,
profile volume, seccomp policy and existing resource limits. Clipboard transfer
is disabled. When `JARVIS_JOB_MANUAL_ENABLED=0`, only the prior browser runtime
starts; no display or VNC process is launched.
An unresolved persisted manual state prevents startup with that flag disabled;
disabling the feature must not silently resume collection over a manual session.

Configure the private DE environment without printing its values:
`JARVIS_JOB_MANUAL_ENABLED=1`, HTTPS Tailscale Serve origin in
`JARVIS_JOB_MANUAL_ORIGIN`, exact owner Tailscale login in
`JARVIS_JOB_MANUAL_OWNER_LOGIN`, and a new random manual token of at least 32
characters in `JARVIS_JOB_MANUAL_TOKEN`. The owner ID is taken from the existing
`JARVIS_JOB_BROWSER_OWNER_ID`. The manual token must differ from both read and
apply credentials and is shared only by the gateway and browser. Set
`JARVIS_JOB_MANUAL_ACCESS_URL` to that origin followed by `/hh/` for Telegram.
The server and collector never receive the manual credential.

Before installation, verify the actual Jarvis owner and Tailscale identity,
audit existing Serve routes, and preserve a private copy of its configuration.
Preserve the exact existing HH profile volume and mounted secret inodes.
Validate the resolved Compose policy without writing its secret-bearing JSON
to a log or tracked file:

```bash
docker compose --profile job-search-de --profile job-manual-de -f deploy/docker-compose.yml config --format json | python3 deploy/scripts/verify-job-manual-config.py
```

The gateway binds only host `127.0.0.1:19123` and joins only the internal
`job-manual-control` network shared with the browser. Add only the `/hh/` handler
to the existing HTTPS Tailscale Serve service, proxying to
`http://127.0.0.1:19123`; preserve the existing `/` and all other handlers.
Do not use `tailscale serve reset`, Funnel, public listeners, or raw VNC/CDP
port publication. Serve must inject authenticated Tailscale identity headers;
direct loopback requests without identity and requests from another tailnet
user must be denied. The gateway must not be reachable through another proxy
that lets a client supply those headers.

Docker 29 can omit the effective published port when the container has only an
internal network. Check both actual `NetworkSettings.Ports` and a localhost
request. If the declared loopback binding is absent, install the checked-in
`deploy/job-browser/jarvis-job-manual-proxy.socket` and `.service` under
`/etc/systemd/system/`, and `deploy/scripts/manual-loopback-proxy.py` as root-owned
`/usr/local/libexec/jarvis-manual-loopback-proxy.py` (0755). Enable only the socket
with `systemctl enable --now jarvis-job-manual-proxy.socket` after daemon-reload.
Do not install this socket if Docker already owns that port. This uses the
distribution's `systemd-socket-proxyd`, not another container network or public
listener. The launcher inspects only the fixed gateway/network, rejects changed
boundaries, drops root and all supplementary groups, then proxies to that
container's current internal address. Each activation resolves the address again.
After recreating the gateway, restart the proxy service if active, so existing
connections cannot retain the old destination. Keep the socket on loopback.
On the current VPS the existing Serve handler is on HTTPS port 10000; leave it
unchanged and add HTTPS 443 with `/hh/` only. The proxy target must include `/hh/`
(`http://127.0.0.1:19123/hh/`) because Serve removes the mount prefix.

After an authorized install, inspect the actual container image and process
state, verify health and non-public listeners, then test owner Safari through
Tailscale: screen, keyboard, manual captcha and «Готово». Verify foreign identity
denial, paused collection, restart persistence and unchanged progress/settings.
The permanent URL is not proof of owner authentication; record phone acceptance
separately from isolated tests. See [verification](../docs/verification.md).
