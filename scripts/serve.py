#!/usr/bin/env python3
"""Serve the portfolio and a loopback-only SQLite API for synthetic demo state."""

import json
import math
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
NOT_FOUND = ROOT / "index.html" / "__preview_not_found__"
ALLOWED_ROOTS = {"index.html", "src", "docs"}
MAX_STATE_BYTES = 1_000_000
MAX_STATE_REQUEST_BYTES = MAX_STATE_BYTES + 1_024
MAX_RESTORE_BYTES = 4_096
HISTORY_LIMIT = 25
CASEBOOK_LIMITS = {"nodes": 32, "findings": 500, "tickets": 500, "maintenance": 300, "events": 100}
# Revisions cross the API boundary as JavaScript numbers and must remain exact.
MAX_SAFE_REVISION = (1 << 53) - 1
MAX_REVISION = MAX_SAFE_REVISION - 1
SCHEMA_VERSION = 2
DEFAULT_DB = Path.home() / ".local" / "share" / "northstar-ict-portfolio" / "demo.sqlite3"
DB_PATH = Path(os.environ.get("ICT_PORTFOLIO_DB", DEFAULT_DB)).expanduser()
NODE_SIGNALS = {
    "core-sw-01": {"portUtilization", "interfaceErrors"},
    "app-srv-02": {"cpu", "memory", "queueDepth"},
    "db-pri-01": {"connectionUtilization", "storage"},
    "fw-edge-01": {"cpu", "sessionUtilization"},
    "ap-east-14": {"missedHeartbeats", "poeDraw"},
}
# Match the health monitor's illustrative threshold callouts for synthetic healthy rows.
HEALTH_SIGNAL_THRESHOLDS = {
    "core-sw-01": {"portUtilization": 80, "interfaceErrors": 1},
    "app-srv-02": {"cpu": 80, "queueDepth": 25},
    "ap-east-14": {"missedHeartbeats": 3},
}
RECOVERY_CHECKS = {
    "core-sw-01": "Interface errors normalized; gateway probe loss returned below threshold",
    "app-srv-02": "ERP login passed; latency and queue depth returned below threshold",
    "ap-east-14": "AP heartbeat restored; client gateway and DNS checks passed",
}
READINESS_KEYS = {"scopeOwner", "windowConfirmed", "impactAssessed", "rollbackDocumented", "validationReady"}
ECMASCRIPT_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680" \
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" \
    "\u2028\u2029\u202f\u205f\u3000\ufeff"


def is_record(value):
    return isinstance(value, dict)


def is_text(value):
    if not isinstance(value, str):
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def trim_text(value):
    """Trim exactly the Unicode whitespace set used by JavaScript String.trim()."""
    return value.strip(ECMASCRIPT_WHITESPACE)


def fold_ascii_case(value):
    """Fold ASCII name casing without depending on runtime Unicode table versions."""
    return re.sub(r"[A-Z]", lambda match: chr(ord(match.group(0)) + 32), value)


def is_one_of(value, options):
    return is_text(value) and value in options


def is_finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def is_portable_json(value):
    """Accept JSON values that keep their meaning in both Python and JavaScript."""
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, str):
        return is_text(value)
    if type(value) is int:
        return -MAX_SAFE_REVISION <= value <= MAX_SAFE_REVISION
    if type(value) is float:
        return math.isfinite(value) and not (value.is_integer() and abs(value) > MAX_SAFE_REVISION)
    if isinstance(value, list):
        return all(is_portable_json(item) for item in value)
    if isinstance(value, dict):
        return all(is_text(key) and is_portable_json(item) for key, item in value.items())
    return False


def valid_stored_revision(value):
    return type(value) is int and 0 <= value <= MAX_SAFE_REVISION


def parse_json(data):
    """Parse JSON while rejecting duplicate keys that different consumers may interpret differently."""
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON object key")
            result[key] = value
        return result

    if isinstance(data, bytes):
        # JSON exchanged between systems is UTF-8; accepting UTF-16/32 byte
        # payloads here would disagree with the API's declared media type.
        data = data.decode("utf-8")
    return json.loads(data, object_pairs_hook=unique_object)


