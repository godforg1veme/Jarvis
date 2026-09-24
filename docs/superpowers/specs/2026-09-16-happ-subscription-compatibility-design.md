# Happ subscription compatibility and Telegram navigation

## Goal

Make Jarvis VPN subscriptions importable and automatically refreshable in Happ,
and make the `/vpn` Telegram flow consistently expose a subscription list before
an individual subscription view.

## Current issue

The landing page currently generates `happ://add/sub?url=<encoded URL>`. Happ
expects an ordinary subscription URL for clipboard import and the app deeplink
form `happ://add/<URL>`. The existing User-Agent-dependent JSON response is
also not the normal open subscription representation Happ expects.

When an owner has exactly one active subscription, the `vpn:sub:menu` callback
opens the detail card directly. This makes the button labelled as a subscription
entry point behave differently depending on the number of profiles.

## Design

### Subscription contract

- Each profile has one stable URL, `GET /sub/:token`.
- Happ receives a standard Base64-encoded newline-delimited subscription body
  containing every Happ-compatible endpoint. Updating that URL refreshes the
  entire profile; no per-server links are sent to Telegram.
- `GET /happ-sub/:token` is only a landing page. Its primary action uses
  `happ://add/<encoded subscription URL>` and it displays the same ordinary URL
  for manual paste.
- Sing-box-specific JSON remains explicitly available only through a requested
  `format=sing-box` representation. It is not selected from a guessed
  User-Agent.
- The normal endpoint uses the standard URI-list subscription representation,
  not an app-specific JSON profile. The response and Telegram copy explain that
  the configured servers are included and refresh changes the whole profile.

### Telegram navigation

- `/vpn` continues to show countries, subscription entry, diagnostics, and
  external probes.
- The subscription entry always renders a list screen. With no profiles, it
  explains creation; with one or more profiles, it shows a button for every
  active profile plus create and back controls.
- A profile detail page explains that its single URL adds all compatible servers
  and will automatically receive future list changes when Happ refreshes it.
- Creation and rotation show the ordinary subscription URL and the one-click
  Happ action. Rotation invalidates the previous URL, so copy describes the
  required re-import/update accurately.

### Safety and validation

- Tokens remain opaque and are stored only as hashes. Tests use fixture tokens
  only; no production subscription link is added to logs, fixtures, or docs.
- Callback grammar stays closed and under the established Telegram size limit.
- Tests cover correct Happ deeplink encoding, manual URL response, explicit
  Sing-box negotiation, one-profile list behavior, and all `/vpn` entry paths.

## Verification and deployment

Run the focused subscription command, route, and service tests, followed by the
server test suite if time permits. Deploy only the committed revision using the
existing VPS deploy path; do not use `git pull` in the current dirty/untracked
VPS working tree. Verify Compose health and the public readiness endpoint after
deployment.
