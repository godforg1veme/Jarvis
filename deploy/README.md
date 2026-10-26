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

An optional [direct Happ subscription ingress](subscription-direct.md) is
prepared for timeout diagnosis independently of Cloudflare. It is not enabled.
Its separate overlay publishes TCP 80/9443 for ACME/HTTPS and proxies only
subscription GET/HEAD requests; it does not bind Xray TCP 443/8443.

`jarvis.rilora.ru` routes through Cloudflare Tunnel to `http://server:3210` and
its `/health/ready` endpoint was verified on 2026-09-01. Use it for Desktop
pairing and smoke checks. Do not expose port 3210 or PostgreSQL directly.

## First-time preparation

### Tavily MCP search

Enabled on DE on 24 October 2026 in the private server environment. A live
request from the installed container returned five sources in 1,148 ms.
The API reports a null PAYGO limit, which does not establish disabled billing.
See the [release and remaining checks](../docs/updates/2026-10-24-shared-instructions-and-search-release.md).

The server can use the official remote `https://mcp.tavily.com/mcp/` endpoint.
Set `JARVIS_WEB_SEARCH_ENABLED=true`, `JARVIS_TAVILY_API_KEY` and optionally
`JARVIS_WEB_SEARCH_TIMEOUT_MS` (default 15000) in the private server environment.
Compose forwards these variables only to `server`; no public port, sidecar or
Desktop installation is needed. An enabled search without a key fails config
validation. A disabled search makes no Tavily requests.

Use a free Tavily account with PAYGO and automatic payments disabled. Jarvis
does not upgrade the account or switch to a paid search provider. All users
share that account's quota, without per-user search quotas. Basic searches
request five results; reading full pages, crawling and research tools are not
enabled. Token use by the existing language-model provider is billed separately
under its existing routing settings.

