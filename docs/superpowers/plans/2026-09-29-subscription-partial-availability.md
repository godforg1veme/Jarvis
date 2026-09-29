# Subscription partial availability implementation plan

> Execute inline in this session using executing-plans.

**Goal:** Keep existing subscription URLs usable when only some bound exports succeed.
**Architecture:** Preserve binding authorization; check availability after serialization.
**Tech Stack:** CommonJS Node.js, Fastify, node:test, PostgreSQL, existing Host Agent.
**Spec:** ../specs/2026-09-29-subscription-partial-availability-design.md

## Constraints

No credential mutations, token rotation, new dependencies, schema or Telegram changes.

## Task 1: Resolver and regression tests

Files: server/src/vpn/vpnSubscriptionService.js, server/test/vpnSubscriptionService.test.js.
Interface: resolveSubscription(token, { format }) retains status/contentType/body/headers.

- [x] Add table-driven tests for missing one export, failed node, transport failure,
  all unavailable, incomplete bindings, malformed exports and invalid Hysteria pools.
  Assert counts in both formats and only bound export operations.
- [x] Run `node --test server/test/vpnSubscriptionService.test.js` and confirm failures.
- [x] Move binding guard before exports. Replace all-four guard with serialized
  availability checks: `if (!base64)` and
  `if (!profile.outbounds.some(o => o.type === 'vless' || o.type === 'hysteria2'))`.
  Return `SUBSCRIPTION_ENDPOINTS_UNAVAILABLE` when no usable endpoints remain.
- [x] Run focused subscription tests and `npm test` in server.
- [x] Review diff and commit implementation with verification documentation.

## Task 2: Publication and production acceptance

- [x] Publish reviewed change to main using repository branch policy.
- [x] Verify VPS source/release provenance and running mounts before rollout.
- [x] Deploy server release, check readiness and original subscription response
  using metadata-only diagnostics. Preserve tokens and Host Agent state.
- [x] Record verified deployment status; synchronize source checkouts.
