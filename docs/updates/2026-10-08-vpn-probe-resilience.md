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
Deployment and post-release evidence will be recorded after verification.
