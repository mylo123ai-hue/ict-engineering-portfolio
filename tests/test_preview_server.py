import json
from concurrent.futures import ThreadPoolExecutor
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
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
        node_ids = ("core-sw-01", "app-srv-02", "db-pri-01", "fw-edge-01", "ap-east-14")
        return {
            "nodes": [{"id": node_id} for node_id in node_ids],
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

    def test_api_rejects_bad_shapes_and_unknown_routes(self):
        status, error = self.request("/api/state", "PUT", {"revision": 0, "state": {"tickets": []}})
        self.assertEqual(status, 422)
        self.assertIn("error", error)
        duplicate = self.valid_casebook()
        duplicate["nodes"][1]["id"] = duplicate["nodes"][0]["id"]
        self.assertEqual(self.request("/api/state", "PUT", {"revision": 0, "state": duplicate})[0], 422)
        self.assertEqual(self.request("/api/not-real")[0], 404)
        self.assertEqual(self.request("/.git/config")[0], 404)

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
