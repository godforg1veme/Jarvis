# GEMINI.md

[`AGENTS.md`](AGENTS.md) is the sole authoritative instruction set for coding
agents in this repository. Read it completely before inspecting or changing
code. It defines the current architecture, safety boundaries, generated files,
and verification commands; do not duplicate or override it here.

The `Desktop EXE Update Reminder` in `AGENTS.md` is mandatory after changes that
affect the Windows client or its packaged resources.

Gemini is an optional provider/advisor, not Jarvis's identity or the sole AI
architecture. For implemented-versus-roadmap status and historical design
records, use [`docs/README.md`](docs/README.md).

Current status note: the dynamic multi-node VPN subscription network with UDP port hopping (20000-50000), Smart Failover across DE & NL (Hysteria 2 + VLESS), migration 022, and 1-click Happ Telegram bot integration was production-deployed and verified on 2026-09-16. Both production DE (`jarvis-vps`) and new target NL (`jarvis-vps-new`) run iptables NAT PREROUTING port-hopping redirect. Real owner/member Telegram taps remain manual acceptance.
