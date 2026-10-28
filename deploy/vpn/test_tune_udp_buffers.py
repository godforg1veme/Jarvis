import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import json
import os

SPEC = importlib.util.spec_from_file_location('tuning', Path(__file__).with_name('tune-udp-buffers.py'))
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class TuningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.root = base / 'sysctl'
        self.root.mkdir()
        self.dropin = base / 'managed.conf'
        self.journal = base / 'journal.json'
        mod.set_values(self.root, {'rmem_max': 212992, 'wmem_max': 9000000})

    def tearDown(self):
        self.temp.cleanup()

    def test_apply_idempotent_and_rollback(self):
        self.dropin.write_text('previous\n')
        expected = {'rmem_max': mod.TARGET, 'wmem_max': 9000000}
        self.assertEqual(mod.apply(self.root, self.dropin, self.journal), expected)
        before = self.journal.read_text()
        self.assertEqual(mod.apply(self.root, self.dropin, self.journal), expected)
        self.assertEqual(self.journal.read_text(), before)
        self.assertEqual(mod.rollback(self.root, self.dropin, self.journal), {'rmem_max': 212992, 'wmem_max': 9000000})
        self.assertEqual(self.dropin.read_text(), 'previous\n')
        self.assertFalse(self.journal.exists())

    def test_foreign_change_blocks_rollback(self):
        mod.apply(self.root, self.dropin, self.journal)
        self.dropin.write_text('foreign\n')
        with self.assertRaises(RuntimeError):
            mod.rollback(self.root, self.dropin, self.journal)
        self.assertTrue(self.journal.exists())

    def test_apply_recovers_after_partial_runtime_write(self):
        original = mod.set_values
        def partial(root, wanted):
            (root / 'rmem_max').write_text(str(wanted['rmem_max']))
            raise OSError('interrupted')
        with mock.patch.object(mod, 'set_values', side_effect=partial):
            with self.assertRaises(OSError):
                mod.apply(self.root, self.dropin, self.journal)
        self.assertEqual(json.loads(self.journal.read_text())['phase'], 'applying')
        self.assertEqual(mod.apply(self.root, self.dropin, self.journal)['rmem_max'], mod.TARGET)

    def test_rollback_recovers_after_partial_runtime_write(self):
        self.dropin.write_text('previous\n')
        self.dropin.chmod(0o600)
        mod.apply(self.root, self.dropin, self.journal)
        def partial(root, wanted):
            (root / 'rmem_max').write_text(str(wanted['rmem_max']))
            raise OSError('interrupted')
        with mock.patch.object(mod, 'set_values', side_effect=partial):
            with self.assertRaises(OSError):
                mod.rollback(self.root, self.dropin, self.journal)
        self.assertEqual(json.loads(self.journal.read_text())['phase'], 'rolling_back')
        mod.rollback(self.root, self.dropin, self.journal)
        self.assertEqual(self.dropin.read_text(), 'previous\n')
        if os.name != 'nt':
            self.assertEqual(self.dropin.stat().st_mode & 0o777, 0o600)

    def test_foreign_runtime_change_blocks_recovery(self):
        def interrupted(root, wanted):
            raise OSError('interrupted')
        with mock.patch.object(mod, 'set_values', side_effect=interrupted):
            with self.assertRaises(OSError):
                mod.apply(self.root, self.dropin, self.journal)
        (self.root / 'rmem_max').write_text('123456\n')
        with self.assertRaises(RuntimeError):
            mod.apply(self.root, self.dropin, self.journal)

    def test_rollback_recovers_when_original_dropin_was_absent(self):
        mod.set_values(self.root, {'rmem_max': 212992, 'wmem_max': 212992})
        mod.apply(self.root, self.dropin, self.journal)
        def partial(root, wanted):
            (root / 'rmem_max').write_text(str(wanted['rmem_max']))
            raise OSError('interrupted')
        with mock.patch.object(mod, 'set_values', side_effect=partial):
            with self.assertRaises(OSError):
                mod.rollback(self.root, self.dropin, self.journal)
        self.assertFalse(self.dropin.exists())
        self.assertEqual(mod.rollback(self.root, self.dropin, self.journal),
                         {'rmem_max': 212992, 'wmem_max': 212992})


if __name__ == '__main__':
    unittest.main()
