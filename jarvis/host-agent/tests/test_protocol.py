import unittest

from jarvis_host_agent.protocol import ProtocolError, validate_request, validate_response


REQUEST_ID = "2d2f9f55-6859-49d9-b54d-9d42d4251d52"
NOW = "2026-09-04T10:00:00.000Z"


def request(**overrides):
    value = {
        "version": 1,
        "requestId": REQUEST_ID,
        "operation": "service.logs.read",
        "arguments": {"serviceId": "jarvis-server", "maxLines": 20},
        "sentAt": NOW,
    }
    value.update(overrides)
    return value


class ProtocolTests(unittest.TestCase):
    def test_accepts_closed_declared_request(self):
        self.assertEqual(validate_request(request()), request())
        self.assertEqual(
            validate_request(request(operation="host.snapshot", arguments={}))["arguments"],
            {},
        )

    def test_rejects_undeclared_and_command_arguments(self):
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="shell.exec"))
        with self.assertRaises(ProtocolError):
            validate_request(request(arguments={"serviceId": "jarvis-server", "command": "id"}))
        with self.assertRaises(ProtocolError):
            validate_request(request(arguments={"serviceId": "jarvis-server", "maxLines": 501}))

    def test_validates_closed_vpn_arguments(self):
        issued = validate_request(request(operation="vpn.client.issue", arguments={"label": "My Phone"}))
        self.assertEqual(issued["arguments"], {"label": "My Phone"})
        rotated = validate_request(request(operation="vpn.client.rotate", arguments={"clientId": "vpn-0123456789ab"}))
        self.assertEqual(rotated["arguments"]["clientId"], "vpn-0123456789ab")
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.client.issue", arguments={"label": "../../root"}))
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.client.revoke", arguments={"clientId": "not-an-id"}))
        hysteria = validate_request(request(operation="vpn.hysteria2.client.issue", arguments={"label": "My iPhone"}))
        self.assertEqual(hysteria["arguments"], {"label": "My iPhone"})
        hysteria_cyrillic = validate_request(request(operation="vpn.hysteria2.client.issue", arguments={"label": "сеня"}))
        self.assertEqual(hysteria_cyrillic["arguments"], {"label": "сеня"})
        vpn_cyrillic = validate_request(request(operation="vpn.client.issue", arguments={"label": "iphone меня"}))
        self.assertEqual(vpn_cyrillic["arguments"], {"label": "iphone меня"})
        self.assertEqual(validate_request(request(operation="vpn.hysteria2.status", arguments={}))["arguments"], {})
        self.assertEqual(validate_request(request(operation="vpn.health.snapshot", arguments={}))["arguments"], {})
        self.assertEqual(validate_request(request(operation="vpn.external_probe.snapshot", arguments={"targetNode": "nl"}))["arguments"], {"targetNode": "nl"})
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.external_probe.snapshot", arguments={"targetNode": "other"}))
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.external_probe.snapshot", arguments={"targetNode": "de", "path": "/tmp/x"}))
        installed = validate_request(request(operation="vpn.external_probe.credential.install", arguments={
            "targetNode": "nl", "protocol": "vless", "credential": "vless://synthetic",
        }))
        self.assertEqual(set(installed["arguments"]), {"targetNode", "protocol", "credential"})
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.external_probe.credential.install", arguments={
                "targetNode": "nl", "protocol": "vless", "credential": "x" * 2049,
            }))
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.external_probe.credential.install", arguments={
                "targetNode": "nl", "protocol": "wireguard", "credential": "synthetic",
            }))
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.health.snapshot", arguments={"extra": 1}))
        with self.assertRaises(ProtocolError):
            validate_request(request(operation="vpn.hysteria2.restart", arguments={"port": 53}))

    def test_response_must_match_request_and_result_state(self):
        accepted = validate_request(request())
        response = {
            "version": 1,
            "requestId": REQUEST_ID,
            "operation": "service.logs.read",
            "receivedAt": NOW,
            "completedAt": NOW,
            "result": {"state": "succeeded", "data": {}},
        }
        self.assertEqual(validate_response(response, accepted), response)
        with self.assertRaises(ProtocolError):
            validate_response({**response, "operation": "host.snapshot"}, accepted)
        with self.assertRaises(ProtocolError):
            validate_response({**response, "result": {"state": "failed"}}, accepted)


if __name__ == "__main__":
    unittest.main()
