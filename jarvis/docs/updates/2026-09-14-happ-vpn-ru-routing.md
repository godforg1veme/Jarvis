# Happ VPN domestic RU split-routing and 1-click web activation

Date: 2026-09-14

## Outcome

Happ routing profile for domestic Russian services and 1-click web activation
are deployed in production:

- Hysteria 2 remains the active VPN protocol for international and blocked traffic.
- Russian services (Gosuslugi, Russian banks, marketplaces, domestic media) route
  directly through the device's physical/local IP (`direct` outbound).
- DNS resolution for Russian domains uses domestic Yandex DNS (`77.88.8.8`) with
  the `IPIfNonMatch` strategy, preventing geo-blocking and domestic resolution failures.
- Telegram bot provides the `🇷🇺 Обход РФ` menu action and `/vpn_routing` command.
- Because the Telegram Bot API rejects custom deep link schemes (such as `happ://`)
  in message links and inline buttons (`BUTTON_URL_INVALID`), an authorized web
  activation endpoint is served at `https://jarvis.rilora.ru/happ-routing`.
- The landing page issues an automatic redirect (`<meta http-equiv="refresh">` and
  `window.location.href`) to the `happ://routing/onadd/...` deeplink, with an
  explicit fallback button **«Открыть в Happ»**.
- The large 30+ line blue Base64 wall was replaced by a short, bold 3-step guide
  and an inline button **«🚀 Активировать в Happ (1 клик)»**.

## Verified checks

- All 357 server tests passed (`npm test` in `server/`).
- The `jarvis-family-server` container on VPS rebuilt and passed health checks.
- Public smoke test passed: `https://jarvis.rilora.ru/health/ready` returned `200 OK`.
- Public routing endpoint passed: `https://jarvis.rilora.ru/happ-routing` returned
  `200 OK` with HTML content and valid `happ://routing/onadd/...` payload.
- In-memory routing JSON syntax validated against the official Happ routing format:
  `rules` with `geosite:category-ru`, `geosite:ru`, `geoip:ru`, `domain:ru`, `domain:su`,
  and `geoip:private` targeting `direct`, all remaining traffic targeting `proxy`.

## Trust boundaries

- The routing configuration contains strictly public domain/IP classification
  rules and public DNS addresses.
- Zero credentials, tokens, secret keys, or client UUIDs are embedded in the
  routing profile or web page.
