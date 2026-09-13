# Jarvis-managed Hysteria2 fallback implementation plan

Date: 2026-09-13
Design: `docs/superpowers/specs/2026-09-13-jarvis-managed-hysteria2-fallback-design.md`

## Objective

Add an independently managed Hysteria2 listener on the VPS second address and
expose it through the existing owner-only Jarvis VPN controls without changing
the deployed Xray/VLESS path.

## 1. Host Agent Hysteria2 manager

1. Add failing unit tests for a separate Hysteria2 state schema, client issue,
   rotate, revoke, export, status, config generation, atomic rollback, and
   secret-free public results.
2. Implement `HysteriaVpnManager` in a focused module. Use an independent state
   and config path, password-per-client userpass authentication, Salamander
   obfuscation, strict hostname/address validation, and Happ-compatible URI
   encoding.
3. Add closed `vpn.hysteria2.*` operations to both Python and JavaScript Host
   Agent protocol validators and to durable-changing-operation dispatch.
4. Route only the new prefix to `HysteriaVpnManager`; preserve every existing
   `vpn.*` operation as the Xray/VLESS contract.
5. Run Host Agent manager, protocol, action, idempotency, and server tests.

## 2. Deployment assets

1. Add a hardened `hysteria-server.service` and a dedicated installer with
   pinned Hysteria2 v2.12.2 download URL and SHA-256
   `6493dfffd55b5883f64c76c63880ecc32988f0c568c9ca9014907877b4d55f94`.
2. Make the installer validate the second IP, public DNS-only A record, free
   UDP 443 and TCP 80, exact binary checksum, and generated config before
   enabling the service.
3. Generate root-owned secrets/state without printing them, add exact UFW rules
   for UDP 443 and ACME TCP 80, and provide a bounded rollback trap that never
   changes Xray, 3proxy, cloudflared, Docker, or PostgreSQL.
4. Add a non-secret acceptance helper that validates service/config/listener,
   trusted certificate availability, and unchanged Xray listeners.
5. Update deployment preflight/docs without enabling backups or committing
   runtime state.

## 3. Protocol-aware Jarvis controls

1. Add failing server tests for protocol selection, Hysteria2 status/client
   views, hidden IDs, confirmation binding, operation mapping, artifact type,
   URI redaction, and unchanged VLESS callbacks.
2. Extend the VPN command service with a two-protocol menu and protocol-bound
   callbacks. Store the selected protocol in confirmed action arguments and in
   the request fingerprint, while retaining the existing database action enum.
3. Extend Telegram callback validation within its 64-byte limit. New-access
   instructions accept a human label plus a protocol-specific command; no
   user-facing technical identifier is introduced.
4. Produce `happ-hysteria2` one-time documents only for validated `hy2://` or
   `hysteria2://` output. Never persist their content in conversations, audit,
   or action result metadata.
5. Update Desktop/Telegram copy and tests, then run the full server suite.

## 4. Operations monitoring

1. Add Hysteria2 as a distinct systemd service catalog entry and validate its
   bounded health schema independently from Xray.
2. Update collector and incident tests so either VPN protocol may fail without
   changing the other's health state.
3. Add Hysteria2 to the Host Agent managed-service install/update path with only
   the explicitly allowed restart action.
4. Run Operations collector, incident, logs, actions, build, and browser fixture
   checks relevant to the service entry.

## 5. Production rollout

1. Create the Cloudflare DNS-only A record `vpn.rilora.ru` pointing to
   `87.120.187.109` and verify it with an independent public resolver.
2. Sync the committed source to `/home/deploy/apps/jarvis` without copying local
   secrets or unrelated generated files.
3. Run deployment preflight, install Hysteria2, validate ACME issuance and the
   bound UDP listener, and confirm Xray remains healthy on TCP 443/8443.
4. Deploy Host Agent and server changes, run migrations/preflight if required,
   restart only changed services, and run Compose health plus smoke tests.
5. Exercise Jarvis Hysteria2 status and one confirmed issue/export flow without
   printing the URI. Deliver the one-time profile through Telegram and retain no
   plaintext copy outside protected runtime state.
6. Run an external Hysteria2 client through the tunnel and verify HTTPS plus the
   expected exit IP before asking for the owner's iPhone test.

## 6. Final verification and version control

1. Run `git diff --check`, secret scans, focused suites, the full server suite,
   Host Agent tests, deployment preflight, Compose health, and smoke tests.
2. Update `AGENTS.md`, `docs/README.md`, and the VPN rollout record with only
   verified current status and clearly marked manual iPhone acceptance.
3. Commit implementation changes using repository conventions and push the
   current branch only after all required checks pass, as previously requested
   by the owner.
