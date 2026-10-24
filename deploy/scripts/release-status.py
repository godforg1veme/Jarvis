#!/usr/bin/env python3
"""Read-only release inventory. --fetch refreshes Git refs; nothing is deployed."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import struct
import sys
import time

CANONICAL_REMOTE = "https://github.com/godforg1veme/Jarvis.git"
DESKTOP_DIRS = {"actions", "agents", "assets", "cloud", "desktop", "renderer", "shared",
                "startup", "tools", "tts", "vision", "voice"}


class InventoryError(Exception):
    pass


def release_config_source(configs):
    """Resolve one release and every Compose input, including overlays."""
    if not isinstance(configs, str) or not configs:
        return None
    paths = [Path(value) for value in configs.split(',')]
    if any(not path.is_absolute() for path in paths):
        return None
    try:
        deploy_dir = paths[0].parent.resolve(strict=True)
        release = deploy_dir.parent
        inputs = []
        for path in paths:
            target = path.resolve(strict=True)
            if not target.is_file():
                return None
            target.relative_to(deploy_dir)
            logical = Path(os.path.normpath(str(path))).relative_to(release).as_posix()
            inputs.append(logical)
            # A symlink's target is also an input: changing either tracked path
            # must invalidate the installed release comparison.
            actual = target.relative_to(release).as_posix()
            if actual != logical:
                inputs.append(actual)
    except (OSError, RuntimeError, ValueError):
        return None
    return release, list(dict.fromkeys(inputs))


def release_input_delta(repo, revision, ref, compose_inputs):
    # Local overlays may exist only in the immutable release. Always treat
    # inputs as paths, including those absent from the source checkout.
    return git(repo, "diff", "--name-only", revision, ref, "--", "server", "ops-ui", "shared",
               "deploy/server.Dockerfile", *compose_inputs)


def command(args, *, cwd=None, input=None, binary=False):
    try:
        result = subprocess.run(args, cwd=cwd, input=input, capture_output=True,
                                text=not binary, encoding=None if binary else "utf-8",
                                errors=None if binary else "replace", timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        raise InventoryError("COMMAND_UNAVAILABLE") from None
    if result.returncode:
        # stderr can contain tokens from a misconfigured remote; never repeat it.
        raise InventoryError("COMMAND_FAILED")
    return result.stdout


def git(repo, *args):
    return command(["git", "-C", str(repo), *args]).strip()


def git_payload(repo, ref, select):
    rows = git(repo, "ls-tree", "-r", "-z", ref)
    entries = []
    for row in rows.split("\0"):
        if not row:
            continue
        header, path = row.split("\t", 1)
        _, kind, oid = header.split()
        if kind == "blob" and select(path):
            entries.append((oid, path))
    if not entries:
        raise InventoryError("PAYLOAD_EMPTY")
    raw = command(["git", "-C", str(repo), "cat-file", "--batch"],
                  input=("\n".join(oid for oid, _ in entries) + "\n").encode(), binary=True)
    stream = io.BytesIO(raw)
    files = {}
    for _, path in entries:
        header = stream.readline().split()
        if len(header) != 3 or header[1] != b"blob":
            raise InventoryError("PAYLOAD_INVALID")
        files[path] = stream.read(int(header[2]))
        if stream.read(1) != b"\n":
            raise InventoryError("PAYLOAD_INVALID")
    return files


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pe_code_sections(path):
    """Ignore branding/version resources and signing metadata, retain native code."""
    data = path.read_bytes()
    if len(data) < 64 or data[:2] != b"MZ":
        raise InventoryError("DESKTOP_NATIVE_INVALID")
    offset = struct.unpack_from("<I", data, 60)[0]
    if offset + 24 > len(data) or data[offset:offset + 4] != b"PE\0\0":
        raise InventoryError("DESKTOP_NATIVE_INVALID")
    count = struct.unpack_from("<H", data, offset + 6)[0]
    optional_size = struct.unpack_from("<H", data, offset + 20)[0]
    table = offset + 24 + optional_size
    if not 1 <= count <= 96 or table + count * 40 > len(data):
        raise InventoryError("DESKTOP_NATIVE_INVALID")
    sections = {}
    for index in range(count):
        section = table + index * 40
        name = data[section:section + 8].rstrip(b"\0")
        size, start = struct.unpack_from("<II", data, section + 16)
        if start + size > len(data):
            raise InventoryError("DESKTOP_NATIVE_INVALID")
        if name != b".rsrc":
            sections[name.decode("ascii")] = digest(data[start:start + size])
    if ".text" not in sections:
        raise InventoryError("DESKTOP_NATIVE_INVALID")
    return sections


def compare_files(files, directory, prefix="", *, normalize_eol=False):
    missing = changed = 0
    for path, data in files.items():
        relative = path.removeprefix(prefix)
        target = directory / relative
        try:
            actual = target.read_bytes()
        except FileNotFoundError:
            missing += 1
            continue
        except OSError:
            raise InventoryError("INSTALLED_FILES_UNREADABLE") from None
        if normalize_eol:
            # Git stores LF; the Windows checkout and builder commonly use CRLF.
            try:
                actual.decode("utf-8")
                data.decode("utf-8")
                if b"\0" not in actual and b"\0" not in data:
                    actual = actual.replace(b"\r\n", b"\n")
                    data = data.replace(b"\r\n", b"\n")
            except UnicodeError:
                pass
        changed += actual != data
    return {"filesChecked": len(files), "missing": missing, "changed": changed,
            "matches": missing == 0 and changed == 0}


def branch_inventory(repo, base="origin/main"):
    result = []
    rows = git(repo, "for-each-ref", "--format=%(refname)\t%(committerdate:unix)\t%(symref)",
               "refs/heads", "refs/remotes")
    for row in rows.splitlines():
        # git() strips final whitespace, so a final empty symref field may be absent.
        fields = row.split("\t")
        ref, timestamp = fields[:2]
        symbolic = fields[2] if len(fields) > 2 else ""
        if symbolic or ref in {"refs/heads/main", "refs/remotes/origin/main"}:
            continue
        behind, ahead = map(int, git(repo, "rev-list", "--left-right", "--count", f"{base}...{ref}").split())
        result.append({"ref": ref, "commitsOutsideMain": ahead, "commitsBehindMain": behind,
                       "tipAgeDays": max(0, int((time.time() - int(timestamp)) / 86400)),
                       "needsReview": ahead > 0})
    return result


def source_inventory(repo, fetch=False):
    if Path(git(repo, "rev-parse", "--show-toplevel")).resolve() != repo:
        raise InventoryError("NOT_REPOSITORY_ROOT")
    if git(repo, "config", "--get", "remote.origin.url") != CANONICAL_REMOTE:
        raise InventoryError("ORIGIN_NOT_CANONICAL")
    if fetch:
        git(repo, "fetch", "--prune", "origin")
    ahead, behind = map(int, git(repo, "rev-list", "--left-right", "--count", "HEAD...origin/main").split())
    status = git(repo, "status", "--porcelain=v1", "--untracked-files=all")
    worktrees = []
    for block in git(repo, "worktree", "list", "--porcelain").split("\n\n"):
        fields = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
        if "worktree" in fields:
            path = fields["worktree"]
            # Inspect attached checkouts without switching them or altering their state.
            try:
                dirty = bool(git(path, "status", "--porcelain=v1", "--untracked-files=all"))
            except InventoryError:
                dirty = None
            worktrees.append({"path": path, "branch": fields.get("branch"), "dirty": dirty})
    return {"head": git(repo, "rev-parse", "HEAD"), "githubMain": git(repo, "rev-parse", "origin/main"),
            "branch": git(repo, "branch", "--show-current"), "dirty": bool(status),
            "ahead": ahead, "behind": behind, "branches": branch_inventory(repo), "worktrees": worktrees,
            "stashCount": len(git(repo, "stash", "list", "--format=%gd").splitlines())}


def desktop_inventory(repo, app, ref="origin/main"):
    files = git_payload(repo, ref, lambda p: (p.split("/")[0] in DESKTOP_DIRS or
                       ("/" not in p and p.endswith(".js"))) and ".test." not in p and "/tests/" not in p)
    result = compare_files(files, app, normalize_eol=True)
    result["textLineEndings"] = "normalized"
    try:
        source = json.loads(git(repo, "show", f"{ref}:package.json"))
        installed = json.loads((app / "package.json").read_text(encoding="utf-8"))
        # Electron Builder removes scripts/devDependencies from the installed manifest.
        same = all(installed.get(k) == source.get(k) for k in ("name", "version", "dependencies"))
        result.update({"version": installed.get("version"), "packageMatches": same,
                       "matches": result["matches"] and same})
        lock = json.loads(git(repo, "show", f"{ref}:package-lock.json"))
        electron = repo / "node_modules/electron"
        local_version = json.loads((electron / "package.json").read_text(encoding="utf-8"))["version"]
        expected_version = lock["packages"]["node_modules/electron"]["version"]
        native = None
        if local_version == expected_version:
            distribution = electron / "dist"
            exe = app.parent.parent / (source["build"]["productName"] + ".exe")
            expected_native = {p.name: p.read_bytes() for p in distribution.iterdir()
                               if p.is_file() and p.suffix in {".dll", ".bin", ".pak", ".dat"}}
            native = (bool(expected_native) and compare_files(expected_native, app.parent.parent)["matches"]
                      and pe_code_sections(distribution / "electron.exe") == pe_code_sections(exe))
        result.update({"electronVersion": expected_version, "electronNativeMatches": native})
    except (OSError, ValueError):
        raise InventoryError("DESKTOP_MANIFEST_UNAVAILABLE") from None
    wake_source = repo / "build/node-runtime/node.exe"
    wake_installed = app.parent / "node-runtime/node.exe"
    result["wakeRuntimeMatchesBuild"] = (digest(wake_source.read_bytes()) == digest(wake_installed.read_bytes())
                                          if wake_source.is_file() and wake_installed.is_file() else None)
    return result


def host_inventory(repo, host, ref="origin/main"):
    files = git_payload(repo, ref, lambda p: p.startswith("host-agent/jarvis_host_agent/") and p.endswith(".py"))
    result = {"hostAgent": compare_files(files, Path("/opt/jarvis-host-agent/jarvis_host_agent"),
                                          "host-agent/jarvis_host_agent/")}
    states = {}
    for unit in ("jarvis-host-agent", "xray", "hysteria-server",
                 f"jarvis-vpn-probe@{'nl' if host == 'de' else 'de'}.timer"):
        run = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True, timeout=15)
        value = run.stdout.strip()
        states[unit] = value if value in {"active", "inactive", "failed", "activating", "deactivating"} else "unknown"
    result["services"] = states
    if host == "de":
        node = """const fs=require('fs'),path=require('path'),crypto=require('crypto');
