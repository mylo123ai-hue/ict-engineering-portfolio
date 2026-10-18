#!/usr/bin/env python3
"""Create a private, consistent SQLite backup of the synthetic casebook."""

import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

if __package__:
    from .serve import (
        DB_PATH, HISTORY_LIMIT, ROOT, SCHEMA_VERSION, validate_history_rows, valid_stored_revision,
    )
else:
    from serve import (
        DB_PATH, HISTORY_LIMIT, ROOT, SCHEMA_VERSION, validate_history_rows, valid_stored_revision,
    )


def verify_backup_database(db):
    """Check SQLite integrity and the active snapshot/history relationship."""
    result = db.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise sqlite3.DatabaseError("SQLite backup failed its integrity check")
    schema_version = db.execute("PRAGMA user_version").fetchone()[0]
    if schema_version != SCHEMA_VERSION:
        raise sqlite3.DatabaseError(f"Unsupported SQLite casebook schema version: {schema_version}")

    current = db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
    rows = db.execute(
        "SELECT revision, created_at, payload, restored_from FROM demo_state_history ORDER BY revision"
    ).fetchall()
    if len(rows) > HISTORY_LIMIT:
        raise sqlite3.DatabaseError("SQLite backup exceeds the retained history limit")
    try:
        validate_history_rows(rows)
    except (ValueError, TypeError, RecursionError, UnicodeError) as error:
        raise sqlite3.DatabaseError("SQLite backup contains an invalid history record") from error
    if current is None:
        if rows:
            raise sqlite3.DatabaseError("SQLite backup contains history without an active casebook")
        return
    if not valid_stored_revision(current["revision"]) or current["revision"] == 0:
        raise sqlite3.DatabaseError("SQLite backup contains an invalid active revision")
    if not rows or rows[-1]["revision"] != current["revision"] or rows[-1]["payload"] != current["payload"]:
        raise sqlite3.DatabaseError("SQLite backup active casebook does not match its history head")


def backup_database(source_path, destination_path):
    source = Path(source_path).expanduser().resolve()
    requested_destination = Path(destination_path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"SQLite casebook not found: {source}")
    if requested_destination.exists() or requested_destination.is_symlink():
        raise FileExistsError(f"Backup destination already exists: {requested_destination}")
    destination = requested_destination.resolve()
    if source == destination:
        raise ValueError("Backup destination must differ from the live database")
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError("Backup destination must be outside the repository")

    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent,
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with closing(sqlite3.connect(source, timeout=5)) as live_db, closing(sqlite3.connect(temporary, timeout=5)) as backup_db:
            live_db.backup(backup_db)
            backup_db.row_factory = sqlite3.Row
            verify_backup_database(backup_db)
        temporary.chmod(0o600)
        # Publish only a completed, verified backup. A hard link fails if the
        # destination appeared concurrently, so this remains an atomic no-clobber operation.
        os.link(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", help="new SQLite backup file path (existing files are never overwritten)")
    args = parser.parse_args()
    try:
        destination = backup_database(DB_PATH, args.destination)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.error(str(error))
    print(f"Verified synthetic casebook backup: {destination}")


if __name__ == "__main__":
    main()
