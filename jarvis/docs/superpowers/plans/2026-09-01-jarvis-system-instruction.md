# Jarvis System Instruction Implementation Plan

## Objective

Replace Telegram-specific prompt construction and question-specific identity
responses with one versioned Jarvis prompt pipeline shared by future clients.

## Tasks

1. Add a canonical `jarvis-persona-v1` policy module containing durable
   identity, style, criticism, truthfulness, user-isolation, and tool-result
   rules.
2. Add a Prompt Builder that keeps trusted policy/runtime context separate from
   untrusted history and the current request.
3. Add provider profiles and a Prompt Adapter. Use normal `system` messages by
   default and reinforced trusted envelopes for the current DeepSeek endpoint.
4. Add an Output Policy Validator for provider identity adoption, false tool
   success, and trusted-prompt leakage.
5. Add an Assistant Service that invokes the provider, performs at most one
   corrective retry, and rejects a second policy violation.
6. Refactor Telegram handling to call Assistant Service and remove the
   temporary `identityReply` path.
7. Add unit and contract tests covering construction, reinforcement, prompt
   injection boundaries, correction limits, and Telegram integration.
8. Deploy only the changed server source, rebuild the Node container, verify
   health, and run live identity and critical-response contract probes through
   the configured OpenRouter model.

## Verification

```text
cd server && npm test
npm audit --omit=dev
existing local Node and Python regression suites
Docker health on DE-4
live provider contract probe without exposing credentials
```

The deployment does not modify PostgreSQL data, Xray, VPN configuration, or
port 443. The existing false historical assistant messages remain audit history
but are untrusted model output and cannot override the persona.
