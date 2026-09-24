# VPN probe recheck credential gate rollout

Date: 2026-09-24. Code deployed; live owner acceptance remains outstanding.

The 02:26 Moscow `unknown` action was a DE-to-NL VLESS recheck, while the
installed test key belongs to NL-to-DE. DE systemd reported exit
243/CREDENTIALS and the requested NL key was absent. It was not a test of the
installed direction.

The owner-only Telegram menu now shows `Проверить ключ` only for directions
with a completed installation/rotation attempt. A stale reverse-direction
callback cannot create confirmation. Server requests now carry the fixed
protocol, and Host Agent checks only private file metadata before systemd.
Missing requested credentials return a closed failure without starting a
probe; unsafe setup also fails closed. Unknown executions are still never
retried automatically. No credential or user VPN key was changed.

Local server tests passed 561/561; Host Agent tests passed 119 with 3
Linux-specific skips on Windows. Staged Linux Host Agent suites passed 114/114
on DE and 113/113 on NL. The built production image passed 52/52 focused VPN
tests. Its full suite did not pass because the production image omits fixture
and deployment files used by unrelated tests; the complete suite passed in
the local source checkout. Preflight, public smoke, readiness, and Docker
health passed after switching the server image. Both Host Agents, Xray, and
Hysteria2 were active. Both probe timers remained disabled/inactive.

Exact changed-file backups are retained at
`/root/jarvis-probe-gate-20260924/` on both nodes. The previous server image
is tagged `jarvis-family-server:rollback-before-probe-gate-20260924` on DE.
The existing NL-runner DE VLESS test file and its counterpart/environment
were checked by metadata only: root-owned and mode 0600; no URI was read.

Follow-up at 03:00 Moscow: the owner cancelled one `probe.install`, then
confirmed a separate NL-to-DE VLESS test-key installation. The latter durable
action succeeded with a fresh `vless_tcp_8443` proof, so this direction is
accepted. Two generic Telegram errors occurred nearby; no Telegram update
failed, but the callback route omitted `chatType` when calling the VPN domain.
The private-chat recheck guard therefore rejected valid taps before any new
confirmation. That context-forwarding bug is fixed and deployed separately;
the real owner tap of the corrected recheck route remains unverified. It does
not undo the successful installation proof. The server source suite passed
562/562, Telegram route suite 64/64, and the rebuilt production image passed
51/51 targeted tests. Preflight and public smoke passed after the server
switch. No probe was run by the deployment itself. A rollback image is tagged
`jarvis-family-server:rollback-before-chat-type-20260924` on DE.

The other three directions need their own installation/proof. Keep both timers off until
all four proofs pass and the owner separately approves activation. This is
not a 99.9% uptime guarantee.
