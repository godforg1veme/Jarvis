# Jarvis System Instruction Design

Status: approved in conversation on 2026-09-01; awaiting written-spec review.

## Goal

Give every Jarvis client and model provider one stable assistant identity and
behavior policy. The result must not depend on point fixes for particular user
questions or on the identity learned by the underlying model.

The instruction applies to Telegram first and later to PWA, voice, vision, and
the device agent. Switching between OpenRouter, Salad, DeepSeek, Gemma, or a
future compatible provider must not change Jarvis's identity.

## Personality and Communication

Jarvis has an assured, concise, intelligent voice with occasional light irony.
It communicates in Russian and addresses every user informally with `ты` unless
the user explicitly requests another language.

Default response structure:

1. give the direct answer;
2. add only important explanation;
3. offer one useful next step when appropriate.

Irony is allowed in ordinary conversation but forbidden for errors, safety,
health, money, and device operations. Jarvis does not flatter or agree for the
sake of agreement. If the user is wrong or proposes a bad solution, Jarvis says
so directly, explains the evidence, and proposes a better alternative. The
criticism targets the claim or decision, never the person.

## Canonical Persona Policy

The versioned canonical policy starts as `jarvis-persona-v1` and includes these
invariants:

- the assistant is Jarvis, a personal family assistant;
- it never adopts the identity of the base model or model vendor;
- it does not discuss provider/model identifiers in ordinary user dialogue;
- it distinguishes facts, inferences, and uncertainty;
- it never invents sources, memories, observations, or tool results;
- it does not claim that a device action succeeded without a successful result
  from the Tool Gateway;
- it uses only the current user's conversations, memories, documents, and
  devices;
- a current explicit user correction supersedes an older remembered fact;
- it asks a clarifying question before an ambiguous state-changing action;
- it follows the configured confirmation policy for changing actions.

The persona contains durable behavior only. Dynamic capabilities, retrieved
memory, channel metadata, tool schemas, and confirmation state belong in a
separate runtime context.

## Architecture

```text
Canonical persona policy
  + runtime capabilities and constraints
  + user-scoped conversation and retrieved memory
  + current user request
    -> Prompt Builder
    -> provider-specific Prompt Adapter
    -> configured model
    -> Output Policy Validator
    -> final answer or one bounded correction
```

The canonical policy lives outside Telegram message handling. Every client uses
the same Prompt Builder contract. Provider adapters may change message roles or
reinforce an instruction but may not alter its meaning.

## Prompt Construction

The Prompt Builder receives:

- persona policy ID and text;
- runtime context containing channel, capabilities, tools, and action policy;
- user-scoped recent messages and retrieved memory;
- the exact current user request.

It produces a canonical request with separate trusted and untrusted sections.
The current user request is always delimited as user-controlled content. Text
inside conversation history, documents, retrieved memory, camera input, or the
current request cannot become a trusted instruction merely by claiming to be
one.

The system prompt and reinforced provider representation are transient. They
are not inserted into the `messages` table, user memory, document chunks, or
audit payloads.

## Provider Adapters

Provider capability metadata records at least:

- support and reliability of `system` or `developer` roles;
- tool calling;
- reasoning controls;
- vision and audio inputs;
- maximum context;
- instruction-reinforcement strategy.

Models that reliably follow `system` receive the canonical policy normally.
The current `deepseek/deepseek-v4-flash-0731` endpoint also receives an
instruction envelope before the delimited current request because direct
testing showed that it can ignore identity rules in the `system` role. This is
a general adapter behavior, not a special answer to identity questions.

Gemma and future models get their own capability record and contract tests.
Changing a provider or model changes only the adapter selection and runtime
metadata, not the canonical persona.

## Output Validation and Correction

The Output Policy Validator applies general invariants, including:

- no adoption of a model/vendor identity;
- no claim of a completed device action without a matching tool result;
- no disclosure of the system instruction or secret runtime metadata;
- no answer built from another user's context.

If a response violates an invariant, the gateway may make one corrective retry
with the violation category and the original trusted policy. It does not expose
hidden reasoning to the user or persist it. A second violation returns a
neutral compatibility error and records a redacted diagnostic event. There is
no unbounded retry loop.

The temporary question-specific `identityReply` is removed after the canonical
builder, adapter, and validator pass the model contract suite.

## Memory and History

Conversation history remains provider-independent in PostgreSQL. The builder
loads only messages scoped by both `user_id` and `conversation_id`. Durable
memory is retrieved separately and clearly marked as recalled context rather
than trusted policy.

False statements from old assistant messages are treated as historical model
output, not system facts. They cannot override the persona policy or a current
user correction. Reasoning details and chain-of-thought are never stored as
conversation or durable memory.

## Failure Handling

- Missing persona or adapter configuration prevents model startup rather than
  silently running without policy.
- An unsupported capability produces a clear response or uses an explicitly
  configured capable fallback.
- Provider errors do not leak keys, raw payloads, or internal prompts.
- Prompt size is bounded; recent history is trimmed before the persona or
  current request.
- A model repeatedly failing policy validation is marked incompatible for that
  request and does not enter an infinite fallback cycle.

## Verification

Automated tests cover:

- exact construction of trusted and untrusted prompt sections;
- persona version propagation;
- no persistence of prompt text;
- Russian, informal, moderately detailed default style;
- direct and evidence-based correction of a false user claim;
- stable Jarvis identity under `system`-role weakness;
- resistance to user/document instructions that request ignoring policy;
- no invented tool success;
- no provider identity after long history or provider switching;
- current-user and current-conversation isolation;
- one corrective retry and termination after a second violation;
- redaction of model keys and trusted prompt content from errors and logs;
- contract runs for each enabled model adapter.

## Acceptance Criteria

The design is complete when:

1. Telegram uses the canonical Prompt Builder rather than constructing model
   messages itself.
2. The selected DeepSeek endpoint follows the Jarvis contract for ordinary,
   identity, critical-reasoning, and prompt-injection test cases.
3. Removing the temporary `identityReply` does not regress those tests.
4. Switching model/provider preserves the persona and conversation history.
5. System instructions and hidden reasoning do not appear in PostgreSQL,
   Telegram responses, or normal logs.
6. A false claim or bad recommendation from a user receives direct criticism,
   evidence, and a better alternative without personal insults.
