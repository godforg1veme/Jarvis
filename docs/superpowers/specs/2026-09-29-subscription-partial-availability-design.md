# Subscription partial availability

Date: 2026-09-29

## Problem and evidence

The supplied active subscription returns HTTP 503 with
`SUBSCRIPTION_CLIENT_BINDING_REQUIRED`. Read-only production inspection found
three active subscriptions with complete persisted DE/NL client bindings.
For each profile, DE Hysteria2 export returns `VPN_CLIENT_NOT_FOUND`, while
DE VLESS, NL Hysteria2 and NL VLESS exports succeed. The resolver currently
requires all four exports and blocks the entire subscription on any failure.
The cause of the missing DE clients has not been established. Existing focused
service, repository and route tests pass (23 tests), without covering this failure.
No tokens, client identifiers or credential material are included in this document.

## Approved approach

The owner selected approach 2: serve available endpoints for a fully bound
subscription, distinguish binding failure from endpoint unavailability, and
cover partial node failures. Restore missing DE credentials separately.

## Behavior and architecture

Keep resolution in `server/src/vpn/vpnSubscriptionService.js` and the existing
repository and Host Agent contracts. Resolve only an active token hash and
require complete persisted bindings before exporting credentials. Never discover
another client's credentials by label or issue replacement credentials.

For a fully bound profile, independently export its four bound endpoints.
Failed or unavailable exports omit their corresponding endpoints. Keep existing
finite public port pool validation, probe ordering, SNI and URI serialization.
Hysteria2 without a valid active pool remains omitted.

The ordinary URL returns HTTP 200 with the existing Base64 format when at least
one usable endpoint is serialized. Explicit `?format=sing-box` returns HTTP 200
only when at least one concrete VPN outbound exists; direct/block outbounds
alone must not qualify. The same URL and token continue working without rotation.

An incomplete persisted binding returns HTTP 503 with
`SUBSCRIPTION_CLIENT_BINDING_REQUIRED`. A fully bound profile with no usable
serialized VPN endpoints returns HTTP 503 with
`SUBSCRIPTION_ENDPOINTS_UNAVAILABLE`, in both formats. Unknown or revoked
tokens retain HTTP 404. Errors expose no per-client identifiers or secrets.

Keep the existing profile title and refresh headers on successful ordinary
responses. Do not change Telegram menus, callbacks or confirmation paths.
Do not add caching, dependencies, schema changes, credential mutations or
automatic repair. Missing-client investigation/restoration is a separate task.

## Verification

Add service regression cases for one missing DE Hysteria2 client, one entire
node unavailable, thrown export transport failures, all exports unavailable,
incomplete bindings and successful exports that serialize to no usable endpoints.
Verify both Base64 and explicit Sing-box responses, exact endpoint counts,
unchanged token lookup, and absence of unexpected discovery/mutation requests.
Check existing route/repository and adjacent subscription command tests, then
the complete server suite before any deployment.

Production acceptance after deployment: request the existing supplied URL
without printing its token or credential body, confirm HTTP 200 and expected
three available endpoints, confirm public readiness and healthy containers.
A successful server response does not establish phone-side Happ acceptance;
the owner must retry adding the same URL in Happ.

## Rollout boundary

Use the canonical source checkout and a published commit reachable from main,
following the repository source/release verification and mounted-file rules.
Do not rotate subscription tokens, issue VPN keys, or alter Host Agent state.
This document does not authorize restoring missing DE credentials.
