# VPN probe timer confirmation fix

Status: approved by owner on 2026-09-24; narrow production defect repair.

## Problem

The owner-only `vpn:probe:enable` button returns a generic VPN error before a
durable action or confirmation is created. `VpnCommandService._create` adds
default `protocol` and `node` fields to every command, while the closed
`probe.enable` and `probe.disable` action schemas require empty arguments.

## Decision

For timer actions, `_create` passes through the supplied arguments without
adding protocol/node defaults. The existing strict validator still rejects
any non-empty arguments. All other actions keep the current normalization.
No Telegram labels, callbacks, visibility, owner authorization, origin-bound
confirmation, proof gate, or Host Agent operation changes.

## Verification and rollout

Regression tests exercise enable and disable callbacks through confirmation
creation and assert empty durable arguments and no premature Host Agent call.
Run the focused VPN tests, required Telegram suite, full server suite,
deployment preflight, candidate-image tests, Compose health and public smoke.
After rollout, one fresh owner Telegram confirmation must activate the timers;
verify both actual systemd timers and a durable successful action. A failed or
uncertain result must be reconciled by its original request, never retried
blindly. Roll back the server image if the new path breaks unrelated actions.
