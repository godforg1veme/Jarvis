# Happ resilient dynamic subscription design

Date: 2026-09-18

Status: approved for implementation

## Decision

Keep Happ as the family mobile client. Do not require a new client, a new
subscription URL, or reissued node credentials when a UDP port is blocked.
Jarvis will make the existing authenticated subscription choose and rotate a
bounded Hysteria2 port pool, while retaining DE/NL VLESS+REALITY as an
independent TCP fallback.

This is resilience, not a claim that one protocol or port is permanently
unblockable. Hysteria2 hopping helps only when an ISP is targeting individual
UDP ports; it cannot overcome an ISP-wide UDP block. The Hysteria2 project
states both constraints explicitly in its [port-hopping guide](https://v2.hysteria.network/docs/advanced/Port-Hopping/).

## Evidence from the incident

On 2026-09-17 the DE host was healthy: Hysteria2 listened on
`87.120.187.109:443`, UFW admitted the configured UDP range, DNAT counters
increased, and normal outbound HTTPS/DNS from the host succeeded. A header-only
capture during a real Happ attempt showed the phone selecting new destination
ports in `20000-50000` every five seconds and receiving a short reply from the
same address/port. Hysteria2 created no authenticated client session for that
attempt.

Therefore these checks are insufficient and must no longer be accepted as a
successful rollout:

- a running Hysteria2 service;
- an open UDP port or increasing DNAT counter;
- a cross-node test of fixed `:443`.

The deployed subscription injects `mportHopInt=30`, which is a client-specific
URI extension, not an official Hysteria2 URI field. The official Hysteria2
client contract puts fixed or random hop timing under `transport.udp` and
requires a minimum of five seconds. Happ documents port ranges, but its
published URI reference does not define the Jarvis extension. Happ compatibility
must consequently be established through a real-device contract test instead
of inferred from URI syntax. See Happ's [Hysteria2 reference](https://github.com/HappDev/happ_su/blob/main/faq/hysteria2.md) and Hysteria2's [URI scheme](https://v2.hysteria.network/docs/developers/URI-Scheme/).

The separate Happ Russian-routing profile is not the cause: Happ binds routing
profiles to an individual subscription and applies a changed setting only after
reconnect. It does not alter the remote Hysteria2 listener, its port range, or
server egress. [Happ routing reference](https://github.com/HappDev/happ_su/blob/main/dev-docs/routing.md).

## User-visible behaviour

The user imports one `https://jarvis.rilora.ru/sub/:token` subscription once.
The token and per-node credentials are unchanged by a port-pool rotation.

1. **Specific UDP port degradation.** A working Happ-compatible port-hopping
   profile moves to another port in its pool without an app action. This is the
   primary path.
2. **A whole current pool degrades.** Jarvis marks that pool unavailable and
   begins serving a new bounded pool through the same subscription URL. Happ
   receives it on its scheduled update (`profile-update-interval: 1`) or on a
   user-initiated subscription refresh. The user never pastes a new link or
   receives a new key. A Happ acceptance test must establish whether its
   background refresh also reconnects an already failed tunnel; until then the
   honest recovery instruction is **Refresh the existing subscription and
   reconnect**, not a guarantee of zero taps.
3. **UDP is blocked as a class.** The port pool cannot help. The same
   subscription retains VLESS+REALITY over TCP 8443 on DE and NL as a separate
   recovery path. Happ's ordinary Base64 URI list does not have a documented
   `url-test` guarantee, so automatic client-side selection must not be claimed
   without manual Happ acceptance evidence.

## Architecture

```text
                 device / ISP health
                         |
  fixed-port probe + Hysteria2 hop probe + Happ acceptance result
                         |
                         v
              ExternalProbeMonitor / incident state
                         |
                         v
             active DE/NL bounded port-pool selection
                         |
                         v
     GET /sub/:token (same URL, same client credentials, no raw-secret storage)
                         |
                         v
    Happ: DE Hysteria pool | NL Hysteria pool | DE VLESS | NL VLESS
```

### Port pools

- Keep the host's guarded allowed range `20000-50000/udp`; it is not published
  wholesale to Happ.
- A pool is a small, validated collection of randomly selected ports inside
  that allowed range, with a generation number and an activation time. Its
  public representation is either a comma-separated Hysteria2 multi-port list
  or a range only when Happ acceptance has verified that exact form.
- DE and NL use different pools. A rotation never changes the node address,
  SNI, certificate, client ID, password, obfuscation password, subscription
  token, or VLESS configuration.
- The Host Agent owns the pool inventory and firewall/DNAT verification. The
  cloud stores only closed node/pool identifiers, generation, timestamps, and
  health state—never port-sharing URIs, credentials, token values, paths, or
  raw packet data.
- A rotation is an owner-confirmed changing operation. A stale, unknown, or
  partially applied operation is reconciled by generation ID and is never
  retried under a new identifier.

### Hysteria2 transport contract

- Continue the multi-IP-safe DNAT rule, not a bare `REDIRECT` rule that can
  rewrite a packet addressed to the secondary address onto the primary address.
- Test each candidate pool through the exact data-plane mapping, not only at
  `:443`. A probe runs a real Hysteria2 client, authenticates with a dedicated
  probe credential, fetches a fixed HTTPS endpoint through the resulting local
  proxy, emits one bounded status/failure code, and destroys its temporary
  configuration.
- Add a separate `hysteria2_udp_hop` check. The existing
  `hysteria2_udp_443` check remains a listener/basic-path signal; it cannot
  promote a hopping pool to healthy.
- Do not use Hysteria2 Mimic for this mobile path: it is Linux-only at both
  endpoints and cannot be combined with port hopping. [Mimic documentation](https://v2.hysteria.network/docs/advanced/Mimic/).

### Happ contract

- Subscription output is always a standard Base64 URI list for Happ. JSON is
  emitted only when explicitly requested as `?format=sing-box`; never infer it
  from User-Agent.
- The URI serializer is a tested adapter with an explicit supported-field
  table. Unsupported extension fields are not silently invented. The exact
  happ-supported port-list and hop-interval representation is locked only
  after a real Happ test captures a successful authenticated session, survives
  at least three hops, and passes HTTPS through the tunnel.
- `profile-title` and `profile-update-interval: 1` stay on successful ordinary
  subscription responses. Happ documents standard subscriptions and
  subscription import separately from individual links. [Happ subscription
  guide](https://github.com/HappDev/happ_su/blob/main/faq/adding-configuration-subscription.md).
- Split-routing remains a separate public routing profile. Its enable/disable
  state is tested independently from transport health and every such test uses
  a full disconnect/reconnect.

### VLESS+REALITY fallback

VLESS+XTLS Vision on TCP 8443 remains the independent fallback. Its SNI,
public key, short ID, and fingerprint must be preserved in the URI serializer.
REALITY is TLS camouflage rather than an alternate network route; its client
configuration must be kept distinct from the server-only `target` and private
key settings. [Project X REALITY reference](https://xtls.github.io/en/config/transports/reality.html).

## Failure handling and safety

- A failed or stale hop probe demotes the pool but does not restart Hysteria2,
  rotate credentials, change a DNS record, or expose a new URI.
- A single cross-node failure is evidence of node health, not proof of an ISP
  block at the phone. Consumer-network failures require a fresh owner Happ
  acceptance result before a permanent pool change is proposed.
- An interrupted firewall/pool mutation has an unknown outcome. Reconcile the
  closed generation against host state before any subsequent action.
- Raw subscription tokens, VLESS URIs, Hysteria passwords, capture payloads,
  storage paths, and Host Agent socket responses never enter PostgreSQL,
  logs, prompts, callbacks, documentation examples, or Telegram history.

## Verification and rollout

1. Add unit/contract tests for closed pool validation, deterministic selection,
   URI serialization, no-secret public status, failed-pool demotion, and stable
   subscription identity across rotation.
2. Add Host Agent tests for pool inspection, multi-IP DNAT preservation,
   real Hysteria2 protocol probes, cleanup on failure, and unknown-outcome
   reconciliation.
3. Run an owner-approved one-shot cross-node probe against DE and NL before any
   timer is enabled. The existing disabled timers remain disabled.
4. On an owner phone, import the existing subscription once; verify a successful
   Happ Hysteria2 session, three port transitions with continued HTTPS, then
   verify split-routing after a disconnect/reconnect.
5. Simulate pool demotion without changing credentials; refresh the same Happ
   subscription and verify that its new pool works. Verify DE/NL VLESS fallback
   separately.
6. Only after four successful owner-approved one-shot checks may a future design
   consider enabling a periodic monitor. No real repair or autonomous
   firewall mutation is enabled as part of this rollout.

## Documentation runbook requirement

Create `docs/VPN_RESILIENCE_RUNBOOK.md` as the current operational guide. It
must include protocol contracts (Happ, Hysteria2, VLESS/REALITY), port-pool
states, diagnostics in evidence order, safe/unsafe actions, exact acceptance
criteria, and a source list. Historical documents remain historical; they gain
a status note instead of being rewritten as current truth.
