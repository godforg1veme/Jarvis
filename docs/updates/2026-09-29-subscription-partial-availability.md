# Subscription partial availability — 2026-09-29

The existing owner-supplied subscription URL returned HTTP 503 before this fix.
Read-only exports for all three active profiles found complete stored bindings
but missing DE Hysteria2 clients (`VPN_CLIENT_NOT_FOUND`). Other exports succeeded.
The cause of missing clients remains undetermined; no keys were restored or rotated.

Release `0b6c16ef0cd8a13d6bd88e9d1ea4c5818ed42bf9` now serves the available
endpoints of a fully bound profile. Incomplete bindings remain blocked.
Fully bound profiles with no serializable endpoints return
`SUBSCRIPTION_ENDPOINTS_UNAVAILABLE`; empty Base64 and direct-only Sing-box
profiles cannot succeed. Existing token, format, finite-pool and header contracts remain.

Verification: 42 focused subscription tests and all 604 server tests passed.
New regression tests failed before the implementation. Source guards passed on
both VPS checkouts and release verification passed on the new immutable DE
release. Preflight, build, unchanged server environment comparison and public
smoke passed. Only the server container changed ID; PostgreSQL, GigaAM and
Cloudflared retained their IDs. Existing release-mounted files remain preserved.

The original supplied URL now returns HTTP 200 in both Base64 and explicit
Sing-box formats, with three endpoints: NL Hysteria2, DE VLESS and NL VLESS.
Ordinary responses retain the one-hour refresh header. Response credential bodies
and tokens were not printed or stored. Production credentials were not mutated.
The owner should retry adding the same URL in Happ; phone-side import and traffic
remain manual acceptance checks. Missing DE Hysteria2 restoration is separate.
