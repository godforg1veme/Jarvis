# Hysteria2 external-probe button fix

Date: 2026-09-24. Server and Host Agent fixes deployed; live Hysteria2 acceptance pending.

The owner tapped `Установить: 🇳🇱 → 🇩🇪 Hysteria2` and Telegram returned a
generic VPN-action error. PostgreSQL had no new `probe.install` row, so the
attempt did not reach confirmation or credential transfer. The fixed test
clients existed on their respective nodes. The callback found the Hysteria2
binding, but confirmation creation defaulted an absent top-level protocol to
VLESS and overwrote the binding protocol. The closed binding validator then
rejected it with `PROBE_BINDING_INVALID`.

The server now uses the binding protocol when the command has no top-level
protocol. The callback grammar, button text, owner check, origin-bound
confirmation, and credential handling did not change. A regression test covers
install and rotate for both Hysteria2 directions and verifies that no Host
Agent request is made before confirmation. It failed before the fix and passed
afterward. Local focused VPN tests passed 22/22, required Telegram tests 64/64,
and the full server suite 563/563.

Production preflight passed. The local source file was compared with the
running container and differed by only the corrected line; the local test
differed from the DE source test by only the new regression case. The built
production image passed the focused
VPN suite 22/22 without network access. The server was recreated from image
`sha256:a67c30d849b62881a12b7a3aa5dca8ad33f6cd96c4d4a383c1bf8d740063c37f`.
Docker health reached `healthy`, public smoke passed, and Host Agent, Xray,
and Hysteria2 stayed active on DE and NL. Both probe timers stayed
disabled/inactive. The latest durable probe row remained the earlier
successful VLESS recheck: deployment made no credential or probe action.

Exact prior source files are backed up on DE under
`/root/jarvis-hysteria-button-20260924/`; the prior image is tagged
`jarvis-family-server:rollback-before-hysteria-button-20260924`.

The next owner-confirmed NL-to-DE Hysteria2 attempt reached the Host Agent but
failed durably with `PROBE_INSTALL_FAILED`. Its destination credential file
remained empty. The Host Agent parser required the URI endpoint host and TLS
`sni` to be equal, while the deployed exporter correctly uses the node IP as
the endpoint and a separate DNS certificate name as SNI. The parser now keeps
the expected endpoint-host binding and strict TLS verification, but accepts a
distinct validated SNI. Synthetic parser and credential-install regressions
cover this contract. Full Host Agent suites passed on DE (116 tests) and NL
(115 tests). Exact previous parser files are backed up on each host under
`/root/jarvis-hy2-probe-parser-rollback-20260924/`. Both Host Agents were
restarted and are active; both probe timers remain disabled. No credential was
installed by the failed attempt.

The owner must open a fresh external-checks menu and confirm another
NL-to-DE Hysteria2 installation. Neither previous failure counts as a
successful probe. DE-to-NL Hysteria2 is also pending.
Both VLESS directions have successful proofs, so the current acceptance count
is two of four. Timer activation still requires four fresh successful proofs
and a separate owner confirmation. No real VPN repair or 99.9% availability
claim is accepted by this release.
