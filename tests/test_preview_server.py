import json
from concurrent.futures import ThreadPoolExecutor
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from scripts.backup_demo_state import backup_database
from scripts.serve import DemoStateStore, ROOT, create_server, is_allowed_path


class PreviewServerScopeTests(unittest.TestCase):
    def test_portfolio_assets_are_allowed(self):
        for relative in ("index.html", "src/app.js", "src/styles.css", "docs/screenshots.md", "docs/homepage.jpg"):
            with self.subTest(path=relative):
                self.assertTrue(is_allowed_path(ROOT / relative))

    def test_workspace_files_and_hidden_paths_are_blocked(self):
        for relative in (
            "README.md",
            "package.json",
            "scripts/serve.py",
            "tests/model.test.js",
            ".aws/credentials",
            ".git/config",
            "../.aws/credentials",
        ):
            with self.subTest(path=relative):
                self.assertFalse(is_allowed_path(ROOT / relative))


class DemoStateApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "demo.sqlite3"
        self.server = create_server(port=0, db_path=self.db_path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def request(self, path, method="GET", payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            body = error.read()
            try:
                return error.code, json.loads(body)
            except json.JSONDecodeError:
                return error.code, None

    @staticmethod
    def valid_casebook():
        signals = {
            "core-sw-01": {"portUtilization": 42, "interfaceErrors": 0.1},
            "app-srv-02": {"cpu": 61, "memory": 67, "queueDepth": 8},
            "db-pri-01": {"connectionUtilization": 38, "storage": 64},
            "fw-edge-01": {"cpu": 24, "sessionUtilization": 41},
            "ap-east-14": {"missedHeartbeats": 0, "poeDraw": 7.2},
        }
        return {
            "nodes": [
                {"id": node_id, "name": node_id, "type": "Synthetic", "zone": "Lab", "health": "Healthy",
                 "latency": 8, "uptime": "99.99%", "icon": "*", "signals": node_signals}
                for node_id, node_signals in signals.items()
            ],
            "findings": [], "tickets": [], "maintenance": [], "events": ["Synthetic demo event"],
        }

    def test_state_is_persisted_and_revision_conflicts_are_rejected(self):
        initial_status, initial = self.request("/api/state")
        self.assertEqual(initial_status, 200)
        self.assertEqual(initial, {"state": None, "revision": 0})

        state = self.valid_casebook()
        status, saved = self.request("/api/state", "PUT", {"revision": 0, "state": state})
        self.assertEqual(status, 200)
        self.assertEqual(saved, {"state": state, "revision": 1})
        self.assertEqual(self.request("/api/state"), (200, {"state": state, "revision": 1}))

        status, conflict = self.request("/api/state", "PUT", {"revision": 0, "state": state})
        self.assertEqual(status, 409)
        self.assertEqual(conflict["revision"], 1)
        self.assertEqual(self.request("/api/state")[1]["revision"], 1)

    def test_simultaneous_writes_cannot_overwrite_the_same_revision(self):
        states = [self.valid_casebook(), self.valid_casebook()]
        states[0]["events"] = ["Writer A"]
        states[1]["events"] = ["Writer B"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(
                lambda state: self.request("/api/state", "PUT", {"revision": 0, "state": state}),
                states,
            ))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        saved = self.request("/api/state")[1]
        self.assertEqual(saved["revision"], 1)
        self.assertIn(saved["state"]["events"], [["Writer A"], ["Writer B"]])

    def test_casebook_survives_server_recreation(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

        self.server = create_server(port=0, db_path=self.db_path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.assertEqual(self.request("/api/state"), (200, {"state": state, "revision": 1}))

    def test_health_endpoint_and_bind_address_are_local(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(self.request("/api/health"), (200, {"ok": True, "storage": "sqlite", "revision": 0}))

    def test_sqlite_path_cannot_be_created_inside_the_repository(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            DemoStateStore(ROOT / "demo-state.sqlite3")

    @unittest.skipUnless(os.name == "posix", "POSIX file permissions are not available")
    def test_sqlite_database_is_owner_read_write_only(self):
        self.assertEqual(self.db_path.stat().st_mode & 0o777, 0o600)

    def test_storage_errors_return_service_unavailable(self):
        with sqlite3.connect(self.db_path) as db:
            db.execute("DROP TABLE demo_state")
        self.assertEqual(self.request("/api/health")[0], 503)
        self.assertEqual(self.request("/api/state")[0], 503)
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": self.valid_casebook()})[0], 503)

    def test_sqlite_backup_is_consistent_private_and_never_overwritten(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        destination = Path(self.temp_dir.name) / "backups" / "casebook.sqlite3"
        saved_backup = backup_database(self.db_path, destination)
        with sqlite3.connect(saved_backup) as db:
            row = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
        self.assertEqual(row, (1, json.dumps(state, separators=(",", ":"), ensure_ascii=False)))
        if os.name == "posix":
            self.assertEqual(saved_backup.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            backup_database(self.db_path, destination)

        command_destination = Path(self.temp_dir.name) / "backups" / "cli-casebook.sqlite3"
        environment = {**os.environ, "ICT_PORTFOLIO_DB": str(self.db_path)}
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "backup_demo_state.py"), str(command_destination)],
            capture_output=True, text=True, env=environment, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verified synthetic casebook backup", result.stdout)

    def test_api_rejects_bad_shapes_and_unknown_routes(self):
        status, error = self.request("/api/state", "PUT", {"revision": 0, "state": {"tickets": []}})
        self.assertEqual(status, 422)
        self.assertIn("error", error)
        duplicate = self.valid_casebook()
        duplicate["nodes"][1]["id"] = duplicate["nodes"][0]["id"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": duplicate})[0], 422)
        malformed_signal = self.valid_casebook()
        malformed_signal["nodes"][0]["signals"]["portUtilization"] = "unknown"
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": malformed_signal})[0], 422)
        malformed_status = self.valid_casebook()
        malformed_status["nodes"][0]["health"] = []
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": malformed_status})[0], 422)
        invalid_ticket = self.valid_casebook()
        invalid_ticket["tickets"] = [{"id": "HD-1", "subject": "Test", "requester": "Synthetic", "assignee": "Unassigned", "category": "Unsupported", "priority": "Normal", "status": "New", "ageMinutes": 0, "firstResponseMinutes": None, "updates": []}]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": invalid_ticket})[0], 422)
        self.assertEqual(self.request("/api/not-real")[0], 404)
        self.assertEqual(self.request("/.git/config")[0], 404)

    def test_api_rejects_malformed_nested_json_types(self):
        cases = []
        invalid_node_id = self.valid_casebook()
        invalid_node_id["nodes"][0]["id"] = {"unexpected": "object"}
        cases.append(invalid_node_id)
        invalid_health = self.valid_casebook()
        invalid_health["nodes"][0]["health"] = []
        cases.append(invalid_health)
        invalid_signal = self.valid_casebook()
        invalid_signal["nodes"][0]["signals"]["portUtilization"] = []
        cases.append(invalid_signal)
        invalid_finding = self.valid_casebook()
        invalid_finding["findings"].append({
            "id": "SEC-1", "title": "Synthetic", "asset": "app-srv-02", "owner": "Unassigned",
            "responsePlan": "", "resolution": "", "status": [], "severity": "Low", "cvss": 1.0,
        })
        cases.append(invalid_finding)
        invalid_ticket = self.valid_casebook()
        invalid_ticket["tickets"].append({
            "id": "HD-1", "subject": "Synthetic", "requester": "Tester", "assignee": "Unassigned",
            "category": {}, "priority": "Normal", "status": "New", "ageMinutes": 0,
            "firstResponseMinutes": None, "updates": [],
        })
        cases.append(invalid_ticket)
        invalid_change = self.valid_casebook()
        invalid_change["maintenance"].append({
            "id": "CHG-1", "title": "Synthetic", "owner": "R. Patel", "risk": "Low",
            "status": "Pending approval", "readiness": [], "history": [],
        })
        cases.append(invalid_change)
        invalid_events = self.valid_casebook()
        invalid_events["events"] = [{}]
        cases.append(invalid_events)

        for index, case in enumerate(cases):
            with self.subTest(case=index):
                status, error = self.request("/api/state", "PUT", {"revision": 0, "state": case})
                self.assertEqual(status, 422)
                self.assertIn("error", error)

    def test_api_rejects_oversized_state(self):
        request = urllib.request.Request(
            self.base_url + "/api/state",
            data=b"{}",
            method="PUT",
            headers={"Content-Type": "application/json", "Content-Length": "1000001"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 413)

    def test_api_rejects_excessive_json_nesting_cleanly(self):
        deeply_nested = b'{"revision":0,"state":' + b"[" * 12000 + b"0" + b"]" * 12000 + b"}"
        request = urllib.request.Request(
            self.base_url + "/api/state", data=deeply_nested, method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 400)

    def test_api_rejects_malformed_json_content_type_and_boolean_revision(self):
        malformed = urllib.request.Request(
            self.base_url + "/api/state", data=b"{", method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(malformed, timeout=2)
        self.assertEqual(error.exception.code, 400)

        wrong_type = urllib.request.Request(
            self.base_url + "/api/state", data=b"{}", method="PUT",
            headers={"Content-Type": "text/plain"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(wrong_type, timeout=2)
        self.assertEqual(error.exception.code, 415)

        self.assertEqual(self.request("/api/state", "PUT", {"revision": True, "state": self.valid_casebook()})[0], 422)


if __name__ == "__main__":
    unittest.main()
