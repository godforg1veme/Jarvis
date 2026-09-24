# VPN probe expected-egress baseline deployment

Date: 2026-09-24

The Host Agent now reads an explicit `probeTarget.expectedExitIp` instead of
assuming the VPN listener address is also the tunnel's public egress. The
config and generated public probe environment were updated on DE and NL to use
the peer node's independently measured, stable direct egress.

Verification passed on both nodes: 116 Host Agent tests, Bash deployment-script
syntax, and `vpn.health.snapshot`. Host Agent, Xray, and Hysteria2 remain active;
both probe timers remain disabled and inactive. Public `/health/ready` returned
HTTP 200. No credentials or URI files were read, changed, rotated, or tested.

The first rollout attempts exposed a deploy-script bug: tests that read sibling
`deploy/vpn` templates ran after source had been copied into `/opt`, where those
templates are intentionally absent, so the candidate agent was not restarted.
The deploy script now runs tests from the complete staged source tree before
syncing the installed code, and a regression test protects that order. Failed
attempts were rolled back before the successful DE-then-NL deployment. Exact
root-only production backups remain at
`/root/jarvis-vpn-probe-egress-da93244/` on both nodes.

This is only a baseline/configuration correction, not a successful VPN
acceptance. The prior owner-confirmed `probe.install` remains `unknown`; the
earlier `probe.recheck` returned `EXIT_MISMATCH` before the baseline fix.

Follow-up acceptance attempt: at 2026-09-23 23:26 UTC (2026-09-24 02:26
Moscow time), the owner confirmed one DE-to-NL VLESS `probe.recheck` in private
Telegram. The durable action ended as `unknown` with `PROBE_RUN_UNKNOWN`; no
probe result was saved. Telegram reported that the operation was not retried.
Read-only DE Host Agent diagnostics identified systemd exit 243/CREDENTIALS:
the DE runner has no NL VLESS test-key file. This is a missing reverse-direction
test credential, not evidence about the installed NL-to-DE key or tunnel.
No credential was changed. Do not replay the uncertain action. The NL-to-DE
key still needs its own fresh owner-confirmed recheck after the gate fix.

The other three bindings still need separate installation and owner-approved checks. Keep both
timers disabled until all four fresh proofs pass and the owner separately
approves timer activation. No 99.9% uptime guarantee is claimed.
