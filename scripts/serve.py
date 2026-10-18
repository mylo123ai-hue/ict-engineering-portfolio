#!/usr/bin/env python3
"""Serve the portfolio and a loopback-only SQLite API for synthetic demo state."""

import json
import os
import sqlite3
from contextlib import closing
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
NOT_FOUND = ROOT / "index.html" / "__preview_not_found__"
ALLOWED_ROOTS = {"index.html", "src", "docs"}
MAX_STATE_BYTES = 1_000_000
DEFAULT_DB = Path.home() / ".local" / "share" / "northstar-ict-portfolio" / "demo.sqlite3"
DB_PATH = Path(os.environ.get("ICT_PORTFOLIO_DB", DEFAULT_DB)).expanduser()


def is_allowed_path(path):
    candidate = Path(path).resolve()
    try:
        relative = candidate.relative_to(ROOT)
    except ValueError:
        return False
    if any(part.startswith(".") for part in relative.parts):
        return False
    return not relative.parts or relative.parts[0] in ALLOWED_ROOTS


def valid_state_shape(state):
    """Bound request structure; domain invariants are also checked in the client model."""
    if not isinstance(state, dict) or set(state) != {"nodes", "findings", "tickets", "maintenance", "events"}:
        return False
    limits = {"nodes": 32, "findings": 500, "tickets": 500, "maintenance": 300, "events": 100}
    if not all(isinstance(state[key], list) and len(state[key]) <= limit for key, limit in limits.items()):
        return False
    if not all(isinstance(event, str) for event in state["events"]):
        return False
    record_lists = ("nodes", "findings", "tickets", "maintenance")
    for key in record_lists:
        records = state[key]
        if not all(isinstance(record, dict) and isinstance(record.get("id"), str) for record in records):
            return False
        ids = [record["id"] for record in records]
        if len(set(ids)) != len(ids):
            return False
    return len(state["nodes"]) == 5


class DemoStateStore:
    """One versioned synthetic casebook snapshot stored in SQLite."""

    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        if self.path == ROOT or ROOT in self.path.parents:
            raise ValueError("SQLite casebook storage must be outside the repository")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not self.path.exists():
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(descriptor)
            except FileExistsError:
                pass
        try:
            self.path.chmod(0o600)
        except OSError:
            pass
        with closing(self._connect()) as db:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS demo_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)")

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def read(self):
        with closing(self._connect()) as db:
            row = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
        if row is None:
            return {"state": None, "revision": 0}
        return {"state": json.loads(row["payload"]), "revision": row["revision"]}

    def write(self, expected_revision, state):
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        with closing(self._connect()) as db:
            with db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT revision FROM demo_state WHERE id = 1").fetchone()
                current = row["revision"] if row else 0
                if current != expected_revision:
                    db.rollback()
                    return None
                revision = current + 1
                db.execute(
                    "INSERT INTO demo_state (id, revision, payload) VALUES (1, ?, ?) "
                    "ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload",
                    (revision, payload),
                )
        return revision


class PortfolioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        candidate = Path(super().translate_path(path)).resolve()
        return str(candidate) if is_allowed_path(candidate) else str(NOT_FOUND)

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _api_path(self):
        return urlsplit(self.path).path

    def do_GET(self):
        if self._api_path() == "/api/health":
            try:
                revision = self.server.store.read()["revision"]
            except (sqlite3.Error, json.JSONDecodeError):
                self._send_json(503, {"ok": False, "error": "SQLite storage unavailable"})
                return
            self._send_json(200, {"ok": True, "storage": "sqlite", "revision": revision})
        elif self._api_path() == "/api/state":
            try:
                self._send_json(200, self.server.store.read())
            except (sqlite3.Error, json.JSONDecodeError):
                self._send_json(503, {"error": "SQLite storage unavailable"})
        elif self._api_path().startswith("/api/"):
            self._send_json(404, {"error": "Not found"})
        else:
            super().do_GET()

    def do_PUT(self):
        if self._api_path() != "/api/state":
            self._send_json(404, {"error": "Not found"})
            return
        if self.headers.get_content_type() != "application/json":
            self._send_json(415, {"error": "Expected application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Invalid content length"})
            return
        if length <= 0 or length > MAX_STATE_BYTES:
            self._send_json(413 if length > MAX_STATE_BYTES else 400, {"error": "Invalid state payload size"})
            return
        try:
            request = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "Invalid JSON"})
            return
        if not isinstance(request, dict) or type(request.get("revision")) is not int or request["revision"] < 0 or not valid_state_shape(request.get("state")):
            self._send_json(422, {"error": "Invalid casebook state"})
            return
        try:
            revision = self.server.store.write(request["revision"], request["state"])
        except (ValueError, TypeError):
            self._send_json(422, {"error": "State contains unsupported JSON values"})
            return
        except sqlite3.Error:
            self._send_json(503, {"error": "SQLite storage unavailable"})
            return
        if revision is None:
            current = self.server.store.read()
            self._send_json(409, {"error": "State changed in another session", **current})
            return
        self._send_json(200, {"state": request["state"], "revision": revision})


def create_server(host="127.0.0.1", port=4173, db_path=DB_PATH):
    server = ThreadingHTTPServer((host, port), PortfolioHandler)
    server.store = DemoStateStore(db_path)
    return server


if __name__ == "__main__":
    server = create_server()
    print(f"Portfolio preview and synthetic-state API: http://{server.server_address[0]}:{server.server_address[1]}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
