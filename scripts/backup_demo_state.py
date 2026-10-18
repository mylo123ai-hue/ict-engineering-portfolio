#!/usr/bin/env python3
"""Create a private, consistent SQLite backup of the synthetic casebook."""

import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path

if __package__:
    from .serve import DB_PATH, ROOT
else:
    from serve import DB_PATH, ROOT


def backup_database(source_path, destination_path):
    source = Path(source_path).expanduser().resolve()
    destination = Path(destination_path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"SQLite casebook not found: {source}")
    if source == destination:
        raise ValueError("Backup destination must differ from the live database")
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError("Backup destination must be outside the repository")

    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with closing(sqlite3.connect(source, timeout=5)) as live_db, closing(sqlite3.connect(destination, timeout=5)) as backup_db:
            live_db.execute("SELECT revision, payload FROM demo_state WHERE id = 1").fetchone()
            live_db.backup(backup_db)
            result = backup_db.execute("PRAGMA quick_check").fetchone()
            if not result or result[0] != "ok":
                raise sqlite3.DatabaseError("SQLite backup failed its integrity check")
        destination.chmod(0o600)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
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
