from pathlib import Path
import unittest


DEPLOY_SCRIPT = (
    Path(__file__).resolve().parents[2] / "deploy" / "host-agent" / "deploy.sh"
)
PROBE_INSTALL_SCRIPT = (
    Path(__file__).resolve().parents[2] / "deploy" / "vpn" / "install-probe-units.sh"
)
WINDOWS_DEPLOY_SCRIPT = (
    Path(__file__).resolve().parents[2] / "scripts" / "deployHostAgent.ps1"
)


class HostAgentDeployScriptTests(unittest.TestCase):
    def test_runs_tests_from_complete_staged_tree_before_install_copy(self):
        script = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        test_command = 'unittest discover -s "${app_root}/host-agent/tests"'
        copy_command = 'sudo cp -a "${app_root}/host-agent/." "${agent_root}/"'

        self.assertIn(test_command, script)
        self.assertLess(script.index(test_command), script.index(copy_command))

    def test_host_agent_guard_runs_before_tests_copy_and_restart(self):
        script = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        guard_command = '"${app_root}/deploy/scripts/verify-source-checkout.py" source "${app_root}"'
        test_command = 'unittest discover -s "${app_root}/host-agent/tests"'
        copy_command = 'sudo cp -a "${app_root}/host-agent/." "${agent_root}/"'
        restart_command = 'sudo systemctl restart jarvis-host-agent'

        self.assertIn(guard_command, script)
        self.assertLess(script.index(guard_command), script.index(test_command))
        self.assertLess(script.index(guard_command), script.index(copy_command))
        self.assertLess(script.index(guard_command), script.index(restart_command))

    def test_probe_unit_installer_checks_source_before_install_and_reload(self):
        script = PROBE_INSTALL_SCRIPT.read_text(encoding="utf-8")
        guard_command = '"${app_root}/deploy/scripts/verify-source-checkout.py" source "${app_root}"'

        self.assertIn(guard_command, script)
        self.assertLess(script.index(guard_command), script.index("install -o root"))
        self.assertLess(script.index(guard_command), script.index("systemctl daemon-reload"))

    def test_windows_deploy_checks_source_before_tests_packaging_or_upload(self):
        script = WINDOWS_DEPLOY_SCRIPT.read_text(encoding="utf-8")
        guard_script = "verify-source-checkout.py"

        self.assertIn("$repositoryRoot", script)
        self.assertIn(guard_script, script)
        guard_index = script.index(guard_script)
        for action in (
            "Running local Host Agent unit tests",
            "tar --exclude=",
            "& ssh $HostName",
            "& scp $tempTar",
        ):
            self.assertLess(guard_index, script.index(action))

        remote_preflight_index = script.index("& ssh $HostName $remotePreflight")
        self.assertLess(remote_preflight_index, script.index("Ensuring remote directories exist"))
        self.assertLess(remote_preflight_index, script.index("& scp $tempTar"))
