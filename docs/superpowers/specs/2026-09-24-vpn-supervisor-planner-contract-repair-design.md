# VPN Supervisor planner contract repair — 2026-09-24

## Observed failure

A controlled NL Xray service stop on 2026-09-24 opened a correctly classified
`XRAY_SERVICE_FAILURE` incident. The Supervisor's model returned JSON with the
seven expected keys but invented `reasonCode` values and `requiredChecks`
values. Both the initial and one corrective response failed the closed Zod
schema, yielding `PLANNER_UNAVAILABLE`; no Telegram approval or repair was
offered. NL Xray was manually restored and the incident resolved. An isolated
synthetic request using the same deployed provider succeeded, so this is a
real-scenario response-contract failure rather than proof of general provider
unavailability.

## Decision

Keep the seven-field schema, closed enums, evidence-reference validation,
deterministic policy check, owner-origin confirmation, Host Agent operation,
and one-retry limit unchanged. Make the planner instruction enumerate the
actual allowed `reasonCode` and `requiredChecks` values, and state that
`requiredChecks` must be empty unless `decision` is `need_observation`.

If parsing fails, the existing single corrective request may include only
closed schema issue paths and issue kinds generated locally, never raw model
text, logs, credentials, or arbitrary validation messages. It restates the
exact allowed enum values. A second invalid response still fails closed. Do
not normalize, remap, or silently repair a model's proposed action or reason.

## Scope and verification

Only the isolated Supervisor prompt and planner retry metadata change. No VPN
service, playbook catalog, policy predicate, confirmation handler, callback,
credential, or provider configuration changes. Add unit tests proving the
first malformed response triggers one bounded correction with safe issue
paths; a valid second response passes; a second malformed response rejects;
invented evidence and provider failures remain rejected. Run focused and full
server suites, production-image focused tests, preflight and smoke before
deployment. Exercise the deployed model with a synthetic Xray-failure-shaped
context without changing a VPN service. A second controlled production stop
is a separate acceptance step: NL Xray only, healthy opposite stack, no
active connections at preflight, seven-minute `systemd-run` start watchdog,
immediate manual restoration if the proposal fails, and fresh owner Telegram
approval for the actual closed restart. Record whether the owner intended
"test immediately" to include this second live stop before doing it.

## Rejected alternatives

- Silently remap invented codes or check names: ambiguous model output could
  be misinterpreted as authorization.
- Change the configured model: broader product impact without a guarantee of
  conforming output.
