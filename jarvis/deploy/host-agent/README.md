# Jarvis Host Agent

This service is installed on the VPS only after the server-side Unix-socket
client and session boundary have passed tests. It exposes no TCP listener.

The config and authenticator are deliberately absent from Git. Create a
`jarvis-server` group shared only with the Docker server process, make
`/run/jarvis-host-agent` traversable by that group, and mount the socket and
authenticator read-only into the Fastify container. Do not grant the Fastify
container Docker access, sudo, or a host shell.

`managedServices` is a root-managed allowlist of exact systemd units or Docker
container names. Empty `actions` means observed only. `tg-parser.service` is
registered with an empty action list; the Host Agent reads selected state and
bounded journal data only and never changes its unit, config, or sources.

Install or update from the deployed application tree with:

```bash
sudo bash /home/deploy/apps/jarvis/deploy/host-agent/install.sh
```