const out={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())out[p]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}}
walk('src');walk('/app/shared');for(const p of ['package.json','package-lock.json'])out[p]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');console.log(JSON.stringify(out));"""
        actual = json.loads(command(["docker", "exec", "jarvis-family-server-1", "node", "-e", node]))
        expected_files = git_payload(repo, ref, lambda p: p.startswith("server/src/") or p.startswith("shared/")
                                     or p in {"server/package.json", "server/package-lock.json"})
        expected = {(p.removeprefix("server/") if p.startswith("server/") else "/app/" + p): digest(v)
                    for p, v in expected_files.items()}
        server = {"filesChecked": len(expected), "matches": actual == expected}
        inspect = json.loads(command(["docker", "inspect", "jarvis-family-server-1"]))[0]
        server["health"] = inspect.get("State", {}).get("Health", {}).get("Status", "unknown")
        configs = inspect["Config"].get("Labels", {}).get("com.docker.compose.project.config_files", "")
        release_source = release_config_source(configs)
        if release_source:
            release, compose_inputs = release_source
            revision = git(release, "rev-parse", "HEAD")
            server["releaseRevision"] = revision
            # Include compiled UI and image/unit inputs, even when JS hashes match.
            delta = release_input_delta(repo, revision, ref, compose_inputs)
            server["releaseInputsMatch"] = not bool(delta)
        else:
            server["releaseInputsMatch"] = None
        result["server"] = server
    return result


