# Backend operations

The API and SQLite casebook exist to make the five synthetic workflows inspectable and recoverable. They are local demo facilities, not a hosted service. Requirements and ordinary run commands are in the [README](../README.md).

## Local data and backup

By default, the database is stored outside the repository at:

```text
~/.local/share/northstar-ict-portfolio/demo.sqlite3
```

Set `ICT_PORTFOLIO_DB` to choose a different file. The configured location must be outside the repository. On POSIX systems the SQLite database and generated backup are restricted to the owner (`0600`).

Create a checked backup at a new destination:

```sh
python3 scripts/backup_demo_state.py ~/.local/share/northstar-ict-portfolio/casebook-backup.sqlite3
```

The command runs SQLite integrity checks, validates all retained snapshots and their relationship to the active head, then publishes the backup atomically. It refuses to overwrite an existing destination. The backup includes the active snapshot and revision history.

To restore a backup, stop the server first and preserve the current database:

```sh
mv ~/.local/share/northstar-ict-portfolio/demo.sqlite3 ~/.local/share/northstar-ict-portfolio/demo-before-restore-$(date -u +%Y%m%dT%H%M%SZ).sqlite3
cp ~/.local/share/northstar-ict-portfolio/casebook-backup.sqlite3 ~/.local/share/northstar-ict-portfolio/demo.sqlite3
```

If `ICT_PORTFOLIO_DB` points elsewhere, substitute that configured path. These files contain synthetic portfolio state. Reload the browser after the server restarts to load the restored snapshot.

## Inspecting revisions

The API keeps up to 25 consecutive accepted snapshots. List revisions or read a retained revision:

```sh
curl -fsS http://127.0.0.1:4173/api/history | python3 -m json.tool
curl -fsS http://127.0.0.1:4173/api/history/6 | python3 -m json.tool
curl -fsS http://127.0.0.1:4173/api/health | python3 -m json.tool
```

Restore revision 6 only if the current head is revision 8. The API records the restored snapshot as a new revision 9 rather than moving the sequence backwards:

```sh
curl -fsS -X POST http://127.0.0.1:4173/api/restore \
  -H 'Content-Type: application/json' \
  -d '{"revision":8,"sourceRevision":6}' | python3 -m json.tool
```

Use the current head and retained source returned by `/api/history`; these numbers are illustrative. Restore uses the expected current revision, so a concurrent change returns HTTP 409 and leaves the newer snapshot intact. An unknown or expired source returns 404; invalid stored history fails closed with 503. The interface does not expose a restore button.

## API contract

- `GET /api/state` returns `{ "state": null, "revision": 0 }` for an empty database, or the validated current casebook and revision. Stored snapshots are revalidated and checked against their active history row in one read transaction.
- `PUT /api/state` accepts `{ "state": <casebook>, "revision": <expected revision> }` as UTF-8 JSON. Requests and stored snapshots are capped at 1 MB. The server validates core workflow fields, required evidence, monitored-signal consistency, cross-application links, change gates, and exact JavaScript-safe integer values. A stale write returns 409 without replacing the newer state.
- `GET /api/history` lists retained revisions, UTC timestamps, record counts, and restore lineage. `GET /api/history/{revision}` returns one retained snapshot.
- `POST /api/restore` accepts `{ "revision": <expected current revision>, "sourceRevision": <retained revision> }` with a 4 KiB body cap. It checks the expected head, reads the source, appends a new revision, and prunes old history in one transaction.
- `GET /api/health` reports the current revision, schema version, history count, and retention limit. It validates retained history and verifies that the active snapshot matches its latest record.
- Invalid shape returns 422; malformed JSON or ambiguous request framing returns 400; oversized bodies return 413; unsupported media types return 415; missing restore sources return 404; stale writes/restores return 409; invalid stored state returns 503.

Existing databases migrate in place by seeding the current casebook into the history table. Revisions from before that migration cannot be reconstructed. SQLite `user_version` is 2; startup refuses a newer schema and API operations fail closed if the schema changes while the server is running.

The bounded history is a recovery aid, not a security audit trail: it is in the same SQLite file and an operator with filesystem access can alter it. There is no authentication, authorization, multi-user model, cloud backup, or production integration.

## Viewing on a private VPS

If the branch has been made available in the private repository and the VPS has an authorized SSH key, clone it and run the server there:

```sh
git clone --branch development git@github.com:mylo123ai-hue/ict-engineering-portfolio.git
cd ict-engineering-portfolio
npm start
```

The server listens only on `127.0.0.1:4173`. From a trusted computer, open an SSH tunnel:

```sh
ssh -N -L 4173:127.0.0.1:4173 your-user@your-vps
```

Then open <http://127.0.0.1:4173> on that computer and keep the SSH session open. The preview has no authentication. Do not bind it to a public interface or open its port in a firewall.