def validate_history_row(row):
    """Decode one retained snapshot only when its revision metadata is coherent."""
    revision = row["revision"]
    created_at = row["created_at"]
    restored_from = row["restored_from"]
    if type(revision) is not int or not 0 < revision <= MAX_SAFE_REVISION:
        raise ValueError("Stored history revision is invalid")
    if not is_text(created_at) or len(created_at) > 64:
        raise ValueError("Stored history timestamp is invalid")
    try:
        timestamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Stored history timestamp is invalid") from error
    if timestamp.tzinfo is None or timestamp.utcoffset() != timezone.utc.utcoffset(timestamp):
        raise ValueError("Stored history timestamp must be UTC")
    if restored_from is not None and (
        type(restored_from) is not int or not 0 < restored_from < revision
    ):
        raise ValueError("Stored history restore lineage is invalid")
    payload = row["payload"]
    if not is_text(payload):
        raise ValueError("Stored history payload is not valid UTF-8 text")
    if len(payload.encode("utf-8")) > MAX_STATE_BYTES:
        raise ValueError("Stored history payload exceeds the state size limit")
    state = parse_json(payload)
    if not valid_state_shape(state):
        raise ValueError("Stored revision failed validation")
    return {"state": state, "revision": revision}


def validate_history_rows(rows):
    """Validate the bounded, ascending revision window and return decoded records."""
    if len(rows) > HISTORY_LIMIT:
        raise ValueError("Stored history exceeds the configured retention limit")
    snapshots = []
    previous_revision = 0
    for row in rows:
        snapshot = validate_history_row(row)
        if snapshot["revision"] <= previous_revision:
            raise ValueError("Stored history revisions are not strictly ascending")
        if previous_revision and snapshot["revision"] != previous_revision + 1:
            raise ValueError("Stored history contains a missing revision")
        previous_revision = snapshot["revision"]
        snapshots.append(snapshot)
    return snapshots


def read_validated_history(db):
    """Read one consistent head/history view and verify their relationship."""
    schema_version = db.execute("PRAGMA user_version").fetchone()[0]
    if schema_version != SCHEMA_VERSION:
        raise ValueError("Unsupported SQLite casebook schema")
    current = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
    rows = db.execute(
        "SELECT revision, created_at, payload, restored_from FROM demo_state_history ORDER BY revision"
    ).fetchall()
    snapshots = validate_history_rows(rows)
    if current is None:
        if rows:
            raise ValueError("History exists without an active casebook")
        return current, rows, snapshots
    if not valid_stored_revision(current["revision"]) or current["revision"] == 0:
        raise ValueError("Stored casebook revision is invalid")
    if not rows or rows[-1]["revision"] != current["revision"] or rows[-1]["payload"] != current["payload"]:
        raise ValueError("Active casebook does not match its history record")
    return current, rows, snapshots


def valid_node(node):
    if not is_record(node) or not is_text(node.get("id")) or node["id"] not in NODE_SIGNALS:
        return False
    if not all(is_text(node.get(key)) for key in ("name", "type", "zone", "uptime", "icon")):
        return False
    if not is_one_of(node.get("health"), {"Healthy", "Degraded", "Offline"}):
        return False
    latency = node.get("latency")
    if latency is not None and (not is_finite_number(latency) or latency < 0):
        return False
    signals = node.get("signals")
    if not is_record(signals) or not NODE_SIGNALS[node["id"]].issubset(signals):
        return False
    if not all(is_finite_number(signals[key]) and signals[key] >= 0 for key in NODE_SIGNALS[node["id"]]):
        return False
    if node["health"] == "Healthy" and any(
        signals[key] > threshold for key, threshold in HEALTH_SIGNAL_THRESHOLDS.get(node["id"], {}).items()
    ):
        return False
    investigation = node.get("investigation")
    if investigation is None:
        return True
    if not is_record(investigation) or not is_one_of(investigation.get("status"), {"Investigating", "Resolved"}):
        return False
    if (
        not all(is_text(investigation.get(key)) and trim_text(investigation[key]) for key in ("owner", "cause", "action"))
        or investigation["owner"] == "Unassigned"
    ):
        return False
    valid_resolution = (
        is_text(investigation.get("verification"))
        and investigation["verification"] == RECOVERY_CHECKS.get(node["id"], "Service response and key resource signals returned to the expected range")
        and is_text(investigation.get("notes"))
        and len(trim_text(investigation["notes"])) >= 8
    )
    if investigation["status"] == "Investigating":
        return node["health"] != "Healthy"
    return valid_resolution and node["health"] == "Healthy"


