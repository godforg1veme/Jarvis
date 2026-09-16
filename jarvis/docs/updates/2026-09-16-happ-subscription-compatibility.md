# Happ Subscription Compatibility Correction

Date: 2026-09-16

## Outcome

Jarvis VPN subscriptions now use one ordinary, auto-refreshing subscription URL
per profile. The URL returns a Base64-encoded list of the profile's configured
Hysteria 2 and VLESS endpoints; Happ imports the list as one subscription and
retrieves future endpoint changes from the same URL.

`/happ-sub/:token` remains a small landing page, but its one-click action now
uses Happ's subscription deeplink form:

```text
happ://add/<percent-encoded HTTPS subscription URL>
```

The prior `happ://add/sub?url=...` form was not a valid Happ subscription
import action. `/sub/:token` also no longer guesses a Sing-box response from a
Happ User-Agent. Sing-box JSON is available only with the explicit
`?format=sing-box` request; the normal endpoint is stable for subscription
clients.

## Telegram flow

- `/vpn` → «📲 Умная подписка (Happ)» always opens a list of active profiles,
  including when there is only one.
- `/vpn_sub` and `/vpn_subscriptions` open the same list.
- The profile view, creation, and token-rotation messages explain that one URL
  contains all compatible servers and Happ updates that profile from the same
  URL.
- Token rotation is clearly labelled as issuing a new link because it
  invalidates the prior link.

## Verification

Focused command, route, service, and repository tests cover the corrected
deeplink, normal Happ response, explicit Sing-box request, command aliases,
and one-profile list behavior. A real Happ import remains a manual device
acceptance check after deployment.

## Follow-up: initial access binding

Migration 023 permits the closed, owner-confirmed `subscription.repair` action
used to issue and bind the four client identities for a new subscription. The
flow compares and sets an unbound profile, so duplicate taps cannot replace an
existing access set. If any Host Agent mutation has an unknown outcome, the
subscription is kept blocked for operator reconciliation instead of attempting
a second issue or an unverified rollback.

## Follow-up: Telegram delivery

The owner-confirmed binding response now includes the actual HTTPS subscription
URL and an «Открыть в Happ» button. A bound profile offers «Получить новую
ссылку» if the original was lost; this rotates the token and invalidates the
old URL on every device. An unbound profile cannot issue an import link. The
Telegram response is a one-time delivery artifact: Jarvis conversation history
stores a redacted status sentence rather than the token. The bot explains that
revoking a subscription disables its dynamic URL, while previously imported
individual VPN credentials may still work.

Production follow-up on 2026-09-17: the server was rebuilt and passed public
health checks. Read-only Host Agent exports succeeded for all four clients of
the active profile. Two older assistant messages containing subscription URLs
were redacted in PostgreSQL; a follow-up count found zero such URLs in message
history. A live tap on the new Happ button remains a device acceptance check.

Hysteria 2 follow-up on 2026-09-17: both server processes and UDP redirect rules
were active, but the NL Host Agent exported the DE hostname while using NL
credentials. Host Agent exports now connect to the node's own address with the
certificate hostname in SNI. The Happ Base64 subscription keeps userpass as
`username:password` and encodes the port-hopping interval with Happ's documented
`mportHopInt` parameter. A real phone test is still required to confirm latency
and traffic on both mobile and Wi-Fi networks.
