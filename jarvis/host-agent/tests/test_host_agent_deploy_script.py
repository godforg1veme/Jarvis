from pathlib import Path
import unittest


DEPLOY_SCRIPT = (
    Path(__file__).resolve().parents[2] / "deploy" / "host-agent" / "deploy.sh"
)


class HostAgentDeployScriptTests(unittest.TestCase):
    def test_runs_tests_from_complete_staged_tree_before_install_copy(self):
        script = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        test_command = 'unittest discover -s "${app_root}/host-agent/tests"'
        copy_command = 'sudo cp -a "${app_root}/host-agent/." "${agent_root}/"'

        self.assertIn(test_command, script)
        self.assertLess(script.index(test_command), script.index(copy_command))
