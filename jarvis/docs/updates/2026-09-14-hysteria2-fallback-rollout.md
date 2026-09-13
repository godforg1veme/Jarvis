# Hysteria2 fallback production rollout

Date: 2026-09-14

## Outcome

The Jarvis-managed Hysteria2 fallback is active in production. It is isolated
from the existing Xray service and uses the second VPS address only:

- `vpn.rilora.ru` resolves directly to `87.120.187.109` without a Cloudflare
  proxy;
- Hysteria2 v2.12.2 listens on `87.120.187.109:443/udp`;
- Xray remains active on TCP 443 and TCP 8443;
- ACME HTTP-01 is restricted to `87.120.187.109:80/tcp`;
- the Host Agent and Operations expose Hysteria2 as a separate managed service;
- the owner bootstrap profile was delivered through Telegram and the temporary
  plaintext bootstrap file was removed from the host.

## Verified checks

- Deployment preflight completed with the documented low-memory override.
- The official pinned Hysteria2 binary checksum was verified by the installer.
- The Hysteria2/Xray host acceptance script passed.
- All 30 Host Agent tests passed on the VPS.
- `hysteria-server`, `xray`, and `jarvis-host-agent` were active.
- The rebuilt server container became healthy.
- Public `https://jarvis.rilora.ru/health/live` and `/health/ready` smoke checks
  passed.
- A protected Hysteria2 client configuration completed TLS authentication,
  established the proxy, and reached YouTube through it.
- Firewall inspection showed only the intended Hysteria2 UDP 443 and ACME TCP
  80 rules on the second address.

## Remaining acceptance

Import the delivered profile into Happ on the owner's iPhone and verify both
Wi-Fi and LTE. This manual carrier/client-path check is the only remaining
acceptance item and does not affect the verified Jarvis, Xray, or Life OS
services.
