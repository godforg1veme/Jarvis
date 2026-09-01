# Jarvis server deployment

Current production target: Ubuntu 24.04 LTS on the Jarvis VPS. Docker Compose
runs the Fastify server and a private PostgreSQL/pgvector instance. The current
host also runs Xray on port 443, so Jarvis uses the `tunnel` profile and a
Cloudflare Tunnel instead of binding public web ports.

The original Ubuntu 22.04/Caddy-only deployment plan is historical. The
`direct` Caddy profile remains available for a different host where ports 80
and 443 are free, but it must not be started on the current Xray host.

## Layout and trust boundaries

- production directory: `/home/deploy/apps/jarvis`;
- `server` listens only inside the Compose network on port 3210;
- `postgres` has no host port and must remain private;
- Cloudflare must publish the selected Jarvis hostname to `http://server:3210`;
- persistent data uses the `postgres-data` and `document-data` volumes;
- secrets live only in `deploy/.env` and
  `deploy/secrets/cloudflare-tunnel-token` on the VPS.

Do not commit or paste real values from those files. Use `deploy/env.example`
as the variable-name reference.

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
peak RAM, latency, and interaction with PostgreSQL/VPN load.

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
update. Backups and a tested restore procedure remain required roadmap work.

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

## Desktop voice ASR

The Desktop HTTP endpoint is present but returns `ASR_UNAVAILABLE` while
`JARVIS_ASR_PROVIDER=disabled`. After the DE-4 benchmark selects a provider,
configure `JARVIS_ASR_PROVIDER=openai-compatible`, `ASR_BASE_URL`, `ASR_MODEL`,
and, when required, `ASR_API_KEY` only in `deploy/.env`. The endpoint must be
HTTPS in production and implement the OpenAI-compatible
`POST /audio/transcriptions` contract. Rebuild the server, verify `/health/ready`,
then send one non-sensitive voice probe from a paired test Desktop. Do not log
or retain raw audio outside the request path.
