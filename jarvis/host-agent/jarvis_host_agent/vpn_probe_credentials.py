"""Root-only storage for dedicated external VPN probe credentials."""

from __future__ import annotations

import os
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .vpn_external_probe import ProbeConfigError, parse_hysteria_uri, parse_vless_uri


class ProbeCredentialError(ValueError):
    def __init__(self) -> None:
        super().__init__("VPN_PROBE_CREDENTIAL_INVALID")


_PROTOCOLS = frozenset({"vless", "hysteria2"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _credential_path(root: Path, target_node: str, protocol: str) -> Path:
    if target_node not in {"de", "nl"} or protocol not in _PROTOCOLS:
        raise ProbeCredentialError()
    return root / f"probe-{target_node}-{protocol}.uri"


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


def install_probe_credential(config: object, *, target_node: str, protocol: str, credential: object) -> dict:
    """Validate and atomically install one credential without returning it."""
    _validate(config, target_node, protocol, credential)
    root = getattr(config, "probe_credential_dir", None)
    if not isinstance(root, Path):
        raise ProbeCredentialError()
    _atomic_root_file(_credential_path(root, target_node, protocol), credential)
    return {"targetNode": target_node, "protocol": protocol, "installedAt": utc_now()}
