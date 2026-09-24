import copy
import json
import unittest

from jarvis_host_agent.vpn_incident_classifier import classify_vpn_incident


def healthy_snapshot():
    return {
        "host": "healthy",
        "network": {"dns": "healthy", "outbound": "healthy"},
        "xray": {"service": "healthy", "config": "healthy", "listener": "healthy", "protocolProbe": "unknown"},
        "hysteria2": {
            "service": "healthy",
            "config": "healthy",
            "listener": "healthy",
            "auth": "healthy",
            "authEndpoint": "healthy",
            "authCredentialProbe": "healthy",
            "protocolProbe": "unknown",
        },
    }


def set_path(snapshot, path, value):
    parts = path.split(".")
    current = snapshot
    for part in parts[:-1]:
        current = current[part]
    current[parts[-1]] = value


class VpnIncidentClassifierTests(unittest.TestCase):
    def test_table_driven_incidents(self):
        cases = (
            ("host", "unavailable", "HOST_UNAVAILABLE"),
            ("network.dns", "unavailable", "HOST_DNS_FAILURE"),
            ("network.outbound", "unavailable", "HOST_OUTBOUND_FAILURE"),
            ("xray.config", "unavailable", "XRAY_CONFIG_FAILURE"),
            ("xray.service", "unavailable", "XRAY_SERVICE_FAILURE"),
            ("xray.listener", "unavailable", "XRAY_LISTENER_FAILURE"),
            ("hysteria2.config", "unavailable", "HYSTERIA2_CONFIG_FAILURE"),
            ("hysteria2.service", "unavailable", "HYSTERIA2_SERVICE_FAILURE"),
            ("hysteria2.listener", "unavailable", "HYSTERIA2_LISTENER_FAILURE"),
            ("hysteria2.authEndpoint", "unavailable", "HYSTERIA2_AUTH_ENDPOINT_FAILURE"),
            ("hysteria2.authCredentialProbe", "degraded", "HYSTERIA2_AUTH_CREDENTIAL_FAILURE"),
        )
        for path, status, expected in cases:
            with self.subTest(path=path, status=status):
                snapshot = healthy_snapshot()
                set_path(snapshot, path, status)
                result = classify_vpn_incident(snapshot)
                self.assertEqual(result["primary"]["code"], expected)

    def test_healthy_with_unverified_protocols_has_no_incident(self):
        result = classify_vpn_incident(healthy_snapshot())
        self.assertEqual(result["state"], "healthy")
        self.assertIsNone(result["primary"])
        self.assertEqual([item["code"] for item in result["secondarySignals"]], [
            "XRAY_PROTOCOL_UNVERIFIED", "HYSTERIA2_PROTOCOL_UNVERIFIED",
        ])
        self.assertTrue(all(item["severity"] == "info" for item in result["secondarySignals"]))

    def test_auth_dependency_wins_while_hysteria_service_is_healthy(self):
        snapshot = healthy_snapshot()
        snapshot["hysteria2"]["auth"] = "unavailable"
        snapshot["hysteria2"]["authEndpoint"] = "unavailable"
        snapshot["hysteria2"]["authCredentialProbe"] = "unavailable"
        result = classify_vpn_incident(snapshot)
        self.assertEqual(result["primary"]["code"], "HYSTERIA2_AUTH_ENDPOINT_FAILURE")
        self.assertIn({"path": "hysteria2.service", "status": "healthy"}, result["primary"]["evidence"])

    def test_config_failure_explains_service_and_listener_failure(self):
        snapshot = healthy_snapshot()
        snapshot["xray"].update({"config": "unavailable", "service": "unavailable", "listener": "unavailable"})
        self.assertEqual(classify_vpn_incident(snapshot)["primary"]["code"], "XRAY_CONFIG_FAILURE")

    def test_two_local_stack_failures_are_correlated_even_with_outbound_failure(self):
        snapshot = healthy_snapshot()
        snapshot["network"]["outbound"] = "unavailable"
        snapshot["xray"]["service"] = "unavailable"
        snapshot["hysteria2"]["service"] = "unavailable"
        result = classify_vpn_incident(snapshot)
        self.assertEqual(result["primary"]["code"], "VPN_MULTI_STACK_FAILURE")
        self.assertEqual(result["primary"]["severity"], "critical")

    def test_one_stack_failure_is_not_hidden_by_unrelated_outbound_failure(self):
        snapshot = healthy_snapshot()
        snapshot["network"]["outbound"] = "unavailable"
        snapshot["xray"]["listener"] = "unavailable"
        self.assertEqual(classify_vpn_incident(snapshot)["primary"]["code"], "XRAY_LISTENER_FAILURE")

    def test_unknown_required_status_is_safe_unknown_incident(self):
        snapshot = healthy_snapshot()
        snapshot["xray"]["service"] = "unknown"
        result = classify_vpn_incident(snapshot)
        self.assertEqual(result["primary"]["code"], "UNKNOWN_VPN_FAILURE")
        self.assertEqual(result["primary"]["confidence"], "low")

    def test_optional_missing_credential_probe_is_not_an_incident(self):
        snapshot = healthy_snapshot()
        snapshot["hysteria2"]["authCredentialProbe"] = "unknown"
        self.assertEqual(classify_vpn_incident(snapshot)["state"], "healthy")

    def test_failed_protocol_probe_is_uncertain_not_healthy_or_critical(self):
        snapshot = healthy_snapshot()
        snapshot["xray"]["protocolProbe"] = "unavailable"
        result = classify_vpn_incident(snapshot)
        self.assertEqual(result["primary"]["code"], "UNKNOWN_VPN_FAILURE")
        self.assertEqual(result["primary"]["severity"], "warning")

    def test_malformed_snapshots_are_bounded_and_secret_free(self):
        hostile = {
            "host": "healthy",
            "password": "vless://secret-value",
            "privatePath": "/etc/jarvis-vpn/hysteria2-state.json",
            "uuid": "11111111-1111-4111-8111-111111111111",
            "uri": "hy2://secret@host",
        }
        for value in (None, [], {}, hostile, {**healthy_snapshot(), "extra": hostile}):
            with self.subTest(value_type=type(value).__name__):
                encoded = json.dumps(classify_vpn_incident(value), sort_keys=True)
                self.assertIn("VPN_SNAPSHOT_INVALID", encoded)
                for secret in ("secret-value", "/etc/jarvis-vpn", "11111111", "hy2://", "vless://"):
                    self.assertNotIn(secret, encoded)

    def test_input_is_not_mutated_and_key_order_does_not_change_result(self):
        snapshot = healthy_snapshot()
        before = copy.deepcopy(snapshot)
        reordered = {key: snapshot[key] for key in reversed(tuple(snapshot))}
        self.assertEqual(classify_vpn_incident(snapshot), classify_vpn_incident(reordered))
        self.assertEqual(snapshot, before)

    def test_evidence_is_closed_and_bounded(self):
        snapshot = healthy_snapshot()
        snapshot["xray"]["service"] = "unavailable"
        evidence = classify_vpn_incident(snapshot)["primary"]["evidence"]
        self.assertLessEqual(len(evidence), 12)
        self.assertTrue(all(set(item) == {"path", "status"} for item in evidence))
        self.assertTrue(all(item["status"] in {"healthy", "degraded", "unavailable", "unknown"} for item in evidence))


if __name__ == "__main__":
    unittest.main()
