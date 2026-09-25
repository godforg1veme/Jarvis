#!/usr/bin/env python3
"""Fail closed when a Jarvis deployment source is not canonical."""

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


CANONICAL_REMOTE = "https://github.com/godforg1veme/Jarvis.git"
FULL_SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{40}$")


class CheckoutError(Exception):
    """A safe, user-facing checkout validation failure."""


def run_git(repository, *arguments, allow_failure=False):
    try:
        result = subprocess.run(
            ["git", "-C", str(repository), *arguments],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise CheckoutError("git executable is unavailable") from exc
    except OSError as exc:
        raise CheckoutError("could not run git") from exc

    if result.returncode != 0 and not allow_failure:
        command = arguments[0] if arguments else "command"
        raise CheckoutError(f"git {command} check failed")
    return result


def resolve_repository(path):
    try:
        repository = Path(path).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise CheckoutError("repository path does not exist") from exc
    if not repository.is_dir():
        raise CheckoutError("repository path is not a directory")

    output = run_git(repository, "rev-parse", "--show-toplevel").stdout.strip()
    try:
        git_root = Path(output).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise CheckoutError("could not resolve Git worktree root") from exc
    if os.path.normcase(str(git_root)) != os.path.normcase(str(repository)):
        raise CheckoutError("requested path is not the Git worktree root")

    nested_project = repository / "jarvis"
    if nested_project.exists() or nested_project.is_symlink():
        raise CheckoutError("nested jarvis directory is not allowed")
    return repository


def require_clean(repository):
    status = run_git(
        repository,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
    ).stdout
    if status:
        raise CheckoutError("worktree is not clean")


def require_canonical_origin(repository):
    origin = run_git(
        repository,
        "config",
        "--get",
        "remote.origin.url",
        allow_failure=True,
    )
    if origin.returncode != 0 or origin.stdout.strip() != CANONICAL_REMOTE:
        raise CheckoutError("origin URL is not canonical")


def fetch_main(repository):
    run_git(repository, "fetch", "--quiet", "--prune", "origin")
    remote_main = run_git(
        repository,
        "rev-parse",
        "--verify",
        "refs/remotes/origin/main^{commit}",
    ).stdout.strip()
    return remote_main


def require_only_source_refs(repository):
    local_branches = run_git(
        repository,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads",
    ).stdout.splitlines()
    if local_branches != ["refs/heads/main"]:
        raise CheckoutError("local branches must contain only main")

    remote_refs = run_git(
        repository,
        "for-each-ref",
        "--format=%(refname)",
        "refs/remotes",
    ).stdout.splitlines()
    remote_head_ref = "refs/remotes/origin/HEAD"
    if remote_head_ref in remote_refs:
        remote_head = run_git(
            repository,
            "symbolic-ref",
            "--quiet",
            remote_head_ref,
            allow_failure=True,
        )
        if remote_head.returncode != 0 or remote_head.stdout.strip() != "refs/remotes/origin/main":
            raise CheckoutError("origin/HEAD must point to origin/main")
        remote_refs.remove(remote_head_ref)
    remote_branches = remote_refs
    if remote_branches != ["refs/remotes/origin/main"]:
        raise CheckoutError("remote-tracking branches must contain only origin/main")


def verify_source(repository_path):
    repository = resolve_repository(repository_path)
    require_canonical_origin(repository)
    require_clean(repository)

    branch = run_git(
        repository,
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
        allow_failure=True,
    )
    if branch.returncode != 0 or branch.stdout.strip() != "main":
        raise CheckoutError("checked out branch is not main")

    remote_main = fetch_main(repository)
    require_only_source_refs(repository)
    head = run_git(repository, "rev-parse", "--verify", "HEAD^{commit}").stdout.strip()
    if head != remote_main:
        raise CheckoutError("HEAD does not match origin/main")
    return head


def verify_release(recorded_sha, repository_path):
    if not FULL_SHA_PATTERN.fullmatch(recorded_sha):
        raise CheckoutError("recorded release SHA must be a full 40-character commit SHA")

    repository = resolve_repository(repository_path)
    require_canonical_origin(repository)
    require_clean(repository)
    head = run_git(repository, "rev-parse", "--verify", "HEAD^{commit}").stdout.strip()
    if head.lower() != recorded_sha.lower():
        raise CheckoutError("HEAD does not match recorded release SHA")

    remote_main = fetch_main(repository)
    ancestry = run_git(
        repository,
        "merge-base",
        "--is-ancestor",
        head,
        remote_main,
        allow_failure=True,
    )
    if ancestry.returncode != 0:
        raise CheckoutError("recorded release is not reachable from origin/main")
    return head


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="mode", required=True)
    source_parser = subparsers.add_parser("source", help="verify a clean main source checkout")
    source_parser.add_argument("repository_path")
    release_parser = subparsers.add_parser("release", help="verify a recorded immutable release")
    release_parser.add_argument("recorded_sha")
    release_parser.add_argument("repository_path")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        if args.mode == "source":
            sha = verify_source(args.repository_path)
        else:
            sha = verify_release(args.recorded_sha, args.repository_path)
    except CheckoutError as exc:
        print(f"source checkout rejected: {exc}", file=sys.stderr)
        return 1

    print(sha)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
