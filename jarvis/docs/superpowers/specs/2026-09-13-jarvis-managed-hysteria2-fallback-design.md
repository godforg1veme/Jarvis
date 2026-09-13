# Jarvis-managed Hysteria2 fallback design

Date: 2026-09-13
Status: approved design; written specification awaiting owner review

## Context

The deployed VLESS + REALITY + XTLS Vision service is healthy on the VPS, but
the owner's real iPhone route to it remains unstable. Happ intermittently shows
TLS handshake errors, unavailable latency, or multi-second connection checks.
Disabling Happ's global TLS fragmentation improved the connection, and packet
captures confirmed that the VPS responds promptly when packets arrive, but
SYN/SYN-ACK loss and latency spikes remain on the TCP path. CPU, memory, disk,
Xray health, and host-interface error counters do not indicate VPS exhaustion.

The VPS has a second public address, `87.120.187.109`. Xray must retain TCP 443
and TCP 8443 unchanged. UDP 443 is currently unused, so Hysteria2 can provide an
independent QUIC/UDP path without replacing or reconfiguring the working VLESS
service. Happ officially supports Hysteria2 share links.

## Goals

1. Add a personal Hysteria2 fallback on the second public IP for Happ on iOS.
2. Preserve the current Xray/VLESS listeners and all existing client access.
3. Manage Hysteria2 through the same owner-only Jarvis confirmation boundary,
   Telegram button experience, one-time credential delivery, and monitoring
   model as the existing VPN.
4. Use a publicly trusted TLS certificate and fail closed; do not distribute an
   `insecure` Happ profile.
5. Make rollback remove only the Hysteria2 service and its exact firewall rules.
6. Treat real Wi-Fi and LTE tests on the owner's iPhone as the acceptance gate.

## Non-goals

- Replacing Xray or changing its TCP 443/8443 configuration.
- Enabling Hysteria2 port hopping, multiple public UDP ports, or congestion
  tuning before baseline measurements exist.
- Sharing credentials between VLESS and Hysteria2.
- Public registration, billing, or non-owner administration.
- Persisting VPN share links, passwords, obfuscation secrets, or certificate
  account keys in Git, PostgreSQL, conversations, logs, or telemetry.
- Enabling the deferred backup timer or changing unrelated 3proxy services.

## Network and TLS architecture

Hysteria2 binds only `87.120.187.109:443/udp`. Xray continues to own TCP 443
and TCP 8443. The initial firewall change adds an exact `443/udp` allowance;
it does not add a UDP range. IPv6 is not advertised or accepted until an IPv6
route is deliberately configured and tested.

The public name is `vpn.rilora.ru`, configured as a DNS-only Cloudflare A record
to `87.120.187.109`. It must not be orange-cloud proxied because Cloudflare
Tunnel and the ordinary Cloudflare proxy do not carry this Hysteria2 UDP flow.

The Hysteria2 server obtains and renews a publicly trusted certificate using
ACME HTTP-01. TCP 80 is allowed only for the ACME challenge handler and serves
no Jarvis, Operations, database, or administration endpoint. The deployment
must verify that no current service owns TCP 80 before adding the rule. The
certificate name must match `vpn.rilora.ru`; the client export never enables
TLS verification bypass. If DNS cannot be created or public ACME validation
fails, deployment stops before Hysteria2 is made available.

## Hysteria2 runtime

The official Hysteria2 Linux binary is a new production dependency. The
implementation pins an explicit release, verifies its published checksum, and
installs it outside the repository. A hardened `hysteria-server.service` runs
under a dedicated unprivileged system user with only the capabilities and
filesystem access required for the UDP listener and certificate state.

Root-owned state under `/etc/jarvis-vpn/` remains the canonical VPN control
location. Hysteria2 receives its own versioned state and generated config files
so an invalid Hysteria2 update cannot alter Xray state. The service uses:

- password authentication with one random, independent secret per client;
- Salamander obfuscation with a server secret generated at install time;
- UDP forwarding enabled for ordinary client traffic;
- a bounded HTTPS masquerade target that reveals no Jarvis endpoint;
- warning-level operational logs without client secrets, peer addresses, DNS
  queries, destinations, or traffic contents.

No speculative bandwidth values or congestion-control overrides are applied in
the first rollout. The baseline is measured before any tuning.

## State changes and rollback

Every Hysteria2 mutation validates its closed input, writes a temporary state,
generates a candidate config, runs the official config check, atomically
replaces active files, and performs a bounded post-start health probe. A failed
validation, restart, listener check, or probe restores the previous Hysteria2
state and service status. It never restarts or rewrites Xray.

