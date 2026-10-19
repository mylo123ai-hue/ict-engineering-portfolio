import json
from concurrent.futures import ThreadPoolExecutor
import os
import sqlite3
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch
from scripts.backup_demo_state import backup_database
from scripts.serve import (
    DemoStateStore, MAX_SAFE_REVISION, MAX_STATE_BYTES, MAX_STATE_REQUEST_BYTES, PortfolioHandler, ROOT, create_server, is_allowed_path,
)


class PreviewServerScopeTests(unittest.TestCase):
    def test_server_factory_rejects_non_loopback_bind_addresses(self):
        with self.assertRaisesRegex(ValueError, "must bind to 127.0.0.1"):
            create_server(host="0.0.0.0", port=0, db_path="unused.sqlite3")

    def test_database_startup_failure_closes_the_bound_listener(self):
        server = Mock()
        with patch("scripts.serve.PortfolioHTTPServer", return_value=server), patch(
            "scripts.serve.DemoStateStore", side_effect=RuntimeError("unsupported schema"),
        ):
            with self.assertRaisesRegex(RuntimeError, "unsupported schema"):
                create_server(port=0, db_path="unused.sqlite3")
        server.server_close.assert_called_once_with()

    def test_portfolio_assets_are_allowed(self):
        for relative in (
            "index.html", "src/app.js", "src/styles.css", "docs/screenshots.md",
            "docs/homepage.jpg", "docs/homepage-backend-cycle.png",
        ):
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

    def test_client_disconnects_during_static_and_json_writes_close_cleanly(self):
        request_handler = PortfolioHandler.__new__(PortfolioHandler)
        for disconnect in (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            with self.subTest(disconnect=disconnect.__name__):
                request_handler.close_connection = False
                request_handler.send_response = Mock()
                request_handler.send_header = Mock()
                request_handler.end_headers = Mock()
                request_handler.wfile = Mock()
                request_handler.wfile.write.side_effect = disconnect("synthetic client disconnect")
                request_handler._send_json(200, {"ok": True})
                self.assertTrue(request_handler.close_connection)

                request_handler.close_connection = False
                request_handler.copyfile(BytesIO(b"synthetic asset"), request_handler.wfile)
                self.assertTrue(request_handler.close_connection)


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
            try:
                body = error.read()
                return error.code, json.loads(body)
            except json.JSONDecodeError:
                return error.code, None
            finally:
                error.close()

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

    def test_store_rejects_invalid_state_and_revision_before_writing(self):
        with self.assertRaisesRegex(ValueError, "state failed validation"):
            self.server.store.write(0, {"nodes": [], "findings": [], "tickets": [], "maintenance": [], "events": []})
        with self.assertRaisesRegex(ValueError, "revision"):
            self.server.store.write(True, self.valid_casebook())
        oversized = self.valid_casebook()
        oversized["nodes"][0]["extension"] = "x" * MAX_STATE_BYTES
        with self.assertRaisesRegex(ValueError, "storage size"):
            self.server.store.write(0, oversized)
        self.assertEqual(self.request("/api/state"), (200, {"state": None, "revision": 0}))
        self.assertEqual(self.request("/api/history")[1]["revisions"], [])

    def test_store_history_lookup_rejects_boolean_and_out_of_range_revisions(self):
        for revision in (True, 0, -1, 9_007_199_254_740_992):
            with self.subTest(revision=revision), self.assertRaisesRegex(ValueError, "History revision"):
                self.server.store.read_history(revision)

    def test_json_integer_boundary_stays_exact_in_javascript(self):
        state = self.valid_casebook()
        state["nodes"][0]["extension"] = MAX_SAFE_REVISION
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        invalid = self.valid_casebook()
        invalid["nodes"][0]["extension"] = MAX_SAFE_REVISION + 1
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": invalid})[0], 422)
        for value in (1e20, 1e21):
            unsafe_exponent = self.valid_casebook()
            unsafe_exponent["nodes"][0]["extension"] = value
            self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": unsafe_exponent})[0], 422)
        self.assertEqual(self.request("/api/state")[1], {"state": state, "revision": 1})

    def test_api_trimming_matches_javascript_string_trim(self):
        new_ticket = {
            "id": "HD-1048", "subject": "Synthetic request", "requester": "Demo User",
            "assignee": "Unassigned", "category": "Software", "priority": "Normal", "status": "New",
            "ageMinutes": 0, "firstResponseMinutes": None, "updates": [],
        }
        bom_only = self.valid_casebook()
        bom_only["tickets"] = [{**new_ticket, "subject": "\ufeff"}]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": bom_only})[0], 422)
        separator = self.valid_casebook()
        separator["tickets"] = [{**new_ticket, "subject": "\u001c"}]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": separator})[0], 200)
        note = self.valid_casebook()
        note["tickets"] = [{
            **new_ticket, "status": "In progress", "assignee": "R. Patel",
            "firstResponseMinutes": 6, "updates": ["\u001c" * 8],
        }]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": note})[0], 200)

    def test_revision_history_and_restore_are_auditable_and_compare_and_swap(self):
        original = self.valid_casebook()
        original["findings"] = [{
            "id": "SEC-314", "title": "Synthetic patch exposure", "asset": "app-srv-02",
            "owner": "Unassigned", "responsePlan": "", "resolution": "", "status": "Open",
            "severity": "High", "cvss": 8.1,
        }]
        original["tickets"] = [{
            "id": "HD-208", "subject": "Synthetic VPN access request", "requester": "A. Example",
            "assignee": "Unassigned", "category": "Access & accounts", "priority": "Normal",
            "status": "New", "ageMinutes": 5, "firstResponseMinutes": None, "updates": [],
        }]
        original["maintenance"] = [{
            "id": "CHG-42", "title": "Synthetic ERP maintenance", "system": "Synthetic ERP host",
            "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
            "rollback": "Restore the recorded snapshot and verify the service.", "owner": "M. Chen",
            "risk": "Medium", "status": "Pending approval",
            "readiness": {"scopeOwner": False, "windowConfirmed": False, "impactAssessed": False,
                          "rollbackDocumented": False, "validationReady": False},
            "history": [],
        }]
        updated = self.valid_casebook()
        updated["events"] = ["Synthetic investigation updated"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": original})[0], 200)
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": updated})[0], 200)

        listed_status, listed = self.request("/api/history")
        self.assertEqual(listed_status, 200)
        self.assertEqual([entry["revision"] for entry in listed["revisions"]], [2, 1])
        self.assertEqual(listed["limit"], 25)
        self.assertEqual(listed["revisions"][0]["counts"], {
            "nodes": 5, "findings": 0, "tickets": 0, "maintenance": 0, "events": 1,
        })
        self.assertTrue(listed["revisions"][0]["createdAt"].endswith("+00:00"))
        self.assertEqual(self.request("/api/history/1"), (200, {"state": original, "revision": 1}))
        self.assertEqual(self.request("/api/health")[1]["historyCount"], 2)

        restored_status, restored = self.request(
            "/api/restore", "POST", {"revision": 2, "sourceRevision": 1},
        )
        self.assertEqual(restored_status, 200)
        self.assertEqual(restored, {"state": original, "revision": 3, "restoredFrom": 1})
        history = self.request("/api/history")[1]["revisions"]
        self.assertEqual(history[0]["revision"], 3)
        self.assertEqual(history[0]["restoredFrom"], 1)
        self.assertEqual(self.request("/api/state")[1], {"state": original, "revision": 3})

        stale_status, conflict = self.request(
            "/api/restore", "POST", {"revision": 2, "sourceRevision": 2},
        )
        self.assertEqual(stale_status, 409)
        self.assertEqual(conflict["revision"], 3)
        self.assertEqual(self.request("/api/history/999")[0], 404)
        self.assertEqual(self.request("/api/history/999999999999999999999999999999")[0], 404)
        self.assertEqual(self.request("/api/history/0")[0], 404)
        self.assertEqual(self.request("/api/history/%D9%A1")[0], 404)

    def test_history_retains_only_the_newest_25_revisions(self):
        state = self.valid_casebook()
        for revision in range(26):
            state["events"] = [f"Synthetic revision {revision + 1}"]
            status, _ = self.request("/api/state", "PUT", {"revision": revision, "state": state})
            self.assertEqual(status, 200)
        history = self.request("/api/history")[1]
        self.assertEqual(history["limit"], 25)
        self.assertEqual(len(history["revisions"]), 25)
        self.assertEqual(history["revisions"][0]["revision"], 26)
        self.assertEqual(history["revisions"][-1]["revision"], 2)
        self.assertEqual(self.request("/api/history/1")[0], 404)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 26, "sourceRevision": 1})[0], 404)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 25, "sourceRevision": 1})[0], 409)
        restored_status, restored = self.request(
            "/api/restore", "POST", {"revision": 26, "sourceRevision": 2},
        )
        self.assertEqual(restored_status, 200)
        self.assertEqual(restored["revision"], 27)
        retained = self.request("/api/history")[1]["revisions"]
        self.assertEqual(len(retained), 25)
        self.assertEqual(
            (retained[0]["revision"], retained[0]["restoredFrom"], retained[-1]["revision"]),
            (27, 2, 3),
        )
        self.assertEqual(self.request("/api/history/2")[0], 404)

    def test_startup_enforces_retention_on_an_existing_history_table(self):
        path = Path(self.temp_dir.name) / "preexisting-history.sqlite3"
        store = DemoStateStore(path)
        state = self.valid_casebook()
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        with sqlite3.connect(path) as db:
            db.execute("INSERT INTO demo_state VALUES (1, 30, ?)", (payload,))
            db.executemany(
                "INSERT INTO demo_state_history (revision, created_at, payload, restored_from) VALUES (?, ?, ?, NULL)",
                [(revision, "2026-01-01T00:00:00+00:00", payload) for revision in range(1, 31)],
            )
        store = DemoStateStore(path)
        revisions = [row["revision"] for row in store.history()]
        self.assertEqual(len(revisions), 25)
        self.assertEqual((revisions[0], revisions[-1]), (30, 6))

    def test_existing_snapshot_is_backfilled_into_revision_history(self):
        state = self.valid_casebook()
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        with sqlite3.connect(self.db_path) as db:
            db.execute("DROP TABLE demo_state_history")
            db.execute("DROP TABLE demo_state")
            db.execute("CREATE TABLE demo_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)")
            db.execute("INSERT INTO demo_state VALUES (1, 7, ?)", (payload,))
            db.execute("PRAGMA user_version = 0")
        store = DemoStateStore(self.db_path)
        self.assertEqual(store.read_history(7), {"state": state, "revision": 7})
        self.assertEqual([row["revision"] for row in store.history()], [7])
        self.assertEqual(DemoStateStore(self.db_path).history(), store.history())
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)

    def test_schema_version_one_migrates_without_losing_the_live_snapshot(self):
        path = Path(self.temp_dir.name) / "schema-v1.sqlite3"
        state = self.valid_casebook()
        state["events"] = ["Synthetic revision retained through v1 migration"]
        state["tickets"] = [{
            "id": "HD-1049", "subject": "Synthetic access check", "requester": "A. Example",
            "assignee": "R. Patel", "category": "Access & accounts", "priority": "High",
            "status": "In progress", "ageMinutes": 8, "firstResponseMinutes": 6,
            "updates": ["06:14 · Identity service checked and requester updated"],
        }]
        ready = {key: True for key in (
            "scopeOwner", "windowConfirmed", "impactAssessed", "rollbackDocumented", "validationReady",
        )}
        state["maintenance"] = [{
            "id": "CHG-501", "title": "Synthetic maintenance review", "system": "Synthetic ERP host",
            "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
            "rollback": "Restore the recorded snapshot and verify the service.",
            "validationPlan": "Compare sign-in and response time with the pre-change baseline.", "owner": "R. Patel",
            "risk": "Medium", "status": "Approved", "readiness": ready,
            "history": ["Approved by J. Reviewer · Service impact, checks, and rollback were reviewed"],
        }]
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE demo_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)")
            db.execute("INSERT INTO demo_state VALUES (1, 12, ?)", (payload,))
            db.execute("PRAGMA user_version = 1")
        store = DemoStateStore(path)
        self.assertEqual(store.read(), {"state": state, "revision": 12})
        self.assertEqual(store.read_history(12), {"state": state, "revision": 12})
        next_state = self.valid_casebook()
        next_state["events"] = ["Synthetic revision after v1 migration"]
        self.assertEqual(store.write(12, next_state), 13)
        self.assertEqual([row["revision"] for row in store.history()], [13, 12])
        with sqlite3.connect(path) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)

    def test_newer_schema_is_rejected_without_downgrading_database(self):
        with sqlite3.connect(self.db_path) as db:
            db.execute("PRAGMA user_version = 99")
        with self.assertRaisesRegex(RuntimeError, "newer than supported"):
            DemoStateStore(self.db_path)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 99)

    def test_runtime_schema_mismatch_blocks_all_casebook_api_operations(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute("PRAGMA user_version = 99")
        for path in ("/api/state", "/api/history", "/api/history/1", "/api/health"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 503)
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": state})[0], 503)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 1, "sourceRevision": 1})[0], 503)

    @unittest.skipUnless(os.name == "posix", "POSIX permissions are required for this assertion")
    def test_startup_fails_if_existing_database_permissions_cannot_be_restricted(self):
        with patch.object(Path, "chmod", side_effect=PermissionError("synthetic chmod failure")):
            with self.assertRaisesRegex(PermissionError, "synthetic chmod failure"):
                DemoStateStore(self.db_path)

    def test_restore_refuses_a_corrupted_historical_snapshot(self):
        current = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": current})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state_history SET payload = ? WHERE revision = 1", ('{"not":"a casebook"}',))
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 1, "sourceRevision": 1})[0], 503)
        self.assertEqual(self.request("/api/history/1")[0], 503)
        self.assertEqual(self.request("/api/history")[0], 503)
        self.assertEqual(self.request("/api/state")[0], 503)
        replacement = self.valid_casebook()
        replacement["events"] = ["Attempted overwrite after history mismatch"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": replacement})[0], 503)
        with sqlite3.connect(self.db_path) as db:
            row = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
        self.assertEqual(row, (1, json.dumps(current, separators=(",", ":"), ensure_ascii=False)))

    def test_corrupted_history_metadata_fails_closed(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        corruptions = (
            ("created_at", "2026-01-01T00:00:00"),
            ("restored_from", 1),
            ("created_at", "not-a-timestamp"),
            ("created_at", "x" * 65),
        )
        for field, value in corruptions:
            with self.subTest(field=field, value=value):
                with sqlite3.connect(self.db_path) as db:
                    db.execute(f"UPDATE demo_state_history SET {field} = ? WHERE revision = 1", (value,))
                self.assertEqual(self.request("/api/history")[0], 503)
                self.assertEqual(self.request("/api/history/1")[0], 503)
                self.assertEqual(self.request("/api/state")[0], 503)
                self.assertEqual(self.request("/api/health")[0], 503)
                self.assertEqual(
                    self.request("/api/restore", "POST", {"revision": 1, "sourceRevision": 1})[0],
                    503,
                )

    def test_corrupted_retained_history_blocks_health_writes_and_backup(self):
        for revision in range(2):
            state = self.valid_casebook()
            state["events"] = [f"Retained revision {revision + 1}"]
            self.assertEqual(self.request("/api/state", "PUT", {"revision": revision, "state": state})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state_history SET payload = ? WHERE revision = 1", ('{"invalid":"older"}',))
        self.assertEqual(self.request("/api/health")[0], 503)
        self.assertEqual(self.request("/api/history")[0], 503)
        replacement = self.valid_casebook()
        replacement["events"] = ["Must not extend a corrupt history chain"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 2, "state": replacement})[0], 503)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "invalid history record"):
            backup_database(self.db_path, Path(self.temp_dir.name) / "backups" / "corrupt.sqlite3")

    def test_missing_middle_revision_fails_closed(self):
        for revision in range(3):
            state = self.valid_casebook()
            state["events"] = [f"Retained revision {revision + 1}"]
            self.assertEqual(self.request("/api/state", "PUT", {"revision": revision, "state": state})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute("DELETE FROM demo_state_history WHERE revision = 2")
        for path in ("/api/state", "/api/history", "/api/history/1", "/api/health"):
            self.assertEqual(self.request(path)[0], 503)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 3, "sourceRevision": 1})[0], 503)
        with self.assertRaisesRegex(sqlite3.DatabaseError, "invalid history record"):
            backup_database(self.db_path, Path(self.temp_dir.name) / "backups" / "gap.sqlite3")

    def test_health_marks_a_domain_invalid_active_snapshot_unavailable(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state SET payload = ? WHERE id = 1", ('{"invalid":"snapshot"}',))
        self.assertEqual(self.request("/api/health")[0], 503)
        self.assertEqual(self.request("/api/state")[0], 503)

    def test_active_state_rejects_a_non_integer_database_revision(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state SET revision = 1.5 WHERE id = 1")
        self.assertEqual(self.request("/api/state")[0], 503)
        self.assertEqual(self.request("/api/health")[0], 503)

    def test_api_rejects_unencodable_surrogate_text_without_storage_errors(self):
        for location in ("name", "event", "unknown-field"):
            state = self.valid_casebook()
            if location == "name":
                state["nodes"][0]["name"] = "Synthetic \ud800 node"
            elif location == "event":
                state["events"] = ["Synthetic \ud800 event"]
            else:
                state["nodes"][0]["unused"] = "Synthetic \ud800 value"
            with self.subTest(location=location):
                status, error = self.request("/api/state", "PUT", {"revision": 0, "state": state})
                self.assertEqual(status, 422)
                self.assertIn("error", error)
        self.assertEqual(self.request("/api/state")[1], {"state": None, "revision": 0})

    def test_stored_non_json_numeric_extensions_fail_closed(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        state["nodes"][0]["futureMetric"] = float("nan")
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state SET payload = ? WHERE id = 1", (payload,))
            db.execute("UPDATE demo_state_history SET payload = ? WHERE revision = 1", (payload,))
        self.assertEqual(self.request("/api/state")[0], 503)
        self.assertEqual(self.request("/api/history/1")[0], 503)
        self.assertEqual(self.request("/api/history")[0], 503)
        self.assertEqual(self.request("/api/health")[0], 503)

    def test_non_text_stored_payload_returns_api_storage_errors(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        malformed = sqlite3.Binary(b"\xff")
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state SET payload = ? WHERE id = 1", (malformed,))
            db.execute("UPDATE demo_state_history SET payload = ? WHERE revision = 1", (malformed,))
        self.assertEqual(self.request("/api/state")[0], 503)
        self.assertEqual(self.request("/api/health")[0], 503)
        self.assertEqual(self.request("/api/history")[0], 503)
        self.assertEqual(self.request("/api/history/1")[0], 503)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 1, "sourceRevision": 1})[0], 503)

    def test_oversized_stored_history_payload_fails_closed(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        state["nodes"][0]["extension"] = "x" * MAX_STATE_BYTES
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        self.assertGreater(len(payload.encode("utf-8")), MAX_STATE_BYTES)
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state SET payload = ? WHERE id = 1", (payload,))
            db.execute("UPDATE demo_state_history SET payload = ? WHERE revision = 1", (payload,))
        self.assertEqual(self.request("/api/state")[0], 503)
        self.assertEqual(self.request("/api/history")[0], 503)
        self.assertEqual(self.request("/api/health")[0], 503)

    def test_json_integer_limit_errors_are_returned_as_client_errors(self):
        too_many_digits = b"9" * 5000
        requests = (
            ("/api/state", "PUT", b'{"revision":' + too_many_digits + b',"state":null}'),
            ("/api/restore", "POST", b'{"revision":' + too_many_digits + b',"sourceRevision":1}'),
        )
        for path, method, body in requests:
            with self.subTest(path=path):
                request = urllib.request.Request(
                    self.base_url + path, data=body, method=method,
                    headers={"Content-Type": "application/json"},
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=2)
                # Python 3.11+ limits JSON integer digits at parse time (400); older
                # supported versions reject its revision range (422). Restore requests
                # can hit their smaller body-size cap first (413).
                allowed_statuses = (400, 422, 413) if path == "/api/restore" else (400, 422)
                self.assertIn(error.exception.code, allowed_statuses)
                error.exception.close()

    def test_snapshot_and_history_are_committed_atomically(self):
        original = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": original})[0], 200)
        changed = self.valid_casebook()
        changed["events"] = ["This state must not partially commit"]
        with sqlite3.connect(self.db_path) as db:
            db.execute(
                "CREATE TRIGGER reject_history_revision BEFORE INSERT ON demo_state_history "
                "WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'synthetic history failure'); END"
            )
        status, _ = self.request("/api/state", "PUT", {"revision": 1, "state": changed})
        self.assertEqual(status, 503)
        health_status, health = self.request("/api/health")
        self.assertEqual(health_status, 200)
        self.assertEqual((health["revision"], health["historyCount"]), (1, 1))
        with sqlite3.connect(self.db_path) as db:
            row = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
            history = db.execute("SELECT revision, payload FROM demo_state_history").fetchall()
        self.assertEqual(row, (1, json.dumps(original, separators=(",", ":"), ensure_ascii=False)))
        self.assertEqual(history, [(1, json.dumps(original, separators=(",", ":"), ensure_ascii=False))])

    def test_restore_and_history_are_committed_atomically(self):
        original = self.valid_casebook()
        current = self.valid_casebook()
        current["events"] = ["Current state survives failed restore"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": original})[0], 200)
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": current})[0], 200)
        with sqlite3.connect(self.db_path) as db:
            db.execute(
                "CREATE TRIGGER reject_restore_history BEFORE INSERT ON demo_state_history "
                "WHEN NEW.revision = 3 BEGIN SELECT RAISE(ABORT, 'synthetic restore history failure'); END"
            )
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 2, "sourceRevision": 1})[0], 503)
        self.assertEqual(self.request("/api/health")[1]["revision"], 2)
        self.assertEqual(self.request("/api/state")[1], {"state": current, "revision": 2})
        with sqlite3.connect(self.db_path) as db:
            revisions = db.execute("SELECT revision FROM demo_state_history ORDER BY revision").fetchall()
        self.assertEqual(revisions, [(1,), (2,)])

    def test_restore_rejects_invalid_requests_and_unknown_routes(self):
        for payload in (
            {},
            {"revision": True, "sourceRevision": 1},
            {"revision": 0, "sourceRevision": 0},
            {"revision": 0, "sourceRevision": "1"},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.request("/api/restore", "POST", payload)[0], 422)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 0, "sourceRevision": 1})[0], 404)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 0, "sourceRevision": 10**100})[0], 422)
        self.assertEqual(self.request("/api/not-real", "POST", {})[0], 404)
        for invalid_revision in (1 << 53, 1 << 80):
            with self.subTest(invalid_revision=invalid_revision):
                self.assertEqual(
                    self.request("/api/state", "PUT", {"revision": invalid_revision, "state": self.valid_casebook()})[0],
                    422,
                )
        wrong_media_type = urllib.request.Request(
            self.base_url + "/api/restore", data=b"{}", method="POST",
            headers={"Content-Type": "text/plain"},
        )
        with self.assertRaises(urllib.error.HTTPError) as media_error:
            urllib.request.urlopen(wrong_media_type, timeout=2)
        self.assertEqual(media_error.exception.code, 415)
        media_error.exception.close()
        oversized = urllib.request.Request(
            self.base_url + "/api/restore", data=b"{}", method="POST",
            headers={"Content-Type": "application/json", "Content-Length": "4097"},
        )
        with self.assertRaises(urllib.error.HTTPError) as size_error:
            urllib.request.urlopen(oversized, timeout=2)
        self.assertEqual(size_error.exception.code, 413)
        size_error.exception.close()

    def test_simultaneous_writes_cannot_overwrite_the_same_revision(self):
        states = [self.valid_casebook() for _ in range(32)]
        for index, state in enumerate(states):
            state["events"] = [f"Synthetic concurrent writer {index + 1}"]
        with ThreadPoolExecutor(max_workers=32) as pool:
            results = list(pool.map(
                lambda state: self.request("/api/state", "PUT", {"revision": 0, "state": state}),
                states,
            ))
        self.assertEqual(sorted(status for status, _ in results), [200] + [409] * 31)
        saved = self.request("/api/state")[1]
        self.assertEqual(saved["revision"], 1)
        self.assertIn(saved["state"]["events"], [[state["events"][0]] for state in states])

    def test_separate_server_instances_share_compare_and_swap_safely(self):
        second_server = create_server(port=0, db_path=self.db_path)
        second_thread = threading.Thread(target=second_server.serve_forever, daemon=True)
        second_thread.start()
        try:
            states = [self.valid_casebook(), self.valid_casebook()]
            states[0]["events"] = ["Writer through first server"]
            states[1]["events"] = ["Writer through second server"]
            urls = [
                (self.base_url, states[0]),
                (f"http://127.0.0.1:{second_server.server_address[1]}", states[1]),
            ]

            def write_at(url_and_state):
                url, state = url_and_state
                request = urllib.request.Request(
                    url + "/api/state",
                    data=json.dumps({"revision": 0, "state": state}).encode(),
                    method="PUT",
                    headers={"Content-Type": "application/json"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=3) as response:
                        return response.status
                except urllib.error.HTTPError as error:
                    return error.code

            with ThreadPoolExecutor(max_workers=2) as pool:
                statuses = list(pool.map(write_at, urls))
            self.assertEqual(sorted(statuses), [200, 409])
            accepted = self.request("/api/state")[1]
            self.assertEqual(accepted["revision"], 1)
            self.assertIn(accepted["state"]["events"], [state["events"] for state in states])
            self.assertEqual(self.request("/api/health")[1]["revision"], 1)
        finally:
            second_server.shutdown()
            second_server.server_close()
            second_thread.join(timeout=2)

    def test_restore_racing_a_write_accepts_only_one_compare_and_swap(self):
        original = self.valid_casebook()
        current = self.valid_casebook()
        current["events"] = ["Current accepted revision"]
        competing = self.valid_casebook()
        competing["events"] = ["Concurrent writer"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": original})[0], 200)
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": current})[0], 200)
        operations = [
            ("/api/restore", "POST", {"revision": 2, "sourceRevision": 1}),
            ("/api/state", "PUT", {"revision": 2, "state": competing}),
        ]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda operation: self.request(*operation), operations))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        latest = self.request("/api/state")[1]
        self.assertEqual(latest["revision"], 3)
        self.assertIn(latest["state"]["events"], [["Synthetic demo event"], ["Concurrent writer"]])
        head = self.request("/api/history")[1]["revisions"][0]
        self.assertIn(head["restoredFrom"], [None, 1])

    def test_casebook_survives_server_recreation(self):
        state = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        newer = self.valid_casebook()
        newer["events"] = ["Synthetic revision before restart"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": newer})[0], 200)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 2, "sourceRevision": 1})[0], 200)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

        self.server = create_server(port=0, db_path=self.db_path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.assertEqual(self.request("/api/state"), (200, {"state": state, "revision": 3}))
        revisions = self.request("/api/history")[1]["revisions"]
        self.assertEqual([entry["revision"] for entry in revisions], [3, 2, 1])
        self.assertEqual(revisions[0]["restoredFrom"], 1)

    def test_health_endpoint_and_bind_address_are_local(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(self.request("/api/health"), (200, {
            "ok": True, "storage": "sqlite", "revision": 0,
            "schemaVersion": 2, "historyCount": 0, "historyLimit": 25,
        }))

    def test_security_headers_cover_static_assets_and_api_responses(self):
        for path in ("/", "/docs/homepage-backend-cycle.png", "/api/health"):
            with self.subTest(path=path):
                with urllib.request.urlopen(self.base_url + path, timeout=2) as response:
                    headers = response.headers
                    self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
                    self.assertEqual(headers.get("Referrer-Policy"), "no-referrer")
                    self.assertEqual(headers.get("X-Frame-Options"), "DENY")
                    policy = headers.get("Content-Security-Policy", "")
                    self.assertIn("script-src 'self'", policy)
                    self.assertIn("frame-ancestors 'none'", policy)
                    if path.startswith("/api/"):
                        self.assertEqual(headers.get("Cache-Control"), "no-store")
                    if path.endswith(".png"):
                        self.assertEqual(headers.get_content_type(), "image/png")

    def test_unexpected_host_headers_are_rejected_for_loopback_api(self):
        for host in (
            f"attacker.example:{self.server.server_port}",
            f"localhost:{self.server.server_port + 1}",
            f"localhost:{self.server.server_port}/unexpected",
            f"localhost.:{self.server.server_port}",
        ):
            with self.subTest(host=host):
                request = urllib.request.Request(self.base_url + "/api/health", headers={"Host": host})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=2)
                self.assertEqual(error.exception.code, 421)
                error.exception.close()
        localhost = urllib.request.Request(
            self.base_url + "/api/health", headers={"Host": f"localhost:{self.server.server_port}"},
        )
        with urllib.request.urlopen(localhost, timeout=2) as response:
            self.assertEqual(response.status, 200)
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2) as client:
            client.settimeout(2)
            client.sendall(b"GET /api/health HTTP/1.0\r\n\r\n")
            legacy_response = client.recv(4096)
        self.assertIn(b"200 OK", legacy_response.split(b"\r\n", 1)[0])
        self.assertEqual(self.request("/api/health")[0], 200)

    def test_http11_requires_host_while_http10_remains_supported(self):
        request = b"GET /api/health HTTP/1.1\r\nConnection: keep-alive\r\n\r\n"
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2) as client:
            client.settimeout(2)
            client.sendall(request)
            response = bytearray()
            while chunk := client.recv(4096):
                response.extend(chunk)
        self.assertIn(b" 400 ", bytes(response).split(b"\r\n", 1)[0])
        self.assertIn(b"Connection: close", bytes(response))
        self.assertNotIn(b" 200 ", bytes(response))

    def test_early_http_rejections_close_unread_request_bodies(self):
        port = self.server.server_port
        inner_request = (
            f"GET /api/health HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n"
        ).encode("ascii")
        cases = (
            ("POST", "/api/restore", "127.0.0.1", "text/plain", 415, ""),
            ("POST", "/api/restore", "attacker.example", "application/json", 421, ""),
            ("POST", "/api/restore", "127.0.0.1", "application/json", 400, f"Content-Length: {len(inner_request)}\r\n"),
            ("POST", "/api/restore", "127.0.0.1", "application/json", 400, "Transfer-Encoding: chunked\r\n"),
            ("POST", "/api/restore", "127.0.0.1", "application/json", 400, f"Host: attacker.example:{port}\r\n"),
            ("POST", "/api/restore", "127.0.0.1", "application/json", 400, "Content-Type: text/plain\r\n"),
            ("GET", "/api/health", "127.0.0.1", "application/json", 400, ""),
        )
        with patch.object(self.server.RequestHandlerClass, "protocol_version", "HTTP/1.1"):
            for method, path, host, content_type, expected_status, extra_headers in cases:
                with self.subTest(method=method, host=host, content_type=content_type):
                    request = (
                        f"{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                        f"Content-Type: {content_type}\r\nContent-Length: {len(inner_request)}\r\n"
                        f"{extra_headers}"
                        "Connection: keep-alive\r\n\r\n"
                    ).encode("ascii") + inner_request
                    with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
                        client.settimeout(2)
                        client.sendall(request)
                        response = bytearray()
                        while chunk := client.recv(4096):
                            response.extend(chunk)
                    status_line = bytes(response).split(b"\r\n", 1)[0]
                    self.assertIn(str(expected_status).encode("ascii"), status_line)
                    self.assertNotIn(b" 200 ", bytes(response))
                    self.assertEqual(bytes(response).count(b"HTTP/1."), 1)
                    self.assertIn(b"Connection: close", bytes(response))

    def test_non_decimal_content_length_is_rejected_and_connection_closed(self):
        request = (
            f"PUT /api/state HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
            "Content-Type: application/json\r\nContent-Length: +2\r\nConnection: keep-alive\r\n\r\n{}"
        ).encode("ascii")
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2) as client:
            client.settimeout(2)
            client.sendall(request)
            response = bytearray()
            while chunk := client.recv(4096):
                response.extend(chunk)
        self.assertIn(b" 400 ", bytes(response).split(b"\r\n", 1)[0])
        self.assertIn(b"Connection: close", bytes(response))
        self.assertNotIn(b" 200 ", bytes(response))

    def test_sqlite_path_cannot_be_created_inside_the_repository(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            DemoStateStore(ROOT / "demo-state.sqlite3")

    def test_sqlite_path_directory_is_rejected_without_changing_its_mode(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_directory = Path(temporary_directory) / "existing-directory.sqlite3"
            database_directory.mkdir(mode=0o750)
            before = database_directory.stat().st_mode & 0o777
            with self.assertRaisesRegex(ValueError, "regular file"):
                DemoStateStore(database_directory)
            self.assertEqual(database_directory.stat().st_mode & 0o777, before)

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
        states = []
        for revision in range(3):
            state = self.valid_casebook()
            state["events"] = [f"Synthetic backup revision {revision + 1}"]
            states.append(state)
            self.assertEqual(self.request("/api/state", "PUT", {"revision": revision, "state": state})[0], 200)
        self.assertEqual(self.request("/api/restore", "POST", {"revision": 3, "sourceRevision": 1})[0], 200)
        destination = Path(self.temp_dir.name) / "backups" / "casebook.sqlite3"
        saved_backup = backup_database(self.db_path, destination)
        with sqlite3.connect(saved_backup) as db:
            row = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
            history = db.execute("SELECT revision, payload, restored_from FROM demo_state_history ORDER BY revision").fetchall()
        self.assertEqual(row, (4, json.dumps(states[0], separators=(",", ":"), ensure_ascii=False)))
        self.assertEqual(history, [
            (revision, json.dumps(saved, separators=(",", ":"), ensure_ascii=False), None)
            for revision, saved in enumerate(states, start=1)
        ] + [(4, json.dumps(states[0], separators=(",", ":"), ensure_ascii=False), 1)])
        if os.name == "posix":
            self.assertEqual(saved_backup.stat().st_mode & 0o777, 0o600)
        restored_path = Path(self.temp_dir.name) / "restored-casebook.sqlite3"
        shutil.copyfile(saved_backup, restored_path)
        restored_store = DemoStateStore(restored_path)
        self.assertEqual(restored_store.read(), {"state": states[0], "revision": 4})
        self.assertEqual(restored_store.history()[0]["restoredFrom"], 1)
        existing_backup = saved_backup.read_bytes()
        with self.assertRaises(FileExistsError):
            backup_database(self.db_path, destination)
        self.assertEqual(saved_backup.read_bytes(), existing_backup)

        command_destination = Path(self.temp_dir.name) / "backups" / "cli-casebook.sqlite3"
        environment = {**os.environ, "ICT_PORTFOLIO_DB": str(self.db_path)}
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "backup_demo_state.py"), str(command_destination)],
            capture_output=True, text=True, env=environment, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verified synthetic casebook backup", result.stdout)

    def test_sqlite_backup_refuses_a_logically_mismatched_history_head(self):
        original = self.valid_casebook()
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": original})[0], 200)
        mismatched = self.valid_casebook()
        mismatched["events"] = ["A different but valid history payload"]
        with sqlite3.connect(self.db_path) as db:
            db.execute(
                "UPDATE demo_state_history SET payload = ? WHERE revision = 1",
                (json.dumps(mismatched, separators=(",", ":"), ensure_ascii=False),),
            )
        self.assertEqual(self.request("/api/state")[0], 503)
        self.assertEqual(self.request("/api/history")[0], 503)
        self.assertEqual(self.request("/api/history/1")[0], 503)
        self.assertEqual(self.request("/api/health")[0], 503)
        destination = Path(self.temp_dir.name) / "backups" / "mismatched.sqlite3"
        with self.assertRaisesRegex(sqlite3.DatabaseError, "does not match its history head"):
            backup_database(self.db_path, destination)
        self.assertFalse(destination.exists())
        self.assertEqual(list(destination.parent.iterdir()), [])

    def test_sqlite_backup_is_published_only_after_verification(self):
        self.assertEqual(self.request("/api/state", "PUT", {
            "revision": 0, "state": self.valid_casebook(),
        })[0], 200)
        destination = Path(self.temp_dir.name) / "backups" / "not-yet-verified.sqlite3"
        with patch("scripts.backup_demo_state.verify_backup_database", side_effect=sqlite3.DatabaseError("synthetic verification failure")):
            with self.assertRaisesRegex(sqlite3.DatabaseError, "synthetic verification failure"):
                backup_database(self.db_path, destination)
        self.assertFalse(destination.exists())
        self.assertEqual(list(destination.parent.iterdir()), [])

    @unittest.skipUnless(os.name == "posix", "POSIX symlink behavior is required for this assertion")
    def test_sqlite_backup_refuses_a_preexisting_broken_symlink_destination(self):
        self.assertEqual(self.request("/api/state", "PUT", {
            "revision": 0, "state": self.valid_casebook(),
        })[0], 200)
        backup_directory = Path(self.temp_dir.name) / "backups"
        backup_directory.mkdir()
        target = backup_directory / "uncreated-target.sqlite3"
        destination = backup_directory / "existing-link.sqlite3"
        destination.symlink_to(target.name)
        with self.assertRaisesRegex(FileExistsError, "destination already exists"):
            backup_database(self.db_path, destination)
        self.assertFalse(target.exists())
        self.assertTrue(destination.is_symlink())

    def test_simultaneous_backups_publish_one_complete_file_without_overwrite(self):
        self.assertEqual(self.request("/api/state", "PUT", {
            "revision": 0, "state": self.valid_casebook(),
        })[0], 200)
        destination = Path(self.temp_dir.name) / "backups" / "race.sqlite3"
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(backup_database, self.db_path, destination) for _ in range(2)]
        outcomes = []
        for future in futures:
            try:
                outcomes.append(future.result())
            except FileExistsError:
                outcomes.append("exists")
        self.assertEqual(outcomes.count(destination), 1)
        self.assertEqual(outcomes.count("exists"), 1)
        self.assertEqual(DemoStateStore(destination).read()["revision"], 1)
        self.assertEqual(list(destination.parent.iterdir()), [destination])

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
        for record_type, record in (
            ("findings", {"id": "SEC-١", "title": "Synthetic", "asset": "app-srv-02", "owner": "Unassigned", "responsePlan": "", "resolution": "", "status": "Open", "severity": "Low", "cvss": 1}),
            ("tickets", {"id": "HD-١", "subject": "Synthetic", "requester": "Tester", "assignee": "Unassigned", "category": "Other", "priority": "Normal", "status": "New", "ageMinutes": 0, "firstResponseMinutes": None, "updates": []}),
            ("maintenance", {"id": "CHG-١", "title": "Synthetic", "owner": "R. Patel", "risk": "Low", "status": "Pending approval", "readiness": {key: False for key in ("scopeOwner", "windowConfirmed", "impactAssessed", "rollbackDocumented", "validationReady")}, "history": []}),
        ):
            invalid_id = self.valid_casebook()
            invalid_id[record_type].append(record)
            with self.subTest(record_type=record_type):
                self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": invalid_id})[0], 422)
        self.assertEqual(self.request("/api/not-real")[0], 404)
        self.assertEqual(self.request("/.git/config")[0], 404)

    def test_duplicate_json_object_keys_are_rejected_in_requests_and_storage(self):
        state = self.valid_casebook()
        state_json = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        duplicate_body = f'{{"revision":0,"revision":0,"state":{state_json}}}'.encode("utf-8")
        request = urllib.request.Request(
            self.base_url + "/api/state", data=duplicate_body, method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        duplicate_stored_state = (
            '{"nodes":[],"nodes":[],"findings":[],"tickets":[],"maintenance":[],"events":[]}'
        )
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE demo_state SET payload = ? WHERE id = 1", (duplicate_stored_state,))
            db.execute("UPDATE demo_state_history SET payload = ? WHERE revision = 1", (duplicate_stored_state,))
        self.assertEqual(self.request("/api/state")[0], 503)

    def test_infrastructure_state_must_match_monitored_signals_and_investigation(self):
        for node_id, signal, value in (
            ("core-sw-01", "portUtilization", 81),
            ("core-sw-01", "interfaceErrors", 1.1),
            ("app-srv-02", "cpu", 81),
            ("app-srv-02", "queueDepth", 26),
            ("ap-east-14", "missedHeartbeats", 4),
        ):
            with self.subTest(node=node_id, signal=signal):
                invalid = self.valid_casebook()
                monitored = next(item for item in invalid["nodes"] if item["id"] == node_id)
                monitored["signals"][signal] = value
                self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": invalid})[0], 422)
        state = self.valid_casebook()
        node = next(item for item in state["nodes"] if item["id"] == "app-srv-02")
        node["health"] = "Healthy"
        node["signals"].update({"cpu": 88, "queueDepth": 42})
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        node["signals"].update({"cpu": 61, "memory": 67, "queueDepth": 8})
        node["investigation"] = {
            "owner": "R. Patel", "cause": "ERP worker saturation",
            "action": "Scale the ERP workers and drain the saturated process",
            "status": "Investigating",
        }
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        node["health"] = "Degraded"
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)
        unassigned_investigation = self.valid_casebook()
        unassigned_node = next(item for item in unassigned_investigation["nodes"] if item["id"] == "app-srv-02")
        unassigned_node["investigation"] = {
            "owner": "Unassigned", "cause": "ERP worker saturation",
            "action": "Scale the ERP workers and drain the saturated process",
            "status": "Investigating",
        }
        self.assertEqual(
            self.request("/api/state", "PUT", {"revision": 0, "state": unassigned_investigation})[0],
            422,
        )
        node.update({
            "health": "Offline",
            "investigation": {
                **node["investigation"],
                "status": "Resolved",
                "verification": "ERP login passed; latency and queue depth returned below threshold",
                "notes": "Synthetic recovery check passed.",
            }
        })
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": state})[0], 422)
        node["health"] = "Healthy"
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 1, "state": state})[0], 200)

    def test_cross_application_handoffs_reference_existing_casebook_records(self):
        state = self.valid_casebook()
        state["tickets"].append({
            "id": "HD-1", "subject": "Infrastructure alert", "requester": "ICT Operations",
            "assignee": "Unassigned", "category": "Software", "priority": "High", "status": "New",
            "ageMinutes": 0, "firstResponseMinutes": None, "updates": [], "relatedAssetId": "unknown-host",
        })
        readiness = {key: False for key in (
            "scopeOwner", "windowConfirmed", "impactAssessed", "rollbackDocumented", "validationReady",
        )}
        state["maintenance"].append({
            "id": "CHG-1", "title": "Synthetic patch change", "system": "Synthetic ERP host",
            "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
            "rollback": "Restore the recorded snapshot and verify the service.", "owner": "R. Patel", "risk": "Low",
            "status": "Pending approval", "readiness": readiness, "history": [], "findingId": "SEC-404",
        })
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        state["tickets"][0]["relatedAssetId"] = "app-srv-02"
        state["findings"].append({
            "id": "SEC-404", "title": "Synthetic patch finding", "asset": "app-srv-02", "owner": "Unassigned",
            "responsePlan": "", "resolution": "", "status": "Open", "severity": "High", "cvss": 8.0,
        })
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)

    def test_worked_tickets_need_a_first_response_time_and_work_note(self):
        state = self.valid_casebook()
        state["tickets"].append({
            "id": "HD-501", "subject": "Synthetic access issue", "requester": "A. Example",
            "assignee": "R. Patel", "category": "Access & accounts", "priority": "High",
            "status": "In progress", "ageMinutes": 8, "firstResponseMinutes": None,
            "updates": ["Engineer assigned; checking the access path."],
        })
        state["tickets"][0]["status"] = "New"
        state["tickets"][0]["firstResponseMinutes"] = 6
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        state["tickets"][0]["status"] = "In progress"
        state["tickets"][0]["firstResponseMinutes"] = None
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        self.assertEqual(self.request("/api/state")[1]["revision"], 0)

        state["tickets"][0]["firstResponseMinutes"] = 6
        state["tickets"][0]["updates"] = []
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        self.assertEqual(self.request("/api/state")[1]["revision"], 0)

        state["tickets"][0]["updates"] = ["Checked"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)
        self.assertEqual(self.request("/api/state")[1]["revision"], 0)

        state["tickets"][0]["updates"] = ["06:14 · Checked the identity service and confirmed the access path"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)

    def test_change_decisions_and_outcomes_require_matching_audit_evidence(self):
        ready = {key: True for key in (
            "scopeOwner", "windowConfirmed", "impactAssessed", "rollbackDocumented", "validationReady",
        )}
        scenarios = (
            ("Approved", ready, {}, "Approved by A. Reviewer · Service owner confirmed · rollback plan and impact reviewed for this window"),
            ("Rejected", {**ready, "scopeOwner": False}, {}, "Rejected by A. Reviewer · Validation evidence was incomplete for this service"),
            (
                "In progress", ready, {"preChangeEvidence": "Baseline probe and service sign-in passed before the window"},
                "Implementation started in approved window · Baseline and service owner notification confirmed",
            ),
            (
                "Completed", ready,
                {"preChangeEvidence": "Baseline probe and service sign-in passed before the window",
                 "validationEvidence": "Service sign-in passed and queue depth returned to baseline"},
                "Implementation started in approved window · Baseline and service owner notification confirmed",
            ),
            (
                "Rollback required", ready,
                {"preChangeEvidence": "Baseline probe and service sign-in passed before the window",
                 "validationEvidence": "Service sign-in failed and queue depth remained above baseline"},
                "Implementation started in approved window · Baseline and service owner notification confirmed",
            ),
            (
                "Rolled back", ready,
                {"preChangeEvidence": "Baseline probe and service sign-in passed before the window",
                 "validationEvidence": "Service sign-in failed and queue depth remained above baseline",
                 "rollbackEvidence": "Package reverted; service sign-in passed and queue returned to baseline"},
                "Implementation started in approved window · Baseline and service owner notification confirmed",
            ),
        )
        revision = 0
        for status, readiness, extra_fields, required_entry in scenarios:
            with self.subTest(status=status):
                state = self.valid_casebook()
                change = {
                    "id": "CHG-500", "title": "Synthetic maintenance validation", "system": "Synthetic ERP host",
                    "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
                    "rollback": "Restore the recorded snapshot and verify the service.",
                    "validationPlan": "Compare sign-in and response time with the pre-change baseline.", "owner": "R. Patel",
                    "risk": "Low", "status": status, "readiness": readiness, "history": [required_entry],
                    **extra_fields,
                }
                if status in {"In progress", "Completed", "Rollback required", "Rolled back"}:
                    change["history"].insert(0, "Approved by A. Reviewer · Owner accepted the tested rollback and impact plan")
                if status in {"Completed", "Rollback required", "Rolled back"}:
                    outcome = "Validation passed" if status == "Completed" else "Validation failed"
                    change["history"].append(f"{outcome} · Service response and resource signals were checked")
                if status == "Rolled back":
                    change["history"].append("Rollback executed · Prior package restored and service recovery confirmed")
                state["maintenance"].append(change)
                self.assertEqual(self.request("/api/state", "PUT", {"revision": revision, "state": state})[0], 200)
                revision += 1

                state["maintenance"][0]["history"] = []
                self.assertEqual(self.request("/api/state", "PUT", {"revision": revision, "state": state})[0], 422)
                self.assertEqual(self.request("/api/state")[1]["revision"], revision)

        state = self.valid_casebook()
        state["maintenance"].append({
            "id": "CHG-501", "title": "Synthetic high-risk maintenance", "system": "Synthetic ERP host",
            "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
            "rollback": "Restore the recorded snapshot and verify the service.",
            "validationPlan": "Compare sign-in and response time with the pre-change baseline.", "owner": "R. Patel",
            "risk": "High", "status": "Approved", "readiness": {**ready, "peerReview": True},
            "history": [
                "Peer review by T. Brown · Independent validation plan and rollback path reviewed",
                "Approved by A. Reviewer · Owner accepted the tested rollback and impact plan",
            ],
        })
        self.assertEqual(self.request("/api/state", "PUT", {"revision": revision, "state": state})[0], 200)
        state["maintenance"][0]["history"][0] = (
            "Peer review by R. PATEL · Independent validation plan and rollback path reviewed"
        )
        self.assertEqual(self.request("/api/state", "PUT", {"revision": revision + 1, "state": state})[0], 422)
        self.assertEqual(self.request("/api/state")[1]["revision"], revision + 1)
        state["maintenance"][0]["history"].pop(0)
        self.assertEqual(self.request("/api/state", "PUT", {"revision": revision + 1, "state": state})[0], 422)
        self.assertEqual(self.request("/api/state")[1]["revision"], revision + 1)

        unicode_owner_state = self.valid_casebook()
        unicode_owner_state["maintenance"].append({
            "id": "CHG-502", "title": "Synthetic Unicode owner review", "system": "Synthetic ERP host",
            "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
            "rollback": "Restore the recorded snapshot and verify the service.",
            "validationPlan": "Compare sign-in and response time with the pre-change baseline.", "owner": "Straße",
            "risk": "High", "status": "Approved", "readiness": {**ready, "peerReview": True},
            "history": [
                "Peer review by STRASSE · Independent validation plan and rollback path reviewed",
                "Approved by A. Reviewer · Owner accepted the tested rollback and impact plan",
            ],
        })
        self.assertEqual(
            self.request("/api/state", "PUT", {"revision": revision + 1, "state": unicode_owner_state})[0],
            200,
        )

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
        oversized_numeric_signal = self.valid_casebook()
        oversized_numeric_signal["nodes"][0]["signals"]["portUtilization"] = 10 ** 400
        cases.append(oversized_numeric_signal)
        imprecise_integer_signal = self.valid_casebook()
        imprecise_integer_signal["nodes"][0]["signals"]["portUtilization"] = 9_007_199_254_740_993
        cases.append(imprecise_integer_signal)
        imprecise_extension = self.valid_casebook()
        imprecise_extension["nodes"][0]["extension"] = {"nested": [9_007_199_254_740_993]}
        cases.append(imprecise_extension)
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

    def test_api_requires_canonical_utc_ticket_creation_timestamp(self):
        invalid_timestamps = [
            "2026-W01-1", "2026-001", "2026-10-19T10:00:00", "2026-02-30T10:00:00.000Z",
            "0000-01-01T00:00:00.000Z",
        ]
        for created_at in invalid_timestamps:
            with self.subTest(created_at=created_at):
                state = self.valid_casebook()
                state["tickets"].append({
                    "id": "HD-1", "subject": "Synthetic", "requester": "Tester", "assignee": "Unassigned",
                    "category": "Other", "priority": "Normal", "status": "New", "ageMinutes": 0,
                    "firstResponseMinutes": None, "createdAt": created_at, "updates": [],
                })
                self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)

        state = self.valid_casebook()
        state["tickets"].append({
            "id": "HD-1", "subject": "Synthetic", "requester": "Tester", "assignee": "Unassigned",
            "category": "Other", "priority": "Normal", "status": "New", "ageMinutes": 0,
            "firstResponseMinutes": None, "createdAt": "2026-10-19T10:00:00.123Z", "updates": [],
        })
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 200)

    def test_api_rejects_whitespace_only_required_ticket_and_change_fields(self):
        ticket = {
            "id": "HD-1", "subject": "Synthetic request", "requester": "A. Example", "assignee": "Unassigned",
            "category": "Other", "priority": "Normal", "status": "New", "ageMinutes": 0,
            "firstResponseMinutes": None, "updates": [],
        }
        for field in ("subject", "requester"):
            state = self.valid_casebook()
            state["tickets"].append({**ticket, field: "   "})
            with self.subTest(ticket_field=field):
                self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)

        readiness = {key: False for key in (
            "scopeOwner", "windowConfirmed", "impactAssessed", "rollbackDocumented", "validationReady",
        )}
        change = {
            "id": "CHG-1", "title": "Synthetic ERP change", "system": "Application server · ERP",
            "window": "Planned · 22:00–22:30", "impact": "Finance users may see a brief restart delay.",
            "rollback": "Restore the recorded snapshot and verify the service.", "owner": "R. Patel",
            "risk": "Medium", "status": "Pending approval", "readiness": readiness, "history": [],
        }
        for field in ("title", "system", "window", "impact", "rollback"):
            state = self.valid_casebook()
            state["maintenance"].append({**change, field: "   "})
            with self.subTest(change_field=field):
                self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)

        state = self.valid_casebook()
        state["maintenance"].append({
            **change,
            "readiness": {**readiness, "validationReady": True},
            "validationPlan": "   ",
        })
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": state})[0], 422)

        accepted = self.valid_casebook()
        accepted["maintenance"].append({
            **change,
            "readiness": {**readiness, "validationReady": True},
            "validationPlan": "Verify ERP sign-in, response time, and queue depth against baseline.",
        })
        status, result = self.request("/api/state", "PUT", {"revision": 0, "state": accepted})
        self.assertEqual(status, 200)
        self.assertEqual(result["state"]["maintenance"][0]["readiness"]["validationReady"], True)

    def test_api_evidence_minimums_count_unicode_codepoints(self):
        state = self.valid_casebook()
        state["nodes"][1]["investigation"] = {
            "owner": "R. Patel", "cause": "CPU pressure", "action": "Scale workers", "status": "Resolved",
            "verification": "ERP login passed; latency and queue depth returned below threshold",
            "notes": "😀" * 4,
        }
        self.assertEqual(
            self.request("/api/state", "PUT", {"revision": 0, "state": state})[0],
            422,
            "four emoji are four code points and do not satisfy the eight-character note requirement",
        )

    def test_api_rejects_oversized_state(self):
        request = urllib.request.Request(
            self.base_url + "/api/state",
            data=b"{}",
            method="PUT",
            headers={"Content-Type": "application/json", "Content-Length": str(MAX_STATE_REQUEST_BYTES + 1)},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 413)
        error.exception.close()

    def test_api_accepts_maximum_size_state_with_request_envelope(self):
        state = self.valid_casebook()
        state["events"] = [""]
        compact_size = len(json.dumps(state, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        state["events"][0] = "x" * (MAX_STATE_BYTES - compact_size)
        self.assertEqual(
            len(json.dumps(state, separators=(",", ":"), ensure_ascii=False).encode("utf-8")),
            MAX_STATE_BYTES,
        )
        request_body = json.dumps({"revision": 0, "state": state}).encode("utf-8")
        self.assertGreater(len(request_body), MAX_STATE_BYTES, "the JSON request envelope adds bytes around the casebook")
        self.assertLessEqual(len(request_body), MAX_STATE_REQUEST_BYTES)
        request = urllib.request.Request(
            self.base_url + "/api/state", data=request_body, method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            saved = json.loads(response.read())
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(len(json.dumps(saved["state"], separators=(",", ":"), ensure_ascii=False).encode("utf-8")), MAX_STATE_BYTES)

    def test_api_rejects_excessive_json_nesting_cleanly(self):
        deeply_nested = b'{"revision":0,"state":' + b"[" * 12000 + b"0" + b"]" * 12000 + b"}"
        request = urllib.request.Request(
            self.base_url + "/api/state", data=deeply_nested, method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_api_rejects_malformed_json_content_type_and_boolean_revision(self):
        malformed = urllib.request.Request(
            self.base_url + "/api/state", data=b"{", method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(malformed, timeout=2)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

        wrong_type = urllib.request.Request(
            self.base_url + "/api/state", data=b"{}", method="PUT",
            headers={"Content-Type": "text/plain"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(wrong_type, timeout=2)
        self.assertEqual(error.exception.code, 415)
        error.exception.close()

        self.assertEqual(self.request("/api/state", "PUT", {"revision": True, "state": self.valid_casebook()})[0], 422)

    def test_api_requires_utf8_json_request_bodies(self):
        body = json.dumps({"revision": 0, "state": self.valid_casebook()}).encode("utf-16")
        request = urllib.request.Request(
            self.base_url + "/api/state", data=body, method="PUT",
            headers={"Content-Type": "application/json; charset=utf-16"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.assertEqual(self.request("/api/state"), (200, {"state": None, "revision": 0}))


if __name__ == "__main__":
    unittest.main()
