# Hysteria2 hopping maintenance — 2026-09-29

DE Hysteria2 remained active and listening on UDP 443, with healthy local
configuration and authorization. Its live DNAT for UDP 20000–50000 was absent
in both nft-backed and legacy iptables. The latest cached NL-to-DE fixed-443
check was healthy while hopping was unknown. Both hosts lacked
netfilter-persistent; DE also lacked /etc/iptables. Loss during its 2026-09-25
boot is plausible but the precise loss event was not established.

The owner explicitly authorized repair and autonomous subscription maintenance.
Source 931646cc3d5f31ec9e514eb99ef66369f4a25224 adds an atomic, validated UFW
before.rules persistence helper and removes silent persistence failure.
Existing UFW files were backed up privately under /root/jarvis-hopping-931646c.
DE's live rule was restored; NL's existing rule was preserved. Both persistent
files passed iptables-restore --test --noflush. A repeated DE setup was idempotent.
No UFW reload, reboot, VPN restart, container replacement, credential rotation,
pool change or subscription-token change occurred.

Full Host Agent tests passed on DE (142). NL initially hit unrelated fixture
reads of its real ACME DNS settings. Commit a32b0ac isolates the fixture path;
all 142 tests then passed on NL. Production ACME settings were not modified.

Read-only checks with existing installed cross-node probe credentials passed:
NL→DE at 2026-09-29 20:51:55 UTC and DE→NL at 20:52:27 UTC. Each reported
healthy VLESS 443/8443 and Hysteria2 fixed-443/hopping. The probe units were
run once for authorized maintenance acceptance; their timer configuration and
credential files were preserved. Public smoke and all service/container health
passed. Future actual reboot persistence and phone-side traffic remain separate
acceptance, not claims made by this maintenance.

All active subscriptions were inspected without printing credential bodies:
two generate four endpoints in Base64 and Sing-box; one generates three because
its DE Hysteria2 replacement still awaits owner Telegram confirmation. Every
published Hysteria pool is within the restored DNAT range. Existing imported
hopping endpoints benefit immediately from server repair; no new subscription
URL or reimport is required. Happ may refresh dynamically on its normal schedule;
the server cannot force an immediate device refresh. No raw tokens or keys were
stored in this record.
