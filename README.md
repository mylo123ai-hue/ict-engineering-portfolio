# Northstar · ICT Engineering Portfolio

A recruiter-facing casebook with five interactive ICT operations simulations. Each application walks through a synthetic scenario from signal or request, through investigation and decision, to a recorded outcome. The frontend is a no-build vanilla JavaScript app; a small Python standard-library server provides a same-origin API and SQLite persistence. No application packages, cloud services, or production integrations are used.

## Run locally

Requires Node.js 20+ for automated tests and Python 3.10+ for the local server. No install step is needed.

```sh
npm test
npm run check
npm start
```

Open <http://127.0.0.1:4173>. The server binds to loopback, serves only application and documentation assets, blocks hidden workspace paths, disables directory listings, and exposes `/api/state` for the synthetic casebook snapshot. SQLite state defaults to `~/.local/share/northstar-ict-portfolio/demo.sqlite3`; set `ICT_PORTFOLIO_DB` to choose another file. Existing V2 browser data is imported on the first run when the database is empty. The browser keeps a local cache and falls back to it if the API is unavailable.

The overview links to each application. For a direct local route, append `#health`, `#security`, `#helpdesk`, `#network`, or `#maintenance` to that address.

## Backing up the casebook

Create a consistent, owner-only SQLite backup outside the repository. The destination must be a new file; the command verifies its integrity and never overwrites an existing backup.

```sh
python3 scripts/backup_demo_state.py ~/.local/share/northstar-ict-portfolio/casebook-backup.sqlite3
```

To restore a backup, stop the server first, keep a copy of the current database, copy the backup to the configured database path, and restart the server. For the default path:

```sh
mv ~/.local/share/northstar-ict-portfolio/demo.sqlite3 ~/.local/share/northstar-ict-portfolio/demo-before-restore.sqlite3
cp ~/.local/share/northstar-ict-portfolio/casebook-backup.sqlite3 ~/.local/share/northstar-ict-portfolio/demo.sqlite3
```

If `ICT_PORTFOLIO_DB` points elsewhere, use that path for both commands. These files contain synthetic portfolio data.

## Viewing from a VPS

With your GitHub SSH key authorized for the private repository, clone the `development` branch on the VPS and run `npm start` there:

```sh
git clone --branch development git@github.com:mylo123ai-hue/ict-engineering-portfolio.git
cd ict-engineering-portfolio
npm start
```

The server deliberately listens on `127.0.0.1:4173`. From your own computer, create an SSH tunnel:

```sh
ssh -N -L 4173:127.0.0.1:4173 your-user@your-vps
```

Then open <http://127.0.0.1:4173> on your computer. Keep the SSH session open while browsing. The preview has no authentication and must remain on loopback; do not bind it to a public interface or open its port in a firewall.

## The five applications

| Application | Engineering evidence | Demonstration |
| --- | --- | --- |
| Infrastructure Health Monitor | Correlate threshold signals, record a likely cause and action, verify recovery against service metrics | Investigate an alert, then record a recovery check |
| Security Findings Dashboard | Prioritise exposure and impact; assign ownership and a response plan; close only with verification evidence | Triage or resolve a synthetic finding |
| IT Helpdesk Ticket System | Capture requester impact, assign ownership, track a priority-based response target, maintain work notes and valid lifecycle transitions | Create a ticket or progress a queued request |
| Network Fault Isolation Tool | Move from impact scope through client, gateway and service checks; distinguish local, DNS and upstream fault domains | Run a diagnostic and hand the findings to the service desk |
| Maintenance Approval & Rollback | Gate approval on readiness evidence; document impact, validation, implementation decision and recovery path | Review a change, validate it, or route failure into rollback |

All actions are simulations. They update the local SQLite casebook and browser cache; they never contact infrastructure or real users. Revision checks detect concurrent edits. On a conflict or outage, the browser keeps an unsynced local snapshot and offers a JSON backup, a safe retry using the last acknowledged revision, and a confirmed option to use the current server copy.

## Engineering case studies

See [the case studies](docs/case-studies.md) for the problem, investigation, decision, verification and lesson represented by each scenario. [Verification evidence](docs/verification.md) records the checks actually run and their limits. The [before-and-after screenshot gallery](docs/screenshots.md) shows the recruiter-facing redesign and all five applications.

## Architecture and limits

The frontend is a no-build vanilla JavaScript single-page interface: `src/model.js` owns synthetic fixtures and domain transitions, `src/app.js` renders workflows and synchronizes the local casebook, and `src/styles.css` provides the responsive design system. `scripts/serve.py` serves the static assets and a same-origin JSON API using Python's standard library; `sqlite3` persists a versioned state snapshot. The database is stored outside the repository by default. Tests use Node's and Python's standard libraries; there are no installed application packages.

All names, alerts, metrics, findings, tickets, changes and outcomes are fictional. Diagnostic results are rule-based examples, not live probes. SQLite persistence is local to the server and intended for a single operator or a private SSH-tunneled demo. There is no authentication, authorization, multi-user account model, cloud backup, integration, real notification, or operational control plane. Do not expose the preview server publicly.

### API contract

`GET /api/state` returns `{ "state": null, "revision": 0 }` for a new database, or the saved snapshot and revision. `PUT /api/state` accepts `{ "state": <casebook>, "revision": <expected revision> }`. Each successful write increments the revision; stale writes receive `409 Conflict` and remain in the browser as a recoverable local snapshot. `/api/health` reports whether the SQLite store can be read.

## Personalizing the portfolio

This build intentionally uses a generic demo operator and fictional case studies. Before presenting it as your own job application portfolio, add your identity and only verified, non-sensitive work samples. Keep the simulated cases clearly labeled and do not describe them as incidents or changes from your employment history.
