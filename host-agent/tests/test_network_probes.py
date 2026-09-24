import socket
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from jarvis_host_agent.network_probes import probe_dns, probe_outbound_https


class NetworkProbesTests(unittest.TestCase):
    @patch("socket.getaddrinfo")
    def test_dns_probe_success(self, mock_getaddrinfo):
        mock_getaddrinfo.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))
        ]
        self.assertEqual(probe_dns("cloudflare.com"), "healthy")

    @patch("jarvis_host_agent.network_probes._resolve_dns")
    def test_dns_probe_timeout(self, mock_resolve):
        import time
        def slow_resolve(target):
            time.sleep(1)
            return []
        mock_resolve.side_effect = slow_resolve
        self.assertEqual(probe_dns("cloudflare.com", timeout=0.05), "unavailable")

    @patch("socket.getaddrinfo")
    def test_dns_probe_gaierror_unavailable(self, mock_getaddrinfo):
        mock_getaddrinfo.side_effect = socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        self.assertEqual(probe_dns("nonexistent.invalid"), "unavailable")

    def test_dns_probe_does_not_mutate_global_socket_timeout(self):
        before = socket.getdefaulttimeout()
        probe_dns("cloudflare.com")
        after = socket.getdefaulttimeout()
        self.assertEqual(before, after)

    def test_dns_probe_invalid_target(self):
        self.assertEqual(probe_dns(""), "unknown")
        self.assertEqual(probe_dns(None), "unknown")

    @patch("urllib.request.urlopen")
    def test_outbound_https_probe_success_204(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 204
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp
        self.assertEqual(probe_outbound_https("https://cp.cloudflare.com/generate_204"), "healthy")

    @patch("urllib.request.urlopen")
    def test_outbound_https_probe_success_200(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp
        self.assertEqual(probe_outbound_https("https://1.1.1.1"), "healthy")

    @patch("urllib.request.urlopen")
    def test_outbound_https_probe_degraded_on_http_500(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            "https://cp.cloudflare.com/generate_204", 500, "Internal Server Error", {}, None
        )
        self.assertEqual(probe_outbound_https(), "degraded")

    @patch("urllib.request.urlopen")
    def test_outbound_https_probe_unavailable_on_urlerror(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused")
        self.assertEqual(probe_outbound_https(), "unavailable")

    @patch("urllib.request.urlopen")
    def test_outbound_https_probe_unavailable_on_timeout(self, mock_urlopen):
        mock_urlopen.side_effect = TimeoutError("Timed out")
        self.assertEqual(probe_outbound_https(), "unavailable")

    def test_outbound_https_probe_invalid_target(self):
        self.assertEqual(probe_outbound_https("http://insecure.test"), "unknown")
        self.assertEqual(probe_outbound_https(""), "unknown")


if __name__ == "__main__":
    unittest.main()
