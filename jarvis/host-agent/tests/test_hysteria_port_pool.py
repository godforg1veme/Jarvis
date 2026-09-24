import unittest

from jarvis_host_agent.hysteria_port_pool import (
    PortPoolError,
    build_hysteria_hop_client_config,
    validate_port_pool,
)
from jarvis_host_agent.vpn_external_probe import parse_hysteria_uri


HYSTERIA = (
    "hy2://vpn-0123456789ab:synthetic-password@vpn.example.test:443/"
    "?obfs=salamander&obfs-password=synthetic-obfs&sni=vpn.example.test#Probe"
)
POOL = {
    "version": 1,
    "nodeCode": "de",
    "generation": "123e4567-e89b-42d3-a456-426614174000",
    "ports": [20011, 22229, 26549, 30013],
    "hopIntervalSeconds": 15,
}


class HysteriaPortPoolTests(unittest.TestCase):
    def test_valid_pool_is_public_bounded_and_canonical(self):
        pool = validate_port_pool(POOL, expected_node="de")
        self.assertEqual(pool["ports"], [20011, 22229, 26549, 30013])
        self.assertEqual(pool["generation"], POOL["generation"])

    def test_pool_rejects_secrets_duplicates_out_of_range_and_wrong_node(self):
        invalid = (
            {**POOL, "generation": "x", "ports": [20011] * 4},
            {**POOL, "nodeCode": "nl"},
            {**POOL, "ports": [19999, 22229, 26549, 30013]},
            {**POOL, "ports": [20011, 22229, 26549, 30013], "password": "synthetic-secret"},
            {**POOL, "ports": [22229, 20011, 26549, 30013]},
        )
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(PortPoolError):
                    validate_port_pool(value, expected_node="de")

    def test_builds_native_hysteria_config_from_public_pool(self):
        parsed = parse_hysteria_uri(HYSTERIA, expected_host="vpn.example.test")
        config = build_hysteria_hop_client_config(parsed, 18081, POOL)
        self.assertEqual(config["server"], "vpn.example.test:20011,22229,26549,30013")
        self.assertEqual(config["transport"]["udp"]["hopInterval"], "15s")
        self.assertEqual(config["socks5"]["listen"], "127.0.0.1:18081")
        self.assertNotIn("insecure", config["tls"])


if __name__ == "__main__":
    unittest.main()