def valid_finding(finding):
    if not is_record(finding) or not isinstance(finding.get("id"), str) or not re.fullmatch(r"SEC-[0-9]+", finding["id"]):
        return False
    if not all(is_text(finding.get(key)) for key in ("title", "asset", "owner", "responsePlan", "resolution")):
        return False
    if not is_one_of(finding.get("status"), {"Open", "Investigating", "Resolved"}):
        return False
    if not is_one_of(finding.get("severity"), {"Critical", "High", "Medium", "Low"}):
        return False
    cvss = finding.get("cvss")
    if not is_finite_number(cvss) or not 0 <= cvss <= 10:
        return False
    if finding["status"] != "Open" and (not trim_text(finding["owner"]) or finding["owner"] == "Unassigned" or len(trim_text(finding["responsePlan"])) < 12):
        return False
    return finding["status"] != "Resolved" or len(trim_text(finding["resolution"])) >= 12


def valid_ticket(ticket):
    if not is_record(ticket) or not isinstance(ticket.get("id"), str) or not re.fullmatch(r"HD-[0-9]+", ticket["id"]):
        return False
    if not all(is_text(ticket.get(key)) and trim_text(ticket[key]) for key in ("subject", "requester")) or not is_text(ticket.get("assignee")):
        return False
    if not is_one_of(ticket.get("category"), {"Access & accounts", "Hardware", "Network", "Software", "Other"}):
        return False
    if not is_one_of(ticket.get("priority"), {"Low", "Normal", "High"}) or not is_one_of(ticket.get("status"), {"New", "In progress", "Waiting", "Resolved"}):
        return False
    age = ticket.get("ageMinutes")
    first_response = ticket.get("firstResponseMinutes")
    if not is_finite_number(age) or age < 0 or (first_response is not None and (not is_finite_number(first_response) or first_response < 0)):
        return False
    if "createdAt" in ticket:
        created_at = ticket["createdAt"]
        if not is_text(created_at) or not re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", created_at,
        ):
            return False
        try:
            timestamp = datetime.fromisoformat(created_at[:-1] + "+00:00")
            if timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z") != created_at:
                return False
        except ValueError:
            return False
    if not isinstance(ticket.get("updates"), list) or not all(is_text(update) for update in ticket["updates"]):
        return False
    if ticket["status"] == "New" and first_response is not None:
        return False
    if ticket["status"] != "New":
        if (
            not trim_text(ticket["assignee"])
            or ticket["assignee"] == "Unassigned"
            or first_response is None
            or not any(len(trim_text(update)) >= 8 for update in ticket["updates"])
        ):
            return False
    return ticket["status"] != "Resolved" or any("requester/service recovery confirmed" in update for update in ticket["updates"])


