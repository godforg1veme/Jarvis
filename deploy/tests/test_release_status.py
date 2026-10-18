import importlib.util
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/release-status.py"
spec = importlib.util.spec_from_file_location("release_status", SCRIPT)
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)


class ReleaseStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "Release tests")
        self.git("config", "user.email", "release@example.invalid")
        self.git("config", "core.autocrlf", "false")
        (self.repo / "main.js").write_text("module.exports = 1;\n", encoding="utf-8")
        self.git("add", "main.js")
        self.git("commit", "-m", "initial")
        self.git("remote", "add", "origin", status.CANONICAL_REMOTE)
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True).strip()

    def inspect(self):
        return status.source_inventory(self.repo)

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), "--repo", str(self.repo), *args],
                              capture_output=True, text=True, encoding="utf-8")

    def test_clean_main_passes_check_without_changing_refs_or_files(self):
        refs_before = self.git("show-ref")
        run = self.run_cli("--check")
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertEqual(json.loads(run.stdout)["issues"], [])
        self.assertEqual(self.git("show-ref"), refs_before)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_compose_overlay_inputs_are_all_checked_against_the_release(self):
        folder = self.repo / 'deploy'
        folder.mkdir()
        base, overlay = folder / 'docker-compose.yml', folder / 'job-ocr-frozen.yml'
        base.write_text('services: {}\n')
        overlay.write_text('services: {}\n')
        self.git('add', 'deploy'); self.git('commit', '-m', 'release inputs')
        previous = self.git('rev-parse', 'HEAD')
        release, inputs = status.release_config_source(f'{base},{overlay}')
        self.assertEqual(release, self.repo)
        overlay.write_text('services: {job-ocr: {read_only: true}}\n')
        self.git('add', 'deploy'); self.git('commit', '-m', 'changed overlay')
        delta = status.git(self.repo, 'diff', '--name-only', previous, 'HEAD', *inputs)
        self.assertEqual(delta, 'deploy/job-ocr-frozen.yml')
        self.assertEqual(status.release_config_source(str(base))[1], ['deploy/docker-compose.yml'])
        for invalid in ['', 'deploy/docker-compose.yml', f'{base},', f'{base},{self.repo / "other.yml"}']:
            self.assertIsNone(status.release_config_source(invalid))

    def test_unique_foreign_commit_is_reported_and_never_merged_or_deleted(self):
        self.git("checkout", "-b", "codex/another-agent")
        (self.repo / "other.js").write_text("other task\n", encoding="utf-8")
        self.git("add", "other.js")
        self.git("commit", "-m", "other task")
        self.git("checkout", "main")
        refs_before = self.git("show-ref")
        run = self.run_cli("--check")
        data = json.loads(run.stdout)
        self.assertEqual(run.returncode, 1)
        self.assertIn("BRANCHES_NEED_REVIEW", data["issues"])
        self.assertEqual(data["source"]["branches"][0]["commitsOutsideMain"], 1)
        self.assertEqual(self.git("show-ref"), refs_before)
        self.assertFalse((self.repo / "other.js").exists())

    def test_already_merged_branch_still_requires_lifecycle_review(self):
        self.git("branch", "codex/completed")
        run = self.run_cli("--check")
        data = json.loads(run.stdout)
        self.assertEqual(run.returncode, 1)
        self.assertFalse(data["source"]["branches"][0]["needsReview"])
        self.assertIn("BRANCH_REFS_REMAIN", data["issues"])
        self.assertIn("refs/heads/codex/completed", self.git("show-ref"))

    def test_other_remotes_are_included_in_branch_review(self):
        self.git("update-ref", "refs/remotes/other/topic", "HEAD")
        rows = self.inspect()["branches"]
        self.assertTrue(any(row["ref"] == "refs/remotes/other/topic" for row in rows))

    def test_dirty_foreign_worktree_is_visible_and_untouched(self):
        worktree = self.root / "other-checkout"
        self.git("worktree", "add", "-b", "codex/active", str(worktree))
        file = worktree / "draft.txt"
        file.write_text("unfinished\n", encoding="utf-8")
        data = self.inspect()
        self.assertFalse(data["dirty"])
        self.assertTrue(any(w["dirty"] for w in data["worktrees"]))
        self.assertIn("WORKTREES_NEED_REVIEW", status.issues({"source": data}))
        self.assertEqual(file.read_text(encoding="utf-8"), "unfinished\n")

    def test_stashed_work_prevents_false_clean_success_and_is_preserved(self):
        (self.repo / "main.js").write_text("unfinished change\n", encoding="utf-8")
        self.git("stash", "push", "-m", "saved work")
        before = self.git("rev-parse", "refs/stash")
        run = self.run_cli("--check")
        data = json.loads(run.stdout)
        self.assertFalse(data["source"]["dirty"])
        self.assertEqual(data["source"]["stashCount"], 1)
        self.assertIn("STASHES_NEED_REVIEW", data["issues"])
        self.assertEqual(self.git("rev-parse", "refs/stash"), before)

    def test_desktop_text_line_endings_are_equivalent_but_binary_changes_are_not(self):
        directory = self.root / "installed"
        directory.mkdir()
        (directory / "main.js").write_bytes(b"module.exports = 1;\r\n")
        (directory / "asset.bin").write_bytes(b"\x00\r\n")
        files = {"main.js": b"module.exports = 1;\n", "asset.bin": b"\x00\n"}
        result = status.compare_files(files, directory, normalize_eol=True)
        self.assertEqual(result["changed"], 1)
        self.assertFalse(result["matches"])
        (directory / "asset.bin").write_bytes(b"\x00\n")
        self.assertTrue(status.compare_files(files, directory, normalize_eol=True)["matches"])
        (directory / "main.js").write_bytes(b"module.exports = 2;\r\n")
        self.assertFalse(status.compare_files(files, directory, normalize_eol=True)["matches"])

    def test_unicode_git_paths_and_missing_installed_file(self):
        path = self.repo / "renderer/Привет.js"
        path.parent.mkdir()
        path.write_text("hello\n", encoding="utf-8")
        self.git("add", "renderer")
        self.git("commit", "-m", "unicode file")
        files = status.git_payload(self.repo, "HEAD", lambda p: p.startswith("renderer/"))
        self.assertIn("renderer/Привет.js", files)
        missing = status.compare_files(files, self.root / "missing")
        self.assertEqual(missing["missing"], 1)
        self.assertFalse(missing["matches"])

    def test_vps_old_source_cannot_pass_using_its_own_stale_tracking_ref(self):
        source = self.inspect()
        stale = dict(source, head="0" * 40, githubMain="0" * 40)
        report = {"source": source, "vps": {"de": {"source": stale, "issues": []}}}
        self.assertIn("VPS_DE_NEEDS_REVIEW", status.issues(report))

    def test_failed_host_or_different_release_inputs_prevent_full_success(self):
        source = self.inspect()
        self.assertIn("VPS_NL_NEEDS_REVIEW", status.issues({"source": source,
                      "vps": {"nl": {"error": "VPS_INVENTORY_UNAVAILABLE"}}}))
        runtime = {"server": {"matches": True, "releaseInputsMatch": False, "health": "healthy"}}
        self.assertIn("SERVER_RELEASE_DIFFERS", status.issues({"source": source, "runtime": runtime}))

    def test_uncanonical_origin_is_rejected_without_exposing_its_value(self):
        self.git("remote", "set-url", "origin", "https://synthetic-secret@example.invalid/repo")
        run = self.run_cli("--fetch", "--check")
        self.assertEqual(run.returncode, 2)
        self.assertEqual(json.loads(run.stdout), {"error": "ORIGIN_NOT_CANONICAL"})
        self.assertNotIn("synthetic-secret", run.stdout + run.stderr)

    def test_native_code_changes_are_detected_while_packager_branding_is_ignored(self):
        def image(code, resources):
            data = bytearray(160)
            data[:2] = b"MZ"
            struct.pack_into("<I", data, 60, 64)
            data[64:68] = b"PE\0\0"
            struct.pack_into("<H", data, 70, 2)
            # No optional header is needed for the section reader fixture.
            data.extend(b"\0" * 8)
            for index, (name, body) in enumerate(((b".text", code), (b".rsrc", resources))):
                table = 88 + index * 40
                data[table:table + len(name)] = name
                struct.pack_into("<II", data, table + 16, len(body), len(data))
                data.extend(body)
            return data
        one = self.root / "electron.exe"
        two = self.root / "Jarvis.exe"
        one.write_bytes(image(b"native-code", b"electron-icon"))
        two.write_bytes(image(b"native-code", b"jarvis-icon"))
        self.assertEqual(status.pe_code_sections(one), status.pe_code_sections(two))
        two.write_bytes(image(b"different-code", b"jarvis-icon"))
        self.assertNotEqual(status.pe_code_sections(one), status.pe_code_sections(two))
        two.write_bytes(b"not an executable")
        with self.assertRaises(status.InventoryError):
            status.pe_code_sections(two)

    def test_unavailable_desktop_does_not_discard_source_inventory(self):
        run = self.run_cli("--desktop-app", str(self.root / "not-installed"), "--check")
        data = json.loads(run.stdout)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(data["source"]["head"], self.git("rev-parse", "HEAD"))
        self.assertIn("error", data["desktop"])
        self.assertIn("DESKTOP_PAYLOAD_DIFFERS", data["issues"])

    def test_fetch_discovers_remote_work_without_updating_main_or_working_files(self):
        bare = self.root / "origin.git"
        subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)],
                       check=True, capture_output=True)
        self.git("config", f"url.{bare.as_uri()}.insteadOf", status.CANONICAL_REMOTE)
        self.git("push", "origin", "main")
        writer = self.root / "writer"
        subprocess.run(["git", "clone", str(bare), str(writer)], check=True, capture_output=True)
        def write_git(*args):
            return subprocess.check_output(["git", "-C", str(writer), *args], text=True).strip()
        write_git("config", "user.name", "Other writer")
        write_git("config", "user.email", "other@example.invalid")
        write_git("checkout", "-b", "codex/remote-work")
        (writer / "remote.txt").write_text("unmerged\n", encoding="utf-8")
        write_git("add", "remote.txt")
        write_git("commit", "-m", "remote work")
        write_git("push", "origin", "codex/remote-work")
        before = self.git("rev-parse", "HEAD")
        run = self.run_cli("--fetch", "--check")
        data = json.loads(run.stdout)
        self.assertEqual(run.returncode, 1)
        self.assertTrue(any(b["ref"] == "refs/remotes/origin/codex/remote-work" and b["needsReview"]
                            for b in data["source"]["branches"]))
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertFalse((self.repo / "remote.txt").exists())


if __name__ == "__main__":
    unittest.main()
