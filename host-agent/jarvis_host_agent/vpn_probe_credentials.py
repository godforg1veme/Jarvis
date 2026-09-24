"""Root-only storage for dedicated external VPN probe credentials."""

from __future__ import annotations

import os
import ipaddress
import json
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .vpn_external_probe import ProbeConfigError, parse_hysteria_uri, parse_vless_uri


class ProbeCredentialError(ValueError):
    def __init__(self) -> None:
        super().__init__("VPN_PROBE_CREDENTIAL_INVALID")


_PROTOCOLS = frozenset({"vless", "hysteria2"})
_BOOTSTRAP_HOP_POOLS = {
    "de": {"version": 1, "nodeCode": "de", "generation": "d8cbe2ba-f23b-45d1-91d6-9c9da9e0ce11",
           "ports": [20011, 22229, 26549, 30013], "hopIntervalSeconds": 30},
    "nl": {"version": 1, "nodeCode": "nl", "generation": "2c1e053c-5c70-4a1f-8d9b-5c1da159ce92",
           "ports": [20117, 23483, 27611, 31829], "hopIntervalSeconds": 30},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _credential_path(root: Path, target_node: str, protocol: str) -> Path:
    if target_node not in {"de", "nl"} or protocol not in _PROTOCOLS:
        raise ProbeCredentialError()
    return root / f"probe-{target_node}-{protocol}.uri"


def _environment_path(root: Path, target_node: str) -> Path:
    if target_node not in {"de", "nl"}:
        raise ProbeCredentialError()
    return root / f"probe-{target_node}.env"


def _public_probe_environment(config: object, target_node: str) -> str:
    target = getattr(config, "probe_target", None)
    if target_node != getattr(target, "node_code", None):
        raise ProbeCredentialError()
    vless_host = getattr(target, "vless_host", "")
    hysteria_host = getattr(target, "hysteria_host", "")
    expected_exit_ip = getattr(target, "expected_exit_ip", "")
    if not isinstance(vless_host, str) or not isinstance(hysteria_host, str) or any(
            not value or len(value) > 253 or any(character in value for character in "\r\n'\\")
            for value in (vless_host, hysteria_host)):
        raise ProbeCredentialError()
    try:
        expected_exit = str(ipaddress.ip_address(expected_exit_ip))
    except (TypeError, ValueError):
        raise ProbeCredentialError() from None
    if "%" in expected_exit:
        raise ProbeCredentialError()
    pool = _BOOTSTRAP_HOP_POOLS[target_node]
    return "\n".join((
        f"VPN_PROBE_VLESS_HOST={vless_host}",
        f"VPN_PROBE_HYSTERIA_HOST={hysteria_host}",
        f"VPN_PROBE_EXPECTED_EXIT_IP={expected_exit}",
        f"VPN_PROBE_HYSTERIA_HOP_POOL='{json.dumps(pool, separators=(',', ':'), sort_keys=True)}'",
        "",
    ))


def install_probe_environment(config: object, *, target_node: str) -> None:
    """Install only public probe routing metadata; no credential is accepted or returned."""
    root = getattr(config, "probe_credential_dir", None)
    if not isinstance(root, Path):
        raise ProbeCredentialError()
    _atomic_root_file(_environment_path(root, target_node), _public_probe_environment(config, target_node))


def _validate(config: object, target_node: str, protocol: str, credential: object) -> None:
    target = getattr(config, "probe_target", None)
    if (getattr(config, "node_code", None) not in {"de", "nl"}
            or target_node != getattr(target, "node_code", None)
            or target_node == getattr(config, "node_code", None)
            or protocol not in _PROTOCOLS
            or not isinstance(credential, str)
            or not 1 <= len(credential) <= 2048):
        raise ProbeCredentialError()
    try:
        if protocol == "vless":
            parse_vless_uri(credential, expected_host=target.vless_host)
        else:
            parse_hysteria_uri(credential, expected_host=target.hysteria_host)
    except (AttributeError, ProbeConfigError):
        raise ProbeCredentialError() from None


def _atomic_root_file(path: Path, value: str) -> None:
    parent = path.parent
    try:
        if os.name != "nt" and os.geteuid() != 0:
            raise ProbeCredentialError()
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent_info = os.lstat(parent)
        if not stat.S_ISDIR(parent_info.st_mode) or stat.S_ISLNK(parent_info.st_mode):
            raise ProbeCredentialError()
        if path.exists() or path.is_symlink():
            existing = os.lstat(path)
            if not stat.S_ISREG(existing.st_mode) or stat.S_ISLNK(existing.st_mode):
                raise ProbeCredentialError()
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(value.encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            if os.name != "nt" and os.geteuid() == 0:
                os.chown(temporary, 0, 0)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    except ProbeCredentialError:
        raise
    except (OSError, UnicodeError):
        raise ProbeCredentialError() from None


def _ensure_empty_root_file(path: Path) -> None:
    """Create a missing systemd credential source without replacing an existing key."""
    try:
        if os.name != "nt" and os.geteuid() != 0:
            raise ProbeCredentialError()
        parent = path.parent
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent_info = os.lstat(parent)
        if not stat.S_ISDIR(parent_info.st_mode) or stat.S_ISLNK(parent_info.st_mode):
            raise ProbeCredentialError()
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags, 0o600)
        except FileExistsError:
            existing = os.lstat(path)
            if not stat.S_ISREG(existing.st_mode) or stat.S_ISLNK(existing.st_mode):
                raise ProbeCredentialError()
            if os.name != "nt" and (existing.st_uid != 0 or stat.S_IMODE(existing.st_mode) != 0o600):
                raise ProbeCredentialError()
            return
        try:
            if os.name != "nt":
                os.fchmod(descriptor, 0o600)
                os.fchown(descriptor, 0, 0)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except ProbeCredentialError:
        raise
    except (OSError, AttributeError):
        raise ProbeCredentialError() from None


def install_probe_credential(config: object, *, target_node: str, protocol: str, credential: object) -> dict:
    """Validate and atomically install one credential without returning it."""
    _validate(config, target_node, protocol, credential)
    root = getattr(config, "probe_credential_dir", None)
    if not isinstance(root, Path):
        raise ProbeCredentialError()
    install_probe_environment(config, target_node=target_node)
    other_protocol = "hysteria2" if protocol == "vless" else "vless"
    _ensure_empty_root_file(_credential_path(root, target_node, other_protocol))
    _atomic_root_file(_credential_path(root, target_node, protocol), credential)
    return {"targetNode": target_node, "protocol": protocol, "installedAt": utc_now()}


def probe_credential_readiness(config: object, *, target_node: str, protocol: str) -> str:
    """Inspect only fixed file metadata before systemd loads a test credential."""
    root = getattr(config, "probe_credential_dir", None)
    target = getattr(config, "probe_target", None)
    if (not isinstance(root, Path) or target_node not in {"de", "nl"}
            or protocol not in _PROTOCOLS or target_node != getattr(target, "node_code", None)
            or target_node == getattr(config, "node_code", None)):
        raise ProbeCredentialError()

    try:
        directory = os.lstat(root)
        if not stat.S_ISDIR(directory.st_mode) or stat.S_ISLNK(directory.st_mode):
            return "configuration_invalid"
        if os.name != "nt" and (directory.st_uid != os.geteuid() or stat.S_IMODE(directory.st_mode) & 0o077):
            return "configuration_invalid"

        def file_info(path: Path):
            try:
                info = os.lstat(path)
            except FileNotFoundError:
                return None
            if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_size > 4096):
                raise ProbeCredentialError()
            if os.name != "nt" and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600):
                raise ProbeCredentialError()
            return info

        requested = file_info(_credential_path(root, target_node, protocol))
        if requested is None or requested.st_size == 0:
            return "not_installed"
        other = "hysteria2" if protocol == "vless" else "vless"
        counterpart = file_info(_credential_path(root, target_node, other))
        environment = file_info(_environment_path(root, target_node))
        if counterpart is None or environment is None or environment.st_size == 0:
            return "configuration_invalid"
        return "ready"
    except (OSError, ProbeCredentialError):
        return "configuration_invalid"
