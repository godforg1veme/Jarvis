# VPN scheduled proof freshness and subscription ordering — 2026-10-08

Live inspection found four active, completely bound subscription profiles; all
four export DE/NL Hysteria2 and VLESS credentials successfully. Credential bodies,
subscription URLs, hashes, labels and owner identifiers were not printed.

Both nodes have active Xray, Hysteria2 and Host Agent services, enabled peer probe
timers and successful latest runner exits. DE Server, PostgreSQL and GigaAM are
healthy. Both live and persistent UDP 20000–50000 DNAT rules are present.

Scheduled results previously expired after five minutes despite a 15-minute
timer with jitter. The Host Agent cached reader and server scheduled monitor now
accept target-bound, schema-valid results for at most 20 minutes. Missing,
malformed, wrong-target, too-old or future results remain unknown. Direct
owner-confirmed probe installation/recheck proofs retain the five-minute limit.

Both subscription formats now place positively healthy routes before failed or
unverified routes. Unverified endpoints remain available as fallback entries,
with their existing labels, credentials and finite port pools. Failed routes
retain the existing degraded label in Base64. This preserves subscription tokens,
bindings, partial-availability handling, RU routing and all Telegram issuance,
confirmation and reconciliation paths.

Live protocol checks on 2026-10-08 confirmed VLESS 443/8443 in both directions.
Separate strict client checks confirmed Hysteria2 fixed UDP 443 in both directions.
NL→DE hopping passed both requests across a 30-second hop. DE→NL hopping passed
the first request but the second did not return a verified expected exit. The
scheduled checks also contain unknown Hysteria results. Service health and
successful runner exit are not proof of every data-plane route; unknown remains
unknown. No credential rotation or VPN restart was performed.

Local checks: 610 server tests passed; Host Agent 143 tests passed with three
Windows-only platform skips. Focused tests cover scheduled freshness, strict
one-shot proofs, unknown/missing-route demotion and retained subscription entries.

Release `52d085ade7bee839852e32d02d07f41504236dd7` is deployed on DE from
`/home/deploy/releases/jarvis-52d085ad`. Source/release provenance, preflight,
unchanged server environment comparison, image regression (49 tests), Compose
health and public smoke passed. Only the server container changed ID;
PostgreSQL, GigaAM and Cloudflared retained their IDs and original mounted files.
Both Host Agents were updated from verified main source; all 143 Linux tests
passed on each node, followed by healthy local snapshots. VPN services were
not restarted.

Post-release live serialization produced four endpoints in Base64 and Sing-box
for each of the four active profiles, with positively healthy VLESS first.
A before/after aggregate digest of subscription metadata confirmed unchanged
tokens, labels and bindings. Cached scheduled proofs older than five minutes
remained readable through both the Host Agent and the deployed server monitor.
This is server serialization evidence, not a phone-side Happ refresh or a
new real Telegram issuance tap. Existing Telegram handler regression passed in
the complete server suite; no observable Telegram contract changed.

The locked image build reported two high-severity npm audit findings in the
server dependency set and one in the Operations UI dependency set. Dependencies
were not changed in this focused repair; these need a separate targeted audit.