def valid_change(change):
    if not is_record(change) or not isinstance(change.get("id"), str) or not re.fullmatch(r"CHG-[0-9]+", change["id"]):
        return False
    if (
        not all(is_text(change.get(key)) and trim_text(change[key]) for key in ("title", "system", "window", "owner"))
        or change["owner"] == "Unassigned"
        or not all(is_text(change.get(key)) and len(trim_text(change[key])) >= 12 for key in ("impact", "rollback"))
    ):
        return False
    statuses = {"Pending approval", "Rejected", "Approved", "In progress", "Completed", "Rollback required", "Rolled back"}
    if not is_one_of(change.get("risk"), {"Low", "Medium", "High"}) or not is_one_of(change.get("status"), statuses):
        return False
    readiness = change.get("readiness")
    history = change.get("history")
    if not is_record(readiness) or not READINESS_KEYS.issubset(readiness) or not all(isinstance(readiness[key], bool) for key in READINESS_KEYS):
        return False
    if readiness["validationReady"] and (
        not is_text(change.get("validationPlan")) or len(trim_text(change["validationPlan"])) < 12
    ):
        return False
    if not isinstance(history, list) or not all(is_text(entry) for entry in history):
        return False
    def has_recorded_decision(marker):
        for entry in history:
            marker_index = entry.find(marker)
            if marker_index == -1:
                continue
            evidence_start = entry.find(" · ", marker_index + len(marker))
            if evidence_start != -1 and len(trim_text(entry[evidence_start + 3:])) >= 12:
                return True
        return False

    def has_independent_peer_review():
        for entry in history:
            if "Peer review by " not in entry:
                continue
            reviewer = trim_text(entry.split("Peer review by ", 1)[1].split(" · ", 1)[0])
            if reviewer and fold_ascii_case(reviewer) != fold_ascii_case(trim_text(change["owner"])):
                return True
        return False

    ready_statuses = {"Approved", "In progress", "Completed", "Rollback required", "Rolled back"}
    if change["status"] in ready_statuses and not all(readiness[key] for key in READINESS_KEYS):
        return False
    if change["status"] in ready_statuses and change["risk"] == "High" and (readiness.get("peerReview") is not True or not has_independent_peer_review()):
        return False
    if change["status"] in ready_statuses and not has_recorded_decision("Approved by "):
        return False
    if change["status"] == "Rejected" and not has_recorded_decision("Rejected by "):
        return False
    if change["status"] in {"In progress", "Completed", "Rollback required", "Rolled back"}:
        evidence = change.get("preChangeEvidence")
        if not is_text(evidence) or len(trim_text(evidence)) < 12:
            return False
        if not has_recorded_decision("Implementation started in approved window"):
            return False
    if change["status"] in {"Completed", "Rollback required"}:
        evidence = change.get("validationEvidence")
        if not is_text(evidence) or len(trim_text(evidence)) < 12:
            return False
        outcome = "Validation passed" if change["status"] == "Completed" else "Validation failed"
        if not has_recorded_decision(outcome):
            return False
    if change["status"] == "Rolled back":
        evidence = change.get("rollbackEvidence")
        if not is_text(evidence) or len(trim_text(evidence)) < 12:
            return False
        if not has_recorded_decision("Rollback executed"):
            return False
    return True


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
    """Enforce core casebook domain invariants server-side."""
    if not isinstance(state, dict) or set(state) != {"nodes", "findings", "tickets", "maintenance", "events"}:
        return False
    if not all(isinstance(state[key], list) and len(state[key]) <= limit for key, limit in CASEBOOK_LIMITS.items()):
        return False
    if not all(is_text(event) for event in state["events"]):
        return False
    validators = {"nodes": valid_node, "findings": valid_finding, "tickets": valid_ticket, "maintenance": valid_change}
    if len(state["nodes"]) != len(NODE_SIGNALS):
        return False
    for key, validate in validators.items():
        records = state[key]
        if not all(validate(record) for record in records):
            return False
        ids = [record["id"] for record in records]
        if len(set(ids)) != len(ids):
            return False
    if {node["id"] for node in state["nodes"]} != set(NODE_SIGNALS):
        return False
    finding_ids = {finding["id"] for finding in state["findings"]}
    for ticket in state["tickets"]:
        if "relatedAssetId" in ticket and (
            not is_text(ticket["relatedAssetId"])
            or (ticket["relatedAssetId"] and ticket["relatedAssetId"] not in NODE_SIGNALS)
        ):
            return False
    for change in state["maintenance"]:
        if "findingId" in change and (
            not is_text(change["findingId"])
            or (change["findingId"] and change["findingId"] not in finding_ids)
        ):
            return False
    # Unknown extension fields must still be valid portable UTF-8 JSON; otherwise
    # persisted state could pass domain checks but fail while encoding an API reply.
    try:
        if not is_portable_json(state):
            return False
        json.dumps(state, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError, RecursionError, OverflowError):
        return False
    return True