The key goes in an Authorization header, never in the MCP URL. Do not print
environment values or raw MCP errors. See [runtime boundaries](../docs/runtime-context.md#shared-instructions-and-tavily-mcp)
and [verification](../docs/verification.md#shared-instructions-and-tavily-mcp).
Enabling this locally does not authorize changing production. Source and
installation updates follow the release workflow.

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

### HH: требования на 22 октября / Requirements on October 22

На DE установлены личный вход HH с доставкой ссылки в Telegram и мобильным
вводом, управление резюме через Mini App/бота и бесплатное поднятие по умолчанию.
Требуются миграции 040–043; в рабочей БД проверены все 45 файлов миграций.
Для личного входа и выбора резюме server/browser используют отдельный
`JARVIS_JOB_BROWSER_CONNECT_TOKEN`, для бесплатного поднятия — другой
`JARVIS_JOB_BROWSER_RESUME_TOKEN`. Ни один не передаётся collector.
Значения задаются только в закрытом окружении; профили и прежние настройки сохраняются.
Server и collector должны использовать актуальный server code; browser должен
поддерживать операции резюме. Политика сохраняет явный off и unknown, не разрешает
повторную отправку и не сбрасывает остановленные пользователем поиски.
Новые поиски требуют хотя бы одной фразы и явного включения пользователем.
NL получает исходники, job services на нём не запускаются. Desktop не менялся.
[Вход](../docs/updates/2026-10-21-hh-login-touch-release.md),
[резюме](../docs/updates/2026-10-22-hh-resume-management-release.md),
[текущая политика и порядок установки](../docs/updates/2026-10-22-hh-resume-bot-defaults-release.md).

DE runs personal HH sign-in with Telegram link delivery and phone input,
Mini App/bot resume management and free raising by default. Migrations 040–043
are required; all 45 migration files were verified in the production database.
Server/browser use a separate `JARVIS_JOB_BROWSER_CONNECT_TOKEN` for personal
sign-in and resume selection, and a different `JARVIS_JOB_BROWSER_RESUME_TOKEN`
for free raising. Neither is passed to the collector. Keep values in the private
environment and preserve profiles and existing settings. Server and collector
need current server code; browser must support resume operations. The policy
preserves explicit off choices and unknown stops, forbids replay and does not
reset searches disabled by their users. New searches require at least one query
and explicit user activation. NL receives source updates without job services.
Desktop is unchanged.
[Sign-in](../docs/updates/2026-10-21-hh-login-touch-release.md),
[resumes](../docs/updates/2026-10-22-hh-resume-management-release.md),
[current policy and installation record](../docs/updates/2026-10-22-hh-resume-bot-defaults-release.md).

The collector requires the same `JARVIS_OPERATIONS_OWNER_TELEGRAM_ID` as the
server. It uses current role and personal `jobs` grants for every user, including
background work; that owner setting does not restrict collection to one person.
Each person must connect their own HH profile and activate their own search.
The October 21 DE repair restored this setting through a private Compose overlay
while retaining the collector image. See the [repair and local regression checks](../docs/updates/2026-10-21-job-collector-access-repair.md).

The `job-search-de` profile adds `job-browser` and `job-collector` on DE only.
The bot server connects to the browser RPC network. No host ports/CDP are
published; the browser receives neither PostgreSQL nor model/Telegram secrets.
The collector receives a read credential; only the bot and browser receive
the distinct apply credential when explicitly enabled. See
[browser runtime and tests](../job-browser/README.md) and
[current readiness](../docs/README.md).

First production deployment is recorded in the
[release result](../docs/updates/2026-10-15-job-search-release.md). DE services
are enabled. Each user's search activation is separate from service deployment;
the first-release record does not describe the current activation state.

Publish only after owner authorization under the release workflow. Preserve
the existing private HH profile volume; configure its external volume name,
the actual Jarvis owner UUID, random read/apply credentials and the opt-in flags
in the private DE environment. Never replace the saved profile with a fresh
volume or print environment values. The selected primary resume and employer
exclusions must remain unchanged. NL receives source updates but runs no job
collector/browser. Desktop does not need rebuilding for these server changes.

Enabling the feature exposes the Telegram job path, but searches start only
after that user activates settings. «Подключить HH» verifies the saved login
and primary resume. Confirm the fact profile/examples before generating letters.
Letter generation uses the shared automatic OpenRouter queue: verified free
models first, then configured paid fallback. There is no per-user model setting
or separate job-model environment variable. Keep the job budget notification
threshold; it does not stop generation. See the
[October 23 release](../docs/updates/2026-10-23-jobs-automatic-model-release.md).
Live acceptance covers
cards, edits/translation and restart/dedup; any real application requires a
selected vacancy and an explicit confirmation of the exact letter in Telegram.
Keep fixture send results separate from that live acceptance.

Модель для писем выбирает общая автоматическая очередь OpenRouter. Ручной
настройки модели поиска больше нет; отдельный порог расходов остаётся
уведомлением. Текущее поведение и проверки описаны в записи выпуска выше.

### Human HH CAPTCHA replies through Telegram

18 October 2026: the approved fine-tuned OCR overlay is installed on DE.
`JARVIS_HH_CAPTCHA_AUTOMATIC=1` is set in the private server/browser environment,
with `JARVIS_FROZEN_BUNDLE_SHA256` and `job-ocr-frozen.yml` selecting the verified
bundle and networkless image. Keep the same external browser profile and socket
volumes. Attempts remain durable and bounded to three; unknown stops automation
earlier. The existing photo reply flow remains the fallback. Linux build, unit
tests and isolated socket/resource checks passed. The first live attempt returned
unknown and handed over a photo; HH acceptance is not claimed. See the
[release record](../docs/updates/2026-10-18-hh-trained-ocr-release.md) and
[`job-ocr/README.md`](../job-ocr/README.md). The installed release retains its
private `.env`; do not replace it with the canonical checkout's older environment.
The [three-attempt update](../docs/updates/2026-10-18-hh-captcha-three-attempts-development.md)
replaced only the browser on DE and preserved the existing human handover.

The [approved Telegram CAPTCHA design](../docs/superpowers/specs/2026-10-16-hh-telegram-captcha-design.md)
replaces the old HH browser gateway. One headless, sandboxed Chromium keeps the
original owner profile and durable recovery state. Collection and applications
remain paused while a CAPTCHA is unresolved; changing transport does not clear
claims, filters, checkpoints or a search disabled by its owner.

Set `JARVIS_HH_CAPTCHA_TELEGRAM=1` only in the private DE environment after
verifying the configured Jarvis owner. Generate a separate random
`JARVIS_JOB_CAPTCHA_TOKEN`, different from read and apply credentials. Only the
server and browser receive it. The collector never receives this credential.
The private HTTP broker is `job-browser:8082` in the existing
`job-browser-rpc` network. It has no host port, WebSocket, VNC, CDP or web gateway.
The existing optional OCR mode remains separate.

The bot sends only the bounded CAPTCHA image to the owner's private Telegram
chat. An explicit reply to that photo authorizes entering and submitting that
answer once. The answer bypasses dialogue, memory and model processing.
Confirmed read-only access to the original HH target resumes collection;
unknown results remain blocked. A particular photo expires after ten minutes,
but the recovery pause has no timer. Refresh replaces the photo binding.

Resilience update (deployed on DE, 2026-10-16): apply migration 033 before
starting the changed server. It adds durable request IDs, request timestamps and
bounded photo retry metadata; existing photos and progress remain intact.
Install server and browser together: the private challenge protocol gains
`refresh_required`. Collector code is unchanged. Chromium health evaluates local
JS in a disposable blank page with a two-second deadline, independently of HH;
the runtime exits on context loss or an 80-second operation stall so the existing
restart policy can recover it. CAPTCHA preparation replaces the previous tab.
Do not attach the real profile to acceptance containers or run a second Chromium
against that volume. Retain the 1 GiB budget until host capacity is measured.

Refresh requests survive preparation failures and are acknowledged only after a
durable result, by their original request ID. Photo 429 retries use the same
outbox row (at most four sends); missing ACK and expired sending leases become
unknown and require explicit refresh. Unknown human answers also block automatic
challenges. Closed, scoped failure notices use the existing delivery outbox;
queued delay notices are retired when recovery succeeds. Backoff is 10/20/40/80/
120 seconds, and status RPC has a five-second timeout. See the
[release record](../docs/updates/2026-10-16-hh-captcha-resilience-release.md).

Validate resolved Compose configuration through the bounded policy checker;
never print or store its secret-bearing JSON:

```bash
docker compose --profile job-search-de -f deploy/docker-compose.yml config --format json | python3 deploy/scripts/verify-job-captcha-config.py
python3 deploy/scripts/test-job-captcha-config.py
```

For an authorized upgrade, preserve the exact external profile volume,
mounted secret inodes, recovery journal and previous owner progress. Remove
obsolete HH manual environment keys from the active private release environment
without printing values. Build and install only changed DE services and verify
the actual running image, private listeners and health. NL receives source
synchronization without starting job services.

Retire only the verified HH-specific transport. Inspect and privately preserve
the current Tailscale Serve configuration before changing it. The prior setup
used HTTPS443 `/hh/` for the HH gateway and HTTPS10000 `/` for a separate use.
Remove only `/hh/` and its HTTPS443 listener if no handlers remain; preserve
HTTPS10000 `/` and every unrelated route. Never reset or uninstall Tailscale.

Stop and remove only `jarvis-job-manual-proxy.socket` and
`jarvis-job-manual-proxy.service`, their checked unit files under
`/etc/systemd/system/`, and the checked launcher
`/usr/local/libexec/jarvis-manual-loopback-proxy.py`. Reload systemd after unit
removal. Remove the verified HH gateway container and its dedicated network
only after confirming it has no unrelated endpoints. Do not use broad Compose
orphan removal, network pruning, volume deletion or production source cleanup.
Preserve PostgreSQL, OCR, the HH profile, VPN and unrelated Tailscale services.

Finally verify the old HH listener, proxy units, gateway and unused network are
gone. Test real Telegram photo delivery, explicit human reply and confirmed HH
read access separately from fixture acceptance. A lost photo ACK or answer POST
must not cause automatic replay under another operation ID. Root verification
instructions and dated release results record the actual deployment outcome.

## Free-first OpenRouter text routing (opt-in)

Enabled on DE on October 19: [release and live $0 probe](../docs/updates/2026-10-19-free-first-routing-release.md).
Set `JARVIS_OPENROUTER_FREE_FIRST=true` only as part of an authorized rollout.
The primary provider must be `openrouter`. The seven approved free IDs precede
the paid IDs in `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL`, ranked by
estimated request cost. All use the primary `OPENROUTER_API_KEY`; legacy backup
accounts and Gemini do not continue this queue. Existing fallback key/model
pair validation remains. Explicit HH/Vision model settings are unchanged.

The catalog and quota refresh on use every 15 minutes; model IDs are never
automatically added. Missing metadata fails closed and zero-price routing is
protected by provider price caps. See [contract and tests](../docs/updates/2026-10-19-free-first-routing-development.md).