def issues(report):
    source = report["source"]
    found = []
    if source["dirty"] or source["branch"] != "main" or source["ahead"] or source["behind"]:
        found.append("SOURCE_NOT_CLEAN_CURRENT_MAIN")
    if any(b["needsReview"] for b in source["branches"]):
        found.append("BRANCHES_NEED_REVIEW")
    elif source["branches"]:
        found.append("BRANCH_REFS_REMAIN")
    if any(w["dirty"] is not False for w in source["worktrees"]):
        found.append("WORKTREES_NEED_REVIEW")
    if source.get("stashCount"):
        found.append("STASHES_NEED_REVIEW")
    if "desktop" in report and report["desktop"].get("matches") is not True:
        found.append("DESKTOP_PAYLOAD_DIFFERS")
    if "desktop" in report and report["desktop"].get("wakeRuntimeMatchesBuild") is False:
        found.append("WAKE_RUNTIME_DIFFERS")
    if "desktop" in report and report["desktop"].get("wakeRuntimeMatchesBuild") is None:
        found.append("WAKE_RUNTIME_UNVERIFIED")
    if "desktop" in report and report["desktop"].get("electronNativeMatches") is not True:
        found.append("ELECTRON_NATIVE_UNVERIFIED_OR_DIFFERENT")
    runtime = report.get("runtime", {})
    if runtime.get("hostAgent", {}).get("matches") is False:
        found.append("HOST_AGENT_DIFFERS")
    server = runtime.get("server")
    if server and (not server["matches"] or server.get("releaseInputsMatch") is not True):
        found.append("SERVER_RELEASE_DIFFERS")
    if server and server.get("health") != "healthy":
        found.append("SERVER_NOT_HEALTHY")
    if any(v != "active" for v in runtime.get("services", {}).values()):
        found.append("SERVICE_NOT_ACTIVE")
    for host, remote in report.get("vps", {}).items():
        if (remote.get("error") or remote.get("issues")
                or remote.get("source", {}).get("head") != source["githubMain"]
                or remote.get("source", {}).get("githubMain") != source["githubMain"]):
            found.append(f"VPS_{host.upper()}_NEEDS_REVIEW")
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--desktop-app", type=Path, help="Installed resources/app directory")
    parser.add_argument("--vps", action="store_true", help="Inspect both configured SSH hosts; does not deploy")
    parser.add_argument("--check", action="store_true", help="Exit nonzero when publication/release needs review")
    parser.add_argument("--host-mode", choices=("de", "nl"), help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        report = {"source": source_inventory(repo, args.fetch)}
        if args.desktop_app:
            try:
                report["desktop"] = desktop_inventory(repo, args.desktop_app.resolve())
            except (InventoryError, OSError, ValueError, KeyError) as error:
                report["desktop"] = {"error": str(error) if isinstance(error, InventoryError)
                                     else "DESKTOP_INVENTORY_UNAVAILABLE"}
        if args.host_mode:
            report["runtime"] = host_inventory(repo, args.host_mode)
        if args.vps:
            report["vps"] = {}
            script = Path(__file__).read_text(encoding="utf-8")
            for host, alias in (("de", "jarvis-vps"), ("nl", "jarvis-vps-new")):
                try:
                    ssh = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", alias,
                           "python3", "-", "--repo", "/home/deploy/apps/jarvis", "--host-mode", host]
                    if args.fetch:
                        ssh.append("--fetch")
                    report["vps"][host] = json.loads(command(ssh, input=script))
                except (InventoryError, ValueError):
                    report["vps"][host] = {"error": "VPS_INVENTORY_UNAVAILABLE"}
        report["issues"] = issues(report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if args.check and report["issues"] else 0
    except (InventoryError, OSError, ValueError, KeyError) as error:
        code = str(error) if isinstance(error, InventoryError) else "INVENTORY_INVALID"
        print(json.dumps({"error": code}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
