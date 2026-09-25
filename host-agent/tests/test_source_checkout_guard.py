from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CANONICAL_REMOTE = "https://github.com/godforg1veme/Jarvis.git"
GUARD_SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "deploy"
    / "scripts"
    / "verify-source-checkout.py"
)


class SourceCheckoutGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.bare = self.root / "origin.git"
        self.repo = self.root / "checkout"

        self.git(self.root, "init", "--bare", "--initial-branch=main", str(self.bare))
        self.repo.mkdir()
        self.git(self.repo, "init", "--initial-branch=main")
        self.git(self.repo, "config", "user.name", "Checkout test")
        self.git(self.repo, "config", "user.email", "checkout-test@example.invalid")
        (self.repo / "README.md").write_text("checkout test\n", encoding="utf-8")
        self.git(self.repo, "add", "README.md")
        self.git(self.repo, "commit", "-m", "initial")
        self.git(self.repo, "remote", "add", "origin", CANONICAL_REMOTE)
        self.git(
            self.repo,
            "config",
            f"url.{self.bare.as_uri()}.insteadOf",
            CANONICAL_REMOTE,
        )
        self.git(self.repo, "push", "--set-upstream", "origin", "main")
        self.git(self.repo, "fetch", "--prune", "origin", "main")

    def git(self, cwd, *args, check=True):
        return subprocess.run(
            ["git", *args],
            cwd=cwd,
            check=check,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def run_guard(self, *args):
        return subprocess.run(
            [sys.executable, str(GUARD_SCRIPT), *args],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def assert_source_fails(self, reason):
        result = self.run_guard("source", str(self.repo))
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(reason, result.stderr)

    def commit_file(self, filename, content, message):
        (self.repo / filename).write_text(content, encoding="utf-8")
        self.git(self.repo, "add", filename)
        self.git(self.repo, "commit", "-m", message)
        return self.git(self.repo, "rev-parse", "HEAD").stdout.strip()

    def test_current_clean_main_passes_and_prints_only_verified_sha(self):
        expected_sha = self.git(self.repo, "rev-parse", "HEAD").stdout.strip()

        result = self.run_guard("source", str(self.repo))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), expected_sha)
        self.assertEqual(result.stderr, "")

    def test_modified_tracked_file_is_rejected(self):
        (self.repo / "README.md").write_text("local edit\n", encoding="utf-8")

        self.assert_source_fails("worktree is not clean")

    def test_untracked_file_is_rejected(self):
        (self.repo / "local-note.txt").write_text("local data\n", encoding="utf-8")

        self.assert_source_fails("worktree is not clean")

    def test_vps_operation_state_paths_are_ignored_by_the_repository(self):
        repository_root = GUARD_SCRIPT.parents[2]
        paths = (
            ".backups/example.tar.gz",
            ".deploy-backups/example.tar.gz",
            ".deploy-stage-vpn/example.conf",
            "pendingCommandId",
            "deploy/.env",
            "deploy/secrets/example-token",
        )

        for path in paths:
            with self.subTest(path=path):
                result = subprocess.run(
                    ["git", "-C", str(repository_root), "check-ignore", "--quiet", "--no-index", path],
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                self.assertEqual(result.returncode, 0, f"{path} is not ignored")

    def test_nested_jarvis_directory_is_rejected(self):
        (self.repo / "jarvis").mkdir()

        self.assert_source_fails("nested jarvis directory")

    def test_checked_out_topic_branch_is_rejected(self):
        self.git(self.repo, "checkout", "-b", "topic")

        self.assert_source_fails("checked out branch is not main")

    def test_extra_local_branch_is_rejected(self):
        self.git(self.repo, "branch", "topic")

        self.assert_source_fails("local branches must contain only main")

    def test_stale_main_is_rejected_after_fetching_new_origin_main(self):
        writer = self.root / "writer"
        self.git(self.root, "clone", str(self.bare), str(writer))
        self.git(writer, "config", "user.name", "Checkout test")
        self.git(writer, "config", "user.email", "checkout-test@example.invalid")
        (writer / "remote-note.txt").write_text("new remote commit\n", encoding="utf-8")
        self.git(writer, "add", "remote-note.txt")
        self.git(writer, "commit", "-m", "advance main")
        self.git(writer, "push", "origin", "main")

        result = self.run_guard("source", str(self.repo))

        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("does not match origin/main", result.stderr)

    def test_wrong_origin_is_rejected(self):
        self.git(self.repo, "remote", "set-url", "origin", "https://example.invalid/other.git")

        self.assert_source_fails("origin URL is not canonical")

    def test_stale_remote_tracking_refs_are_pruned(self):
        self.git(self.repo, "update-ref", "refs/remotes/origin/old-topic", "HEAD")

        result = self.run_guard("source", str(self.repo))

        self.assertEqual(result.returncode, 0, result.stderr)
        refs = self.git(
            self.repo,
            "for-each-ref",
            "--format=%(refname)",
            "refs/remotes",
        ).stdout.splitlines()
        remote_branches = [ref for ref in refs if ref != "refs/remotes/origin/HEAD"]
        self.assertEqual(remote_branches, ["refs/remotes/origin/main"])

    def test_valid_recorded_release_ancestor_passes(self):
        recorded_sha = self.git(self.repo, "rev-parse", "HEAD").stdout.strip()
        self.commit_file("release-note.txt", "later main commit\n", "advance main")
        self.git(self.repo, "push", "origin", "main")
        self.git(self.repo, "checkout", "--detach", recorded_sha)

        result = self.run_guard("release", recorded_sha, str(self.repo))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), recorded_sha)

    def test_release_rejects_a_sha_that_does_not_match_head(self):
        head = self.git(self.repo, "rev-parse", "HEAD").stdout.strip()
        other_sha = "0" * 40 if head != "0" * 40 else "1" * 40

        result = self.run_guard("release", other_sha, str(self.repo))

        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("HEAD does not match recorded release SHA", result.stderr)

    def test_release_rejects_commit_outside_main(self):
        self.git(self.repo, "checkout", "-b", "unpublished")
        unpushed_sha = self.commit_file("private-change.txt", "outside main\n", "unpublished change")
        self.git(self.repo, "checkout", "--detach", unpushed_sha)

        result = self.run_guard("release", unpushed_sha, str(self.repo))

        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("is not reachable from origin/main", result.stderr)


if __name__ == "__main__":
    unittest.main()