The installer records exact service, binary, config, DNS precondition, and UFW
changes in a root-only rollback manifest. Rollback stops and disables only
`hysteria-server.service`, removes only its exact UDP 443 and ACME TCP 80 rules,
and restores its previous files. Xray, cloudflared, 3proxy, PostgreSQL, and
Jarvis containers remain untouched. Root-only bounded snapshots are retained;
the deferred system backup timer remains disabled.

## Jarvis control boundary

The Host Agent remains the only mutation authority. It gains a protocol-aware
Hysteria2 manager with closed operations equivalent to the existing Xray
manager:

- status and bounded client metadata listing;
- issue, rotate, revoke, and one-time export for a named client;
- validated service restart.

The protocol never accepts shell commands, executable paths, arbitrary config,
raw passwords, or model-selected ports. Changing operations keep the existing
durable idempotency and unknown-outcome reconciliation rules. Status exposes
only service state, config validity, listener readiness, client count, and a
bounded synthetic probe result.

The server-side VPN service adds an explicit protocol discriminator with only
`vless` and `hysteria2` allowed. Existing VLESS commands and callbacks retain
their behavior. Internal opaque IDs may remain in validated callback data, but
the user sees only protocol names and human labels.

## Telegram experience and credential delivery

`/vpn` first shows two protocol choices: `Hysteria2 (рекомендуется)` and
`VLESS (резерв)`. Selecting Hysteria2 opens the same button-only flow already
used for VPN access: status, access list, new access, restart, export, rotate,
revoke, confirm, cancel, and back. The owner never types or sees request IDs or
client IDs. A new access still asks only for a human label.

Issue, rotate, and export return a one-time Telegram document compatible with
Happ. The artifact contains the Hysteria2 URI and a short import note; it is
never inserted into assistant text or persisted in a conversation. The URI
uses `vpn.rilora.ru`, the generated per-client password, Salamander parameters,
the matching SNI, and strict certificate verification. Artifact expiry,
single-use handling, owner scoping, and failure recovery reuse the existing VPN
delivery contract.

Hysteria2 is presented as the recommended fallback only after server-side
checks pass. It does not replace VLESS as an established working option until
the owner's real iPhone acceptance succeeds.

## Monitoring and error handling

Operations adds Hysteria2 as a separate service rather than merging its health
with Xray. A Hysteria2 incident cannot mark Xray unhealthy, and an Xray incident
cannot imply Hysteria2 failure. Collected fields are limited to systemd state,
config validity, UDP listener readiness, client count, and last bounded probe.

Expected failures use fixed operator-safe codes for missing DNS, ACME failure,
occupied ports, invalid config, failed restart, unavailable listener, expired
artifact, and unknown Host Agent outcomes. Credentials, raw ACME responses,
peer IPs, destinations, and share URIs are redacted. Missing telemetry never
causes an automatic restart of an otherwise healthy tunnel.

## Verification

### Automated and host checks

- Host Agent tests cover validation, atomic state updates, rollback, idempotent
  replay, unknown outcomes, protocol separation, and secret redaction.
- Server tests cover owner scope, confirmation, callback grammar, hidden IDs,
  protocol selection, one-time artifact handling, and VLESS regressions.
- Operations tests cover independent Xray/Hysteria2 health and incident state.
- Deployment preflight verifies the second IP, DNS-only A record, free UDP 443
  and TCP 80, pinned binary checksum, UFW exact rules, and config validation.
- Production checks verify the UDP listener, trusted certificate chain, local
  service health, external QUIC handshake, Jarvis status/restart control, and
  unchanged Xray TCP 443/8443 health.

### Owner acceptance

The owner imports the one-time profile into Happ and performs, separately on
Wi-Fi and LTE:

1. ten connect/disconnect attempts without TLS handshake errors;
2. repeated Happ latency checks with a reported value rather than `n/a`;
3. normal browsing plus YouTube playback;
4. an exit-IP check showing the VPS address;
5. a short speed and latency comparison against the VLESS profile.

If Hysteria2 still fails on both networks, it is rolled back independently and
the result is treated as evidence of a broader provider or route problem. If it
works on only one network, Jarvis retains both profiles and documents the
network-specific behavior instead of applying unmeasured server tuning.

## Acceptance criteria

Implementation is complete only when automated tests pass, production health
checks confirm Hysteria2 without degrading Xray, Jarvis can control it through
the owner-only button flow, and the protected Happ artifact is delivered. The
service is considered suitable as the preferred profile only after the owner's
Wi-Fi and LTE acceptance above. A running systemd unit or a visible Happ ping
alone is not proof that the VPN works.
