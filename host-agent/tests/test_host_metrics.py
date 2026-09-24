import unittest
from unittest.mock import patch
from jarvis_host_agent import host_metrics


class HostMetricsTests(unittest.TestCase):
    def test_cpu_delta_does_not_double_count_guest_and_network_is_aggregate(self):
        host_metrics._previous_cpu = (100, 50)
        files = {
            '/proc/stat': 'cpu 80 0 20 90 10 0 0 0 900 900\n',
            '/proc/meminfo': 'MemTotal: 1024 kB\nSwapTotal: 100 kB\nSwapFree: 25 kB\n',
            '/proc/net/dev': 'header\nheader\nlo: 100 0 0 0 0 0 0 0 100\neth0: 200 0 0 0 0 0 0 0 300\n',
        }
        with patch('pathlib.Path.read_text', lambda path: files[path.as_posix()]):
            result = host_metrics.extra_metrics()
        self.assertEqual(result['cpuUsedPercent'], 50)
        self.assertEqual(result['swapUsedPercent'], 75)
        self.assertEqual(result['memoryTotalBytes'], 1024 * 1024)
        self.assertEqual(result['networkRxBytes'], 200)
        self.assertEqual(result['networkTxBytes'], 300)

    def test_missing_proc_is_not_reported_as_zero_usage(self):
        with patch('pathlib.Path.read_text', side_effect=OSError):
            self.assertEqual(host_metrics.extra_metrics(), {})
