# VPN cross-node monitor activation failure handling

Date: 2026-09-23

## Status and scope

Approved in conversation on 2026-09-23. This design covers only the already
owner-confirmed `probe.enable` operation. It does not install credentials,
change VPN listeners, enable production timers during development, or broaden
AI repair authority. The four fresh authenticated probe proofs remain a
prerequisite.

## Problem

`ProbeCredentialWorkflow.enable()` currently enables the NL-to-DE and
DE-to-NL systemd timers concurrently. One can succeed while the other fails
or has an unknown outcome, yet the operation reports only a single failure.
That leaves the owner unable to tell whether monitoring is partially active.

## Chosen behavior

1. After verifying all four proofs, enable NL-to-DE first and accept only a
   confirmed Host Agent success. If it fails or is unknown, stop without
   dispatching the second enable. A first-call unknown outcome is reported as
   unknown; no new request ID is used to retry it.
2. Enable DE-to-NL second. Report `monitoring: true` only after both responses
   confirm success.
3. If the second enable fails or is unknown, issue one distinct, closed
   `vpn.external_probe.monitor.disable` compensation for the first timer.
   This is not a replay of either enable request. A confirmed compensation
   prevents a known first-side timer from remaining on. Regardless of the
   compensation result, report the overall activation as unknown when the
   second outcome is unknown, because that timer might be active.
4. If compensation is not confirmed, report unknown even when the second
   enable definitely failed. Do not claim both timers are off. Preserve the
   original failure classification only when second-side failure and the
   first-side compensation are both definite.
5. Do not automatically retry an uncertain enable or compensation. The owner
   must inspect the actual timer states before any later activation attempt.
   No credentials, URIs, or raw Host Agent output enter durable results or
   messages.

The existing `probe.disable` remains a separate owner-confirmed operation. It
is not part of this activation change; its partial-outcome behavior should be
reviewed as a separate follow-up rather than silently treating a failed
disable as complete.

## Boundaries and tests

- Keep the existing origin-bound private Telegram confirmation and four-proof
  database gate. No new Host Agent operation or production dependency.
- Unit tests cover: both success; first failed/unknown with no second call;
  second failed/unknown with exactly one first-side compensation; confirmed
  versus unknown compensation; and no success claim after partial outcomes.
- Run focused workflow and command-service tests, then the full server suite.
  Production timers remain disabled until the separate owner-approved four
  one-shot checks and live acceptance.

## Alternatives considered

- Keep concurrent activation and merely report partial state: faster, but
  leaves a known enabled timer running after the peer fails.
- Add a distributed transaction or new Host Agent status operation: stronger
  observability, but much larger protocol and deployment change. The narrow
  sequential compensation above fits the present closed-operation boundary.
