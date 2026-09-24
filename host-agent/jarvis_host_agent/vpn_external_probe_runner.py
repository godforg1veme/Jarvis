"""Run bounded external VPN client checks. Never print credentials or client output."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from .vpn_external_probe import (
    ProbeConfigError,
    build_hysteria_client_config,
    build_xray_client_config,
    parse_hysteria_uri,
    parse_vless_uri,
    validate_probe_result,
)
from .hysteria_port_pool import (
    PortPoolError,
    build_hysteria_hop_client_config,
    validate_port_pool,
)


UNKNOWN = {"status": "unknown", "failureCode": "CHECK_UNAVAILABLE"}
NOT_CONFIGURED = {"status": "unknown", "failureCode": "NOT_CONFIGURED"}
EGRESS_UNAVAILABLE = {"status": "unknown", "failureCode": "EGRESS_UNAVAILABLE"}
EgressEndpoint = "https://api.ipify.org"


def _read_credential(directory: Path, name: str) -> str | None:
    path = directory / name
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = handle.read(2049).strip()
    except OSError:
        return None
    return value if 0 < len(value) <= 2048 else None


def _read_hop_pool(target: str) -> dict | None:
    """Read a root-owned, public-only JSON pool; credentials stay in LoadCredential files."""
    raw = os.environ.get("VPN_PROBE_HYSTERIA_HOP_POOL")
    if raw is None:
        return None
    if not 0 < len(raw) <= 512:
        raise ProbeConfigError()
    try:
        return validate_port_pool(json.loads(raw), expected_node=target)
    except (TypeError, ValueError, PortPoolError):
        raise ProbeConfigError() from None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _curl_ip(proxy_port: int | None) -> str | None:
    command = ["/usr/bin/curl", "--silent", "--fail", "--max-time", "12", "--max-filesize", "64"]
    if proxy_port is None:
        command.extend(["--noproxy", "*"])
    else:
        command.extend(["--noproxy", "", "--socks5-hostname", f"127.0.0.1:{proxy_port}"])
    command.append(EgressEndpoint)
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=14, check=False)
        if result.returncode != 0 or len(result.stdout) > 64:
            return None
        value = result.stdout.decode("ascii").strip()
        ipaddress.ip_address(value)
        return value
    except (OSError, subprocess.TimeoutExpired, UnicodeError, ValueError):
        return None


def _wait_for_proxy(port: int, process: subprocess.Popen, deadline: float) -> bool:
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def _sleep_for_hop(seconds: int) -> None:
    time.sleep(seconds)


def _run_client(config: dict, argv: list[str], expected_exit_ip: str, *, hop_interval_seconds: int | None = None) -> dict:
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix="jarvis-vpn-probe-") as directory:
            config_path = Path(directory) / "client.json"
            with config_path.open("x", encoding="utf-8") as handle:
                os.chmod(config_path, 0o600)
                json.dump(config, handle, separators=(",", ":"))
            port = config["inbounds"][0]["port"] if "inbounds" in config else int(config["socks5"]["listen"].rsplit(":", 1)[1])
            process = subprocess.Popen([*argv, str(config_path)], stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, close_fds=True)
            if not _wait_for_proxy(port, process, time.monotonic() + 4):
                return dict(UNKNOWN)
            actual = _curl_ip(port)
            if actual is None:
                return dict(UNKNOWN)
            if actual != expected_exit_ip:
                return {"status": "failed", "failureCode": "EXIT_MISMATCH"}
            if hop_interval_seconds is not None:
                _sleep_for_hop(hop_interval_seconds)
                actual = _curl_ip(port)
                if actual is None:
                    return dict(UNKNOWN)
                if actual != expected_exit_ip:
                    return {"status": "failed", "failureCode": "EXIT_MISMATCH"}
            return {"status": "healthy", "failureCode": None}
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return dict(UNKNOWN)
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass


def run_checks(*, target: str, credential_dir: Path, vless_host: str, hysteria_host: str,
               expected_exit_ip: str, xray_bin: str, hysteria_bin: str) -> dict:
    if target not in {"de", "nl"}:
        raise ProbeConfigError()
    try:
        ipaddress.ip_address(expected_exit_ip)
    except ValueError:
        raise ProbeConfigError() from None
    vless_uri = _read_credential(credential_dir, "vless.uri")
    hysteria_uri = _read_credential(credential_dir, "hysteria2.uri")
    checks = {name: dict(NOT_CONFIGURED) for name in ("vless_tcp_443", "vless_tcp_8443", "hysteria2_udp_443", "hysteria2_udp_hop")}
    if _curl_ip(None) is None:
        for name in checks:
            if (name.startswith("vless") and vless_uri) or (name.startswith("hysteria") and hysteria_uri):
                checks[name] = dict(EGRESS_UNAVAILABLE)
    else:
        if vless_uri:
            try:
                parsed = parse_vless_uri(vless_uri, expected_host=vless_host)
                for port in (443, 8443):
                    config = build_xray_client_config({**parsed, "port": port}, _free_port())
                    checks[f"vless_tcp_{port}"] = _run_client(config, [xray_bin, "run", "-c"], expected_exit_ip)
            except ProbeConfigError:
                checks["vless_tcp_443"] = dict(UNKNOWN)
                checks["vless_tcp_8443"] = dict(UNKNOWN)
        if hysteria_uri:
            try:
                parsed = parse_hysteria_uri(hysteria_uri, expected_host=hysteria_host)
                config = build_hysteria_client_config(parsed, _free_port())
                checks["hysteria2_udp_443"] = _run_client(
                    config, [hysteria_bin, "client", "--disable-update-check", "--log-level", "error", "--config"],
                    expected_exit_ip,
                )
            except ProbeConfigError:
                checks["hysteria2_udp_443"] = dict(UNKNOWN)
                parsed = None
            try:
                pool = _read_hop_pool(target)
                if pool is None:
                    checks["hysteria2_udp_hop"] = dict(NOT_CONFIGURED)
                elif parsed is None:
                    checks["hysteria2_udp_hop"] = dict(UNKNOWN)
                else:
                    config = build_hysteria_hop_client_config(parsed, _free_port(), pool)
                    checks["hysteria2_udp_hop"] = _run_client(
                        config, [hysteria_bin, "client", "--disable-update-check", "--log-level", "error", "--config"],
                        expected_exit_ip, hop_interval_seconds=pool["hopIntervalSeconds"],
                    )
            except (ProbeConfigError, PortPoolError):
                checks["hysteria2_udp_hop"] = dict(UNKNOWN)
    result = {"version": 1, "targetNode": target, "sampledAt": datetime.now(timezone.utc).isoformat(), "checks": checks}
    return validate_probe_result(result, target, datetime.now(timezone.utc))


def _write_result(path: Path, value: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".probe-", delete=False) as handle:
        temporary = Path(handle.name)
        try:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("de", "nl"), required=True)
    parser.add_argument("--vless-host", required=True)
    parser.add_argument("--hysteria-host", required=True)
    parser.add_argument("--expected-exit-ip", required=True)
    parser.add_argument("--result", default="/run/jarvis-vpn-probe/result.json")
    parser.add_argument("--xray-bin", default="/usr/local/bin/xray")
    parser.add_argument("--hysteria-bin", default="/usr/local/bin/hysteria")
    args = parser.parse_args()
    credential_dir = os.environ.get("CREDENTIALS_DIRECTORY")
    if not credential_dir:
        raise SystemExit("VPN_EXTERNAL_PROBE_CREDENTIALS_UNAVAILABLE")
    try:
        result = run_checks(target=args.target, credential_dir=Path(credential_dir),
                            vless_host=args.vless_host, hysteria_host=args.hysteria_host,
                            expected_exit_ip=args.expected_exit_ip, xray_bin=args.xray_bin,
                            hysteria_bin=args.hysteria_bin)
        _write_result(Path(args.result), result)
    except (ProbeConfigError, OSError):
        raise SystemExit("VPN_EXTERNAL_PROBE_UNAVAILABLE") from None


if __name__ == "__main__":
    main()
