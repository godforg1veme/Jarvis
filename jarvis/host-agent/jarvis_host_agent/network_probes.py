"""Bounded host network diagnostic probes for Host Agent."""

from __future__ import annotations

import socket
import urllib.error
import urllib.request
from typing import Any

DEFAULT_DNS_TARGET = "cloudflare.com"
DEFAULT_OUTBOUND_TARGET = "https://cp.cloudflare.com/generate_204"
DEFAULT_DNS_TIMEOUT = 3.0
DEFAULT_OUTBOUND_TIMEOUT = 5.0


def probe_dns(target_host: str = DEFAULT_DNS_TARGET, timeout: float = DEFAULT_DNS_TIMEOUT) -> str:
    """Probe DNS resolution without executing external binaries.

    Returns: 'healthy', 'unavailable', or 'unknown'.
    """
    if not target_host or not isinstance(target_host, str):
        return "unknown"
    original_timeout = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(timeout)
        addresses = socket.getaddrinfo(target_host, 443, family=socket.AF_INET, type=socket.SOCK_STREAM)
        if addresses and any(addr[4] for addr in addresses):
            return "healthy"
        return "unavailable"
    except (socket.timeout, TimeoutError):
        return "unavailable"
    except (socket.gaierror, OSError):
        return "unavailable"
    except Exception:
        return "unknown"
    finally:
        socket.setdefaulttimeout(original_timeout)


def probe_outbound_https(target_url: str = DEFAULT_OUTBOUND_TARGET, timeout: float = DEFAULT_OUTBOUND_TIMEOUT) -> str:
    """Probe outbound internet connectivity over HTTPS.

    Never captures, logs, or returns HTML, response body, or sensitive data.
    Returns: 'healthy', 'degraded', 'unavailable', or 'unknown'.
    """
    if not target_url or not isinstance(target_url, str) or not target_url.startswith("https://"):
        return "unknown"
    try:
        req = urllib.request.Request(
            target_url,
            headers={"User-Agent": "Jarvis-Health/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status in (200, 204):
                return "healthy"
            if 400 <= status < 600:
                return "degraded"
            return "healthy"
    except urllib.error.HTTPError as exc:
        if 400 <= exc.code < 600:
            return "degraded"
        return "unavailable"
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError):
        return "unavailable"
    except Exception:
        return "unknown"
