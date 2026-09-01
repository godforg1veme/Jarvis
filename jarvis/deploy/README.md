# Jarvis server deployment

Target: Ubuntu 22.04 on the DE-4 VPS. The application runs in Docker Compose;
only ports 80 and 443 are exposed by the application stack. PostgreSQL stays on
the Compose network and has no host port.

## 1. Prepare the host

Keep the current root SSH session open until login as the new `jarvis` user has
been tested in a second terminal. Copy an SSH public key to the server and run:

```bash
sudo bash deploy/scripts/bootstrap-ubuntu-22.04.sh /root/operator.pub 22
```

The script installs Docker, Compose, ffmpeg, the PostgreSQL client, WireGuard,
restic, UFW, unattended security updates, and a 4 GB emergency swap file. It
also disables password SSH after validating the SSH configuration.

## 2. Configure without committing secrets

```bash
cp deploy/env.example deploy/.env
chmod 600 deploy/.env
```

Set a URL-encoded database password, the BotFather token, the numeric Telegram
IDs, and model-provider credentials. Keep all token files outside git.

For a server where port 443 is already used by Xray, create a remotely managed
Cloudflare Tunnel in the dashboard. Add a published application route for
`jarvis.rilora.ru` with service URL `http://server:3210`. Save only the `eyJ...`
tunnel token in `deploy/secrets/cloudflare-tunnel-token` and restrict it:

```bash
mkdir -p deploy/secrets
chmod 700 deploy/secrets
nano deploy/secrets/cloudflare-tunnel-token
chmod 600 deploy/secrets/cloudflare-tunnel-token
```

Do not paste the tunnel token into chat or place it in `.env`; the Compose
service receives it through a read-only Docker secret.

## 3. Start and verify

```bash
JARVIS_ALLOW_LOW_MEMORY=1 bash deploy/scripts/preflight.sh
docker compose --profile tunnel --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
bash deploy/scripts/smoke.sh https://your-domain.example
```

Remove `JARVIS_ALLOW_LOW_MEMORY=1` after upgrading to DE-4. The temporary 8 GB
host may run the control plane, PostgreSQL, Telegram, and cloud model APIs, but
must not run the planned ASR or local LLM workers.

Do not run the host bootstrap or deployment commands until the exact DE-4 IP
and SSH access have been verified.
