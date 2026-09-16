# Autonomous cross-node VPN probe credential installation

**Status:** Approved for implementation on 2026-09-16.
**Scope:** Dedicated VLESS and Hysteria2 credentials used only by the already
staged cross-node VPN probe runner.

## Goal

Make the DE↔NL client probes run unattended after a one-time owner-approved
installation. The owner must not copy connection URIs into a chat, a terminal,
or a VPS. A credential rotation or replacement remains an explicit Telegram
owner decision that names the affected runner VPS and reason.

## Non-goals

- Do not change, rotate, revoke, or export a normal device credential.
- Do not enable a real VPN repair, restart a VPN stack, or let an LLM perform
  a mutation.
- Do not store a VLESS or `hy2://` URI in PostgreSQL, logs, telemetry,
  conversations, prompts, callback data, audit metadata, or Git.
- Do not make the probe result an automatic key-rotation signal.

## Design

### 1. Closed owner workflow

The owner initiates a dedicated **probe credential installation** for an
existing, explicitly labelled probe client. The persisted confirmation record
contains only closed fields:

- source VPN node: `de` or `nl`;
- runner node: the opposite node;
- protocol: `vless` or `hysteria2`;
- public probe client id and label;
- workflow kind: `probe_install` or `probe_rotate`.

The Telegram prompt states the source node, destination runner, protocol and
purpose. Its confirm/reject button is bound to the originating owner Telegram
chat and expires under the existing VPN confirmation TTL. It contains no URI.

On approval, the server requests a one-time export from the source Host Agent,
holds the URI only in the current process while forwarding it to the opposite
Host Agent, then drops all references. It never calls `safeHostData` with that
response and never persists it. A transport failure after the source action is
an `unknown` outcome; the source action is never retried under a new request.

### 2. Destination Host Agent installation boundary

A new closed Host Agent operation accepts a one-time credential only with its
fixed `{sourceNode, protocol}` context. It:

1. parses the URI using the existing strict client-probe parser and verifies
   the expected target host, TLS/REALITY or Salamander fields;
2. atomically writes the original URI to exactly one root-owned file:
   `/etc/jarvis-vpn/probe-<target>-vless.uri` or
   `/etc/jarvis-vpn/probe-<target>-hysteria2.uri`;
3. uses mode `0600`, owner `root:root`, no symlink following, and a private
   temporary file in the same directory;
4. returns only `{targetNode, protocol, installedAt}`.

`targetNode` is the VPN node that will be tested; therefore NL stores DE
credentials and DE stores NL credentials. The operation refuses the same-node
mapping, undeclared filenames, malformed URIs, a mismatched host, and extra
arguments. It never returns the credential or raw parser exception.

### 3. Probe activation

Once all four installs have produced a successful one-shot client probe, the
owner receives a separate confirmation to activate recurring monitoring. The
closed activation action installs the reviewed unit templates, reloads systemd
and enables only:

- `jarvis-vpn-probe@de.timer` on NL;
- `jarvis-vpn-probe@nl.timer` on DE.

It does not touch Xray or Hysteria2 services. A timer runs every three minutes
with bounded child lifetime and existing private `LoadCredential` copies.
Disable/re-enable monitoring also uses an owner confirmation, but normal probe
runs need none.

### 4. Replacement and notification

The monitor treats a stale, missing, invalid, egress-unavailable, or
credential-invalid result as `unknown`. It can notify the owner after debounce
that observation is unavailable, naming the runner VPS and cause. It offers a
closed `probe_rotate` action only; it never performs rotation automatically.

`probe_rotate` requires a new owner Telegram confirmation, rotates only the
dedicated labelled credential at the source, transiently forwards the new URI
to the destination installer, and requires a successful one-shot probe before
the prior monitoring state is resumed. An interrupted source rotation remains
unknown and must be reconciled rather than repeated.

## Test and acceptance plan

- Unit tests cover the strict request schemas, source/destination mapping,
  parser failure, atomic root-only write, symlink rejection, response
  redaction, idempotent/unknown mutation handling and no secret-shaped
  persistence metadata.
- Server workflow tests prove the URI cannot reach Telegram text, operation
  records, audit metadata, prompts or `safeHostData`; a failed destination
  installation never activates a timer.
- End-to-end acceptance installs one credential at a time through a fresh
  Telegram owner button, performs the matching one-shot probe, and verifies
  exit IP. It records service activation timestamps/restart counters before
  and after.
- Only after all four one-shot probes succeed is the separate recurring-timer
  confirmation presented. The acceptance verifies fresh results in
  `/vpn_health`, timer enabled state, no VPN service restart, and no leaked
  URI in journal or application logs.

## Failure handling

The safe default is unavailable observation, not a repair. If the source export
or destination install has unknown outcome, the server does not retry it. The
owner sees a short non-secret status and can explicitly request reconciliation
or a new replacement workflow. Rollback removes only the installed dedicated
credential file and disables only the matching probe timer, never a device
credential or VPN service.
