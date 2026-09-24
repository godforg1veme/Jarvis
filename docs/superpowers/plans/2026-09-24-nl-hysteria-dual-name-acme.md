# NL Hysteria Dual-Name ACME Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NL a renewable certificate for its own DNS name while retaining the old TLS name for existing clients.

**Architecture:** Host Agent reads an optional root-only DNS-01 settings file and generates the complete Hysteria ACME config from it. The service obtains and renews certificates for both names through Cloudflare; only after live dual-name acceptance does the NL state advertise its new name.

**Tech Stack:** Python standard library Host Agent, Hysteria 2.12.2 built-in ACME DNS, Cloudflare DNS, Linux systemd.

**Spec:** `docs/superpowers/specs/2026-09-24-nl-hysteria-dual-name-acme-design.md`

## Global Constraints

- No credentials in Git, chat, logs, PostgreSQL, or telemetry.
- Existing NL clients and old TLS SNI must continue working.
- No key, password, IP, port, auth, or obfuscation mutation.
- No DE behavior change when the optional settings file is absent.
- Keep rollback copies of state/config and reconcile uncertain operations.

---

### Task 1: Add a closed DNS-01 settings contract

**Files:** `host-agent/jarvis_host_agent/hysteria_vpn_manager.py`, `host-agent/tests/test_hysteria_vpn_manager.py`.

**Interfaces:** A root-only JSON file at `/etc/jarvis-vpn/hysteria2-acme-dns.json` with exactly `domains` (two distinct DNS names) and `cloudflareApiToken` (bounded opaque token). `hysteria_config(state, auth_url, acme_dns=None)` emits either the existing HTTP-01 config or DNS-01 Cloudflare config. `HysteriaVpnManager` reads settings before config comparison and state mutation.

- [ ] Add synthetic tests for both modes, invalid schema/metadata, state name outside domains, and no token in public status/errors.
- [ ] Run focused tests to observe failure before implementation.
- [ ] Implement strict settings reader and deterministic config generation; retain old mode by default.
- [ ] Run focused and complete Host Agent suites on Linux; inspect diff for secrets and unrelated changes.

### Task 2: Stage DNS credential and obtain certificates

**Files:** Root-only NL settings/config (never Git); rollout record under `docs/updates/`.

**Interfaces:** Cloudflare token scoped to `rilora.ru`, DNS Write + Zone Read, NL IP; Hysteria config from Task 1.

- [ ] Verify public DNS resolves `vpn-nl.rilora.ru` to NL and current services/clients are healthy.
- [ ] Transfer one-time token without showing it to model output; install settings mode 0600 and config mode 0640 root:hysteria. Backup exact old config/state and preserve active client sessions until controlled restart.
- [ ] Validate generated config, restart only Hysteria on NL, and inspect ACME certificate metadata for both names. On failure, restore exact prior config and restart once.
- [ ] Probe old and new SNI over real Hysteria2; verify Xray and Host Agent still healthy.

### Task 3: Advertise NL's own name and prove renewal readiness

**Files:** NL root-only Hysteria state and rollout/status documents.

**Interfaces:** `state.serverName` changes from `vpn.rilora.ru` to `vpn-nl.rilora.ru` only after Task 2's dual-name acceptance; no client key changes.

- [ ] Backup and atomically update only `serverName`; confirm Host Agent exact config validity and new exports use new SNI without exposing URIs.
- [ ] Verify old and new client paths, both timed probes, timer state, and certificate expiry/ACME DNS configuration.
- [ ] Record Cloudflare token expiry (2027-09-25), certificate issuer/dates, rollback path, and remaining real-incident Supervisor acceptance.
