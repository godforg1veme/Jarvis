"""Durable at-most-once claims; interrupted actions have an unknown outcome."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .protocol import ProtocolError


def canonical_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def request_mac(secret: bytes, request: dict[str, Any]) -> str:
    return hmac.new(secret, canonical_json(request).encode("utf-8"), hashlib.sha256).hexdigest()


class IdempotencyJournal:
    def claim(self, request: dict[str, Any], placeholder: dict[str, Any]) -> bool:
        request_hash = hashlib.sha256(canonical_json(request).encode("utf-8")).hexdigest()
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO requests (request_id,request_hash,response_json,created_at) VALUES (?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                (request["requestId"], request_hash, canonical_json(placeholder)),
            )
        if cursor.rowcount == 0:
            self.get(request)  # Reject a reused identifier with different input.
            return False
        return True

    def complete(self, request: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        request_hash = hashlib.sha256(canonical_json(request).encode("utf-8")).hexdigest()
        with self._connect() as connection:
            cursor = connection.execute("UPDATE requests SET response_json=? WHERE request_id=? AND request_hash=?", (canonical_json(response), request["requestId"], request_hash))
        if cursor.rowcount != 1:
            raise ProtocolError("operation was not claimed")
        return response

    def __init__(self, state_dir: Path) -> None:
        state_dir.mkdir(mode=0o750, parents=True, exist_ok=True)
        self.path = state_dir / "requests.sqlite3"
        with self._connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL)")
            connection.execute("CREATE INDEX IF NOT EXISTS requests_created_at ON requests(created_at)")

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            yield connection
        finally:
            connection.close()

    def get(self, request: dict[str, Any]) -> dict[str, Any] | None:
        request_hash = hashlib.sha256(canonical_json(request).encode("utf-8")).hexdigest()
        with self._connect() as connection:
            row = connection.execute("SELECT request_hash,response_json FROM requests WHERE request_id=?", (request["requestId"],)).fetchone()
        if not row:
            return None
        if row[0] != request_hash:
            raise ProtocolError("request id was already used for different input")
        return json.loads(row[1])

    def get_response(self, request_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT response_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, request: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        request_hash = hashlib.sha256(canonical_json(request).encode("utf-8")).hexdigest()
        response_json = canonical_json(response)
        with self._connect() as connection:
            try:
                connection.execute("INSERT INTO requests (request_id,request_hash,response_json,created_at) VALUES (?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", (request["requestId"], request_hash, response_json))
            except sqlite3.IntegrityError:
                return self.get(request) or response
            # Keep mutation claims: deleting them would permit old signed
            # changing requests to be executed again after a restart.
            connection.execute("DELETE FROM requests WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') AND json_extract(response_json,'$.operation') NOT IN ('service.start','service.stop','service.restart','backup.run')")
        return response