class DemoStateStore:
    """Versioned synthetic casebook snapshots stored in SQLite."""

    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        if self.path == ROOT or ROOT in self.path.parents:
            raise ValueError("SQLite casebook storage must be outside the repository")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.exists() and not self.path.is_file():
            raise ValueError("SQLite casebook path must name a regular file")
        if not self.path.exists():
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(descriptor)
            except FileExistsError:
                pass
        if not self.path.is_file():
            raise ValueError("SQLite casebook path must name a regular file")
        try:
            self.path.chmod(0o600)
        except OSError:
            if os.name == "posix":
                raise
        with closing(self._connect()) as db:
            with db:
                schema_version = db.execute("PRAGMA user_version").fetchone()[0]
                if schema_version > SCHEMA_VERSION:
                    raise RuntimeError(f"SQLite casebook schema {schema_version} is newer than supported version {SCHEMA_VERSION}")
                db.execute("CREATE TABLE IF NOT EXISTS demo_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)")
                db.execute(
                    "CREATE TABLE IF NOT EXISTS demo_state_history ("
                    "revision INTEGER PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL, restored_from INTEGER)"
                )
                # Preserve the current snapshot when upgrading a pre-history database.
                current = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
                if current:
                    db.execute(
                        "INSERT OR IGNORE INTO demo_state_history (revision, created_at, payload) VALUES (?, ?, ?)",
                        (current["revision"], datetime.now(timezone.utc).isoformat(), current["payload"]),
                    )
                db.execute(
                    "DELETE FROM demo_state_history WHERE revision NOT IN "
                    "(SELECT revision FROM demo_state_history ORDER BY revision DESC LIMIT ?)",
                    (HISTORY_LIMIT,),
                )
                db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def read(self):
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            current, _, snapshots = read_validated_history(db)
        if current is None:
            return {"state": None, "revision": 0}
        return snapshots[-1]

    def read_history(self, revision):
        if type(revision) is not int or not 0 < revision <= MAX_SAFE_REVISION:
            raise ValueError("History revision is outside the supported range")
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            _, rows, snapshots = read_validated_history(db)
        index = next((index for index, row in enumerate(rows) if row["revision"] == revision), None)
        if index is None:
            return None
        return snapshots[index]

    def history(self):
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            _, rows, snapshots = read_validated_history(db)
        history = []
        for row, snapshot in reversed(list(zip(rows, snapshots))):
            state = snapshot["state"]
            history.append({
                "revision": snapshot["revision"],
                "createdAt": row["created_at"],
                "restoredFrom": row["restored_from"],
                "counts": {key: len(state[key]) for key in ("nodes", "findings", "tickets", "maintenance", "events")},
            })
        return history

    def health(self):
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            schema_version = db.execute("PRAGMA user_version").fetchone()[0]
            current, rows, snapshots = read_validated_history(db)
            history_count = len(rows)
        snapshot = snapshots[-1] if current is not None else {"state": None, "revision": 0}
        if schema_version != SCHEMA_VERSION:
            raise sqlite3.DatabaseError("Unsupported SQLite casebook schema")
        return {
            "ok": True,
            "storage": "sqlite",
            "revision": snapshot["revision"],
            "schemaVersion": schema_version,
            "historyCount": history_count,
            "historyLimit": HISTORY_LIMIT,
        }

    def write(self, expected_revision, state):
        if type(expected_revision) is not int or not 0 <= expected_revision <= MAX_REVISION:
            raise ValueError("Expected revision is outside the supported range")
        if not valid_state_shape(state):
            raise ValueError("Casebook state failed validation")
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        if len(payload.encode("utf-8")) > MAX_STATE_BYTES:
            raise ValueError("Casebook state exceeds the supported storage size")
        with closing(self._connect()) as db:
            with db:
                db.execute("BEGIN IMMEDIATE")
                try:
                    current_row, _, _ = read_validated_history(db)
                except (ValueError, TypeError, RecursionError) as error:
                    raise sqlite3.DatabaseError("Stored history failed validation") from error
                current = current_row["revision"] if current_row is not None else 0
                if current != expected_revision:
                    db.rollback()
                    return None
                revision = current + 1
                self._store_revision(db, revision, payload)
        return revision

    @staticmethod
    def _store_revision(db, revision, payload, restored_from=None):
        if restored_from is not None and (
            type(restored_from) is not int or not 0 < restored_from < revision
        ):
            raise ValueError("Restore lineage is outside the supported range")
        db.execute(
            "INSERT INTO demo_state (id, revision, payload) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload",
            (revision, payload),
        )
        db.execute(
            "INSERT INTO demo_state_history (revision, created_at, payload, restored_from) VALUES (?, ?, ?, ?)",
            (revision, datetime.now(timezone.utc).isoformat(), payload, restored_from),
        )
        db.execute(
            "DELETE FROM demo_state_history WHERE revision NOT IN "
            "(SELECT revision FROM demo_state_history ORDER BY revision DESC LIMIT ?)",
            (HISTORY_LIMIT,),
        )

    def restore(self, expected_revision, source_revision):
        """Restore a retained snapshot as a new revision; never move the head backwards."""
        if type(expected_revision) is not int or not 0 <= expected_revision <= MAX_REVISION:
            raise ValueError("Expected revision is outside the supported range")
        if type(source_revision) is not int or not 0 < source_revision <= MAX_SAFE_REVISION:
            raise ValueError("Source revision is outside the supported range")
        with closing(self._connect()) as db:
            with db:
                db.execute("BEGIN IMMEDIATE")
                try:
                    current_row, history_rows, history_snapshots = read_validated_history(db)
                except (ValueError, TypeError, RecursionError) as error:
                    raise sqlite3.DatabaseError("Stored history failed validation") from error
                current_revision = current_row["revision"] if current_row is not None else 0
                if current_revision != expected_revision:
                    db.rollback()
                    return None, None, "conflict"
                source_index = next(
                    (index for index, row in enumerate(history_rows) if row["revision"] == source_revision), None,
                )
                if source_index is None:
                    db.rollback()
                    return None, None, "missing"
                source = history_snapshots[source_index]
                revision = current_revision + 1
                payload = json.dumps(source["state"], separators=(",", ":"), ensure_ascii=False, allow_nan=False)
                self._store_revision(db, revision, payload, restored_from=source_revision)
        return revision, source["state"], None


class PortfolioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def parse_request(self):
        if not super().parse_request():
            return False
        # Keep HTTP/1.0 clients usable; modern browsers send Host.
        host = self.headers.get("Host")
        if host is None and self.request_version == "HTTP/1.1":
            self.close_connection = True
            self.send_error(400, "Missing Host header")
            return False
        if host is not None:
            parsed_host = None
            try:
                parsed_host = urlsplit(f"//{host}")
                hostname = (parsed_host.hostname or "").lower()
                port = parsed_host.port
            except ValueError:
                hostname, port = "", None
            allowed_hosts = {"127.0.0.1", "localhost"}
            if (
                hostname not in allowed_hosts
                or port not in (None, self.server.server_port)
                or parsed_host is None
                or parsed_host.path != ""
                or parsed_host.query != ""
                or parsed_host.fragment != ""
                or parsed_host.username is not None
                or parsed_host.password is not None
            ):
                self.close_connection = True
                self.send_error(421, "Unexpected Host header")
                return False

        host_headers = self.headers.get_all("Host", [])
        transfer_encodings = self.headers.get_all("Transfer-Encoding", [])
        content_lengths = self.headers.get_all("Content-Length", [])
        content_types = self.headers.get_all("Content-Type", [])
        if transfer_encodings or len(content_lengths) > 1 or len(host_headers) > 1 or len(content_types) > 1:
            self.close_connection = True
            self.send_error(400, "Ambiguous request headers")
            return False
        if content_lengths and not re.fullmatch(r"[0-9]+", content_lengths[0].strip()):
            self.close_connection = True
            self.send_error(400, "Invalid content length")
            return False
        if self.command in {"GET", "HEAD"} and content_lengths:
            try:
                has_body = int(content_lengths[0].strip()) != 0
            except ValueError:
                self.close_connection = True
                self.send_error(400, "Invalid content length")
                return False
            if has_body:
                self.close_connection = True
                self.send_error(400, "GET and HEAD requests cannot contain a body")
                return False
        if self.command not in {"GET", "HEAD", "POST", "PUT"}:
            self.close_connection = True
        return True

    def translate_path(self, path):
        candidate = Path(super().translate_path(path)).resolve()
        return str(candidate) if is_allowed_path(candidate) else str(NOT_FOUND)

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "form-action 'self'; frame-ancestors 'none'",
        )
        super().end_headers()

    def _api_path(self):
        return urlsplit(self.path).path

    def do_GET(self):
        if self._api_path() == "/api/health":
            try:
                health = self.server.store.health()
            except (sqlite3.Error, ValueError, RecursionError, TypeError, KeyError):
                self._send_json(503, {"ok": False, "error": "SQLite storage unavailable"})
                return
            self._send_json(200, health)
        elif self._api_path() == "/api/state":
            try:
                self._send_json(200, self.server.store.read())
            except (sqlite3.Error, ValueError, RecursionError, TypeError):
                self._send_json(503, {"error": "SQLite storage unavailable"})
        elif self._api_path() == "/api/history":
            try:
                self._send_json(200, {"revisions": self.server.store.history(), "limit": HISTORY_LIMIT})
            except (sqlite3.Error, ValueError, RecursionError, KeyError, TypeError):
                self._send_json(503, {"error": "SQLite history unavailable"})
        elif re.fullmatch(r"/api/history/[0-9]+", self._api_path()):
            revision_text = self._api_path().rsplit("/", 1)[1]
            if len(revision_text) > 16:
                self._send_json(404, {"error": "Revision not retained"})
                return
            revision = int(revision_text)
            if not 0 < revision <= MAX_SAFE_REVISION:
                self._send_json(404, {"error": "Revision not retained"})
                return
            try:
                snapshot = self.server.store.read_history(revision)
            except (sqlite3.Error, ValueError, RecursionError):
                self._send_json(503, {"error": "SQLite history unavailable"})
                return
            if snapshot is None:
                self._send_json(404, {"error": "Revision not retained"})
            else:
                self._send_json(200, snapshot)
        elif self._api_path().startswith("/api/"):
            self._send_json(404, {"error": "Not found"})
        else:
            super().do_GET()

    def do_PUT(self):
        if self._api_path() != "/api/state":
            self.close_connection = True
            self._send_json(404, {"error": "Not found"})
            return
        if self.headers.get_content_type() != "application/json":
            self.close_connection = True
            self._send_json(415, {"error": "Expected application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.close_connection = True
            self._send_json(400, {"error": "Invalid content length"})
            return
        if length <= 0 or length > MAX_STATE_REQUEST_BYTES:
            self.close_connection = True
            self._send_json(413 if length > MAX_STATE_REQUEST_BYTES else 400, {"error": "Invalid state request size"})
            return
        try:
            request = parse_json(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError, RecursionError):
            self._send_json(400, {"error": "Invalid JSON"})
            return
        if (
            not isinstance(request, dict)
            or type(request.get("revision")) is not int
            or not 0 <= request["revision"] <= MAX_REVISION
        ):
            self._send_json(422, {"error": "Invalid casebook state"})
            return
        try:
            revision = self.server.store.write(request["revision"], request["state"])
        except (ValueError, TypeError, RecursionError):
            self._send_json(422, {"error": "Invalid casebook state or unsupported JSON values"})
            return
        except sqlite3.Error:
            self._send_json(503, {"error": "SQLite storage unavailable"})
            return
        if revision is None:
            try:
                current = self.server.store.read()
            except (sqlite3.Error, ValueError, RecursionError):
                self._send_json(503, {"error": "SQLite storage unavailable"})
                return
            self._send_json(409, {"error": "State changed in another session", **current})
            return
        self._send_json(200, {"state": request["state"], "revision": revision})

    def do_POST(self):
        if self._api_path() != "/api/restore":
            self.close_connection = True
            self._send_json(404, {"error": "Not found"})
            return
        if self.headers.get_content_type() != "application/json":
            self.close_connection = True
            self._send_json(415, {"error": "Expected application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.close_connection = True
            self._send_json(400, {"error": "Invalid content length"})
            return
        if length <= 0 or length > MAX_RESTORE_BYTES:
            self.close_connection = True
            self._send_json(413 if length > MAX_RESTORE_BYTES else 400, {"error": "Invalid restore request size"})
            return
        try:
            request = parse_json(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError, RecursionError):
            self._send_json(400, {"error": "Invalid JSON"})
            return
        if (
            not isinstance(request, dict)
            or type(request.get("revision")) is not int or not 0 <= request["revision"] <= MAX_REVISION
            or type(request.get("sourceRevision")) is not int
            or not 0 < request["sourceRevision"] <= MAX_SAFE_REVISION
        ):
            self._send_json(422, {"error": "Expected non-negative current revision and positive sourceRevision"})
            return
        try:
            revision, restored_state, error = self.server.store.restore(request["revision"], request["sourceRevision"])
        except (sqlite3.Error, ValueError, RecursionError):
            self._send_json(503, {"error": "SQLite storage unavailable"})
            return
        if error == "missing":
            self._send_json(404, {"error": "Revision not retained"})
            return
        if error == "conflict":
            try:
                current = self.server.store.read()
            except (sqlite3.Error, ValueError, RecursionError):
                self._send_json(503, {"error": "SQLite storage unavailable"})
                return
            self._send_json(409, {"error": "State changed in another session", **current})
            return
        self._send_json(200, {"state": restored_state, "revision": revision, "restoredFrom": request["sourceRevision"]})


class PortfolioHTTPServer(ThreadingHTTPServer):
    """Allow short local request bursts to reach the threaded handler pool."""

    request_queue_size = 64


def create_server(host="127.0.0.1", port=4173, db_path=DB_PATH):
    if host != "127.0.0.1":
        raise ValueError("The portfolio preview server must bind to 127.0.0.1")
    server = PortfolioHTTPServer((host, port), PortfolioHandler)
    try:
        server.store = DemoStateStore(db_path)
    except Exception:
        server.server_close()
        raise
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
