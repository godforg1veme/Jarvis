"""Closed operation classification shared by validation and durable execution.

Only explicitly read-only responses may expire. Unknown/retired operation
names are retained conservatively so existing mutation claims cannot be lost.
"""

READ_ONLY_OPERATIONS = frozenset({
    "host.snapshot", "inventory.snapshot", "services.snapshot",
    "service.logs.read", "backup.status", "parser.snapshot", "operation.status",
    "vpn.status", "vpn.clients.list", "vpn.hysteria2.status",
    "vpn.hysteria2.clients.list", "vpn.health.snapshot",
    "vpn.external_probe.snapshot",
})

# Read-only exports return a one-time URI only to the authenticated caller;
# their responses must never enter the durable journal or operation.status.
EPHEMERAL_SECRET_OPERATIONS = frozenset({
    "vpn.client.export", "vpn.hysteria2.client.export",
})

# These require durable claims but only a closed public result projection.
SECRET_OUTPUT_MUTATIONS = frozenset({
    "vpn.client.issue", "vpn.client.rotate",
    "vpn.hysteria2.client.issue", "vpn.hysteria2.client.rotate",
})

CHANGING_OPERATIONS = SECRET_OUTPUT_MUTATIONS | frozenset({
    "service.start", "service.stop", "service.restart", "backup.run",
    "vpn.client.revoke", "vpn.restart", "vpn.hysteria2.client.revoke",
    "vpn.hysteria2.restart", "vpn.external_probe.credential.install",
    "vpn.external_probe.run", "vpn.external_probe.monitor.enable",
    "vpn.external_probe.monitor.disable",
})

OPERATIONS = READ_ONLY_OPERATIONS | EPHEMERAL_SECRET_OPERATIONS | CHANGING_OPERATIONS
