import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('hopping_persistence', Path(__file__).resolve().parents[2] / 'deploy/vpn/persist-port-hopping.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PortHoppingPersistenceTests(unittest.TestCase):
    def test_filter_preserved_and_rule_idempotent(self):
        original = '# existing\n*filter\n:INPUT DROP [0:0]\nCOMMIT\n'
        rendered = module.render(original, '87.120.187.109', '20000:50000', '443')
        self.assertTrue(rendered.endswith(original))
        self.assertIn('-j DNAT --to-destination 87.120.187.109:443', rendered)
        self.assertEqual(module.render(rendered, '87.120.187.109', '20000:50000', '443'), rendered)

    def test_existing_nat_and_unrelated_rules_preserved(self):
        original = '*nat\n:PREROUTING ACCEPT [0:0]\n-A OUTPUT -j ACCEPT\nCOMMIT\n*filter\nCOMMIT\n'
        rendered = module.render(original, '94.183.208.56', '20000:50000', '443')
        self.assertEqual(rendered.count('*nat'), 1)
        self.assertIn('-A OUTPUT -j ACCEPT', rendered)
        self.assertTrue(rendered.endswith('*filter\nCOMMIT\n'))

    def test_invalid_address_or_ports_rejected(self):
        for address, ports, target in [('999.1.1.1', '20000:50000', '443'), ('1.1.1.1', '50000:20000', '443'), ('1.1.1.1', '1:65535', '443'), ('1.1.1.1', '20000:50000', '0')]:
            with self.assertRaises(ValueError):
                module.render('*filter\nCOMMIT\n', address, ports, target)


if __name__ == '__main__':
    unittest.main()
