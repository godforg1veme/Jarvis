# VPN Supervisor LLM advisory implementation plan

**Date:** 2026-09-16

**Design:** `docs/superpowers/specs/2026-09-16-vpn-supervisor-llm-advisory-design.md`

**Scope:** isolated model planning, bounded evidence, durable owner approval,
and safe production no-op acceptance. Real VPN repair execution remains
disabled after this plan.

**Status:** Implemented and deployed on 2026-09-16 for both DE and NL. Automated
verification and the live provider contract passed; the owner-button result is
recorded in `docs/updates/2026-09-16-vpn-supervisor-multinode-rollout.md`.

**Historical status note (2026-09-23):** this plan records the deployed advisory
and no-op milestone as of 2026-09-16. A later owner-approved restart
implementation is tracked in `docs/updates/2026-09-23-vpn-supervisor-owner-approved-restarts.md`;
it was deployed briefly, rolled back, and redeployed after owner authorization.
Migration 026 is applied. The running production catalog enables the two closed
restart playbooks, with first real-incident acceptance still pending.

## 1. Define prompt, evidence, catalog, and response contracts

- Add a versioned Supervisor system policy separate from the Jarvis persona.
- Add strict schemas for incident context, sanitized evidence, planner output,
  and the initial closed playbook descriptors.
- Add an allowlist-based sanitizer with total, event, line, and repetition
  bounds. Treat every log value as hostile data.
- Add deterministic policy evaluation. Only the synthetic acceptance incident
  may select `supervisor_acceptance_noop`; real playbooks remain declared but
  disabled.
- Test prompt isolation, injection text, secret-shaped values, invented IDs,
  confidence, required checks, and catalog boundaries.

## 2. Add the isolated planner

- Implement `VpnSupervisorPlanner` over the existing configured answer
  provider, without `AssistantService`, memory, history, tools, or persona.
- Require exact JSON and perform at most one schema-correction request.
- Never log or persist raw provider input/output.
- Test valid proposals, `need_observation`, `stop`, timeout/failure, malformed
  responses, oversized content, and corrective retry.

## 3. Persist bounded workflow state

- Add migration 020 for `vpn_supervisor_runs` with strict states, synthetic
  marker, incident/node/manifest bindings, expiry, one-time decision fields,
  and bounded safe metadata only.
- Add a focused parameterized repository supporting create, claim decision,
  stale/expire, and terminal transitions.
- Add retention for old terminal test records.
- Test replay, wrong state, expiry, concurrent decisions, and absence of raw
  logs/model text in persistence arguments.

## 4. Implement owner approval and no-op execution

- Add a Supervisor service that creates only explicitly requested synthetic
  acceptance runs, invokes the isolated planner, applies deterministic policy,
  and sends a bounded Telegram proposal.
- Add owner-only callback parsing for allow, reject, and details using a UUID
  and callback payloads below 64 bytes.
- Revalidate the run and exact manifest after approval. The acceptance executor
  returns synthetic success and has no Host Agent client dependency.
- Send terminal result messages and make duplicate/replayed callbacks inert.
- Test owner authorization, rejection, details, allow, expiry, stale catalog,
  notification failure, and proof that no Host Agent method is called.

## 5. Expose an owner-only acceptance trigger

- Add a closed `/vpn_supervisor_test` Telegram command routed through the
  existing allowlist and canonical owner identity checks.
- Require an explicit production feature flag for synthetic acceptance. The
  flag enables only the no-op test, never real repair playbooks.
- Register the callback handler without weakening the existing callback
  grammar.
- Test non-owner access, disabled flag, duplicate active run, and complete
  message/callback flow.

## 6. Verify and deploy

- Run focused tests, full server tests, migration tests, diff checks, and
  dependency audit.
- Build the production image and run focused E2E tests inside it before
  replacement.
- Back up the current server tree, deploy migration and server image, wait for
  health, and run public smoke.
- Enable the no-op acceptance flag, invoke the test through the owner Telegram
  client, and verify reject/details/approve paths with the owner. Do not inject
  a real VPN fault.
- Confirm Xray, Hysteria2, Host Agent, open real VPN incidents, and public
  health are unchanged. Disable the acceptance flag after the test.
- Update `README.md`, `docs/README.md`, `AGENTS.md`, the design/plan status, and
  add a dated rollout record. Commit and push without rewriting history.
