# Happ VPN rollout — 2026-09-13

## Outcome

The production VPS now runs a dedicated hardened `xray.service` on TCP 443 and
an independently reachable fallback on TCP 8443.
The protocol is VLESS + REALITY + XTLS Vision and the generated share URI is
compatible with Happ. Legacy x-ui is stopped and disabled; a root-only rollback
backup remains under `/var/backups/jarvis-vpn/`.

Jarvis owns VPN lifecycle through a closed Host Agent contract. The owner can
inspect status and clients from Telegram or a paired Desktop. Issue, revoke,
rotate, export, and restart require a short-lived confirmation bound to the
originating client. Interrupted changes are reconciled by original request ID
instead of being repeated. PostgreSQL and conversation history retain only safe
client metadata; UUIDs, REALITY keys, short IDs, and VLESS URIs are excluded.

Telegram VPN control now uses an inline `/vpn` menu. Client lists and button
captions show human labels only; opaque client and confirmation identifiers stay
inside validated callback data and are not persisted in conversation history.
Status, client selection, export, rotate, revoke, restart, confirm, cancel, and
menu navigation are buttons. Creating a new access still needs one label via
`/vpn_issue Имя`; manual label-based actions and bare `/vpn_confirm` remain as
backward-compatible paths without requiring an ID.

Operations monitors Xray service state, configuration validity, port readiness,
and bounded client count. The former x-ui panel and unused Xray ports 16777 and
2053 were removed from UFW. Port 8443 was restored as a managed fallback after
live diagnostics found repeated SYN retransmission on 443 from the owner's
network. Existing independently managed 3proxy
listeners on 1085 and 1086 were deliberately left unchanged.

## Verification

- server tests: 204 passed;
- Host Agent tests: 22 passed on Windows and Ubuntu;
- Operations UI test and production build passed;
- production Xray configuration test and systemd health passed;
- Host Agent production issue → identical-id replay → revoke acceptance passed;
- external Windows Xray 26.6.22 client archive matched the official SHA-256;
- the exported production VLESS URI reached HTTPS through the VPS exit address
  and returned HTTP 204 from the external probe;
- `jarvis.rilora.ru/health/ready` and the deployment smoke suite passed after
  migration `014_vpn_control.sql`;
- Operations reported `xray: active / healthy` and persisted VPN metrics.
- Telegram button-control server tests passed (227 total); deployment preflight,
  public smoke, container health, and post-deploy error-log checks passed.
- Owner-route diagnostics showed 21 of 40 TCP/443 connects above 200 ms with a
  1058.5 ms median while TCP/22 stayed near 60 ms. After enabling 8443, 40 of 40
  connects completed in 55.4–62.1 ms; both Xray listeners and UFW rules were
  verified, and the refreshed `Me` profile was delivered directly to the owner
  through Telegram without logging or persisting its VLESS URI.
- The first 8443 export enabled an overly aggressive `1-10` byte TLS ClientHello
  fragmentation profile. iOS Happ then reported 4.5–5 second connection checks
  while an in-tunnel Speedtest still showed 144 ms. Fragmentation was removed;
  the stable alternate port remains the transport workaround.

The remaining manual acceptance is navigating the live Telegram `/vpn` menu,
confirming and cancelling actions through its buttons, then importing the
delivered text file or QR code into the user's actual Happ application and
checking the target networks from the intended device/carrier.
