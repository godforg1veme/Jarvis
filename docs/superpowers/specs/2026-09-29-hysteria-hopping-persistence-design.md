# Hysteria2 hopping persistence

Owner authorized repairing hopping and updating subscriptions autonomously.
DE has no live DNAT in nft-backed or legacy iptables. UDP 443 is listening and
the latest cached NL-to-DE fixed-443 probe passed, while hopping was unknown.
Neither node has netfilter-persistent; DE lacks /etc/iptables. NL retained its
live hopping rule since its earlier boot, but has the same persistence gap.

Persist the existing public DNAT rule through UFW's before.rules on both nodes.
Validate address/range, preserve other tables/rules, syntax-test using
iptables-restore --test --noflush, and atomically replace the file preserving
permissions. Apply only the exact missing live DNAT. Do not reload UFW, restart
VPN services or reboot during repair. Back up before.rules privately first.
Keep existing pools, credentials, tokens and subscription URLs. Restoring DNAT
also repairs already imported hopping endpoints without a client refresh.

Verify fixture tests, full Host Agent tests on Linux, kernel rule, persistent
file, service/container health and external read-only client probes. Inspect
all active profiles' generated endpoint metadata without displaying credentials.
Server configuration cannot force a client refresh; phone acceptance remains
separate. Any missing credential still requires its existing owner confirmation.
