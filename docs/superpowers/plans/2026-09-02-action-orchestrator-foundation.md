# Action Orchestrator Foundation — implementation plan

Date: 2026-09-02

Status: approved for implementation. This plan implements the first production
vertical slice of the approved design in
`../specs/2026-09-02-action-orchestrator-platform-foundation-design.md`.

## Scope of this release

- Add a versioned action manifest and executor registry. Desktop is the first
  executor; server workers and account connectors remain explicit extension
  points.
- Persist owner-scoped workflows and action runs, including origin channel,
  origin Desktop, target executor/device, bounded state, revision and expiry.
- Add a strict JSON planner with `answer`, `ask_user`, and `tool_call` outcomes,
  one corrective retry, four-tool-step limit, and no provider fallback after a
  tool-capable request begins.
- Route planned Desktop calls through `CommandService`; it remains the only
  remote execution and confirmation authority.
- Resume a workflow from a persisted command result. Fast results complete in
  the current request; delayed results produce a validated workflow update for
  the originating client.
- Keep confirmation bound to the request origin: Telegram confirmation in the
  same Telegram conversation; Desktop confirmation on the same Desktop.
- Return opaque file candidate IDs from Desktop search and resolve/revalidate
  them locally for later open/reveal operations.
- Replace the narrow folder wording workaround with orchestrated natural tool
  use while retaining explicit `/desktop`, `/confirm`, `/reject`, and `/command`
  compatibility commands.

## Implementation order

1. Add action/executor contracts and conformance tests.
2. Add migration `006_action_orchestrator.sql` and `WorkflowRepository`.
3. Add `CommandResultBroker`; notify only after command result persistence.
4. Add `ToolIntentPlanner` and strict result validation.
5. Add `ActionOrchestrator` with device selection, bounded loop, workflow
   persistence, confirmation hand-off, result formatting and continuation.
6. Wire Desktop and Telegram message services and confirmation commands.
7. Add `workflow.update` to the WSS protocol and Desktop client forwarding.
8. Add the local file candidate vault and Tool Gateway resolution/revalidation.
9. Add deterministic scenario tests and seeded randomized paraphrase tests.
10. Run focused tests, complete server/client regressions, build the Windows
    installer, deploy the server, run migration/preflight/health/smoke, and
    verify the packaged Desktop contract.

## Security invariants

- Validate every planner output and action argument at the trust boundary.
- Parameterize every workflow query and scope it by `user_id`.
- Never send a candidate's real path back through model-visible cloud context.
- Never execute an action outside the declared manifest or device capabilities.
- Never turn a model statement into a success claim; only a persisted Tool
  Gateway result can establish success.
- Never use provider fallback once tools are exposed for a request.
- Bound prompt/history/result bytes, candidates, steps and timeouts.
- Session-transfer placeholders store metadata and secret references only; no
  browser secrets or transfer implementation is included in this release.

## Verification gates

- Unit: manifest, planner schema, workflow transitions, broker race behavior,
  origin-bound confirmation, owner isolation, candidate expiry/revalidation.
- Scenario: folders, files, apps and windows; multiple names, drives, typos,
  ambiguous results, no result, offline/multiple devices and follow-up wording.
- Property-style: deterministic seeded combinations must always yield only
  declared actions and valid bounded arguments.
- Regression: server suite plus Tool Gateway, remote protocol, policy mapping
  and cloud client suites.
- Release: migration succeeds, Compose services healthy, public smoke succeeds,
  installer contains the new action/candidate contracts.
