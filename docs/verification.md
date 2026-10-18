# Verification record

## Baseline

The starting point for the portfolio was a static vanilla JavaScript single-page application with five simulated operations demos, browser-local persistence, Node's built-in test runner, and no application dependencies or backend. The homepage and five routes rendered. The first improvement retained that architecture and added stronger investigation gates, evidence records, saved-state validation, and recruiter-facing case studies.

## Automated checks

- `npm test` — 16 Node model tests and 13 Python standard-library API/preview tests pass.
- `npm run check` — syntax checks for `src/app.js` and `src/model.js` pass without extra dependencies.
- `node --test --experimental-test-coverage` — model has 100% line coverage and 91.82% branch coverage in the most recent recorded run.
- Tests cover malformed, duplicate-ID, unsupported-asset, and incomplete persisted state; migration of the saved database and firewall utilization signals; SLA calculation and first-response recording on ticket ownership; assigned ticket transitions and verified resolution; security ownership and closure evidence; incident cause/action and recovery evidence; network fault domains across all 64 combinations of the four selectable sites, four symptoms, and four impact scopes; change readiness; independent peer review; and the written-evidence gates for approval, rejection, implementation start, validation, and rollback.

## Browser checks

Executed in headless Chromium 154 using the environment's Playwright 1.62.1 package against the loopback-only local static server. No browser automation dependency was added to the project.

- All six routes rendered without JavaScript page errors.
- The preview server returned the application and documentation assets while returning 404 for workspace metadata, hidden paths, non-portfolio files, and directory-listing requests.
- Route loading issued no requests to external hosts.
- HTML-like text stored in valid node, finding, and ticket fields rendered as text and created no markup or script error.
- A legacy browser save with the old database and firewall utilization field names loaded with their edited metrics and activity intact through the schema migration.
- End-to-end interactions covered monitoring investigation/recovery, a monitoring-to-helpdesk handoff, security triage and evidence-based resolution, security-to-change handoff, ticket creation/update/resolution, DNS/local/WAN network diagnoses and helpdesk handoff, maintenance readiness and approval, approved-window confirmation and pre-change evidence, failed validation and rollback, and independent peer review for a high-risk change.
- Reload checks confirmed verified security closure, resolved ticket audit, rollback evidence, and independent-review evidence survive saved-state validation.
- Modal checks covered accessible dialog labels, inert background, Tab wrapping, Escape and backdrop close, focus restoration, keyboard checklist updates, and the skip link. Route changes across all six views move focus to the new page heading for SPA navigation context.
- Reduced-motion emulation disabled scroll behavior and reduced animation/transition duration to 0.01 ms.
- At 320 px, health and helpdesk table regions expose a screen-reader hint, visible keyboard focus, and left/right arrow scrolling.
- A route-by-viewport check covered the homepage and five apps at widths 320, 360, 390, 520, 768, 820, 1024, and 1440 pixels: 48 combinations, with no horizontal overflow, one page heading, route-specific titles, accessible names on visible interactive controls, and a working first-tab skip link.
- A saved state missing one of the fixed infrastructure assets was rejected on reload; the health page rendered from the safe synthetic seed without page errors.
- At tablet and phone widths, the compact sidebar displays a short label under every route icon while retaining each link's full accessible name.
- A computed-style review led to darker supporting text, status labels, and action colors across the casebook. This is a readability improvement, not a formal WCAG contrast audit.
- At 320 × 720, helpdesk (including the resolution gate), health, security, and maintenance dialogs fit the viewport; the network result fit without page overflow. A mobile incident investigation saved the selected owner.
- The security JSON export produced four synthetic findings with `SEC-2418` first.
- A simulated clock check moved a high-priority ticket from 15 minutes remaining to due soon and then breached.
- A browser-storage quota failure showed session-only warnings for a completed action and a readiness update.
- Security severity/status filters and helpdesk lifecycle filters returned the expected synthetic rows, hid resolved records under the default Active view after rerender, and announced when a filter had no matches.
- Changing site, symptom, or scope after a network run invalidated its old result and handoff action, preserved the edited inputs, and required a fresh run.
- The Cloud region A single-user path returned an endpoint/local-access diagnostic at 390 px without horizontal overflow.
- The browser form was exercised at 390 px across all 64 location/symptom/scope combinations; each rendered four checkpoints and a fault-domain result without page errors or overflow.

## Screenshots

The [screenshot gallery](screenshots.md) links the baseline and current homepage captures, plus one current view for each application. Captures use seeded synthetic data.

## Backend cycle

- Added a Python standard-library JSON API at `/api/state` and `/api/health`; SQLite stores one synthetic casebook snapshot outside the repository by default.
- The API accepts bounded JSON snapshots and checks a revision number on each write. Stale revisions receive HTTP 409 and do not overwrite the shared snapshot.
- Fifteen Python tests cover loopback binding, initial state, SQLite round-trip and restart persistence, simultaneous stale-write rejection, bounded payload shape and declared size, malformed and excessively nested JSON, core domain-field and gate validation, media type and revision handling, SQLite path confinement and file permissions, consistent no-overwrite backups, storage-error responses, unknown API routes, and the existing static-path restrictions.
- Chromium browser checks exercised the API-connected state indicator, ticket creation, persistence after reload and in a fresh browser context, server-backed demo reset, V2 browser-cache import into an empty database, localStorage fallback when API requests fail, concurrent-write conflict backup and recovery, and 320 px fallback layout. No page errors occurred.
- Against a fresh SQLite database, Chromium performed and reloaded one state-changing workflow in each application: a capacity drill, security triage, ticket creation, network diagnostic handoff, and a maintenance readiness update. The resulting synthetic state was present in the API snapshot after reload.
- With server-side domain checks enabled, Chromium completed security resolution, ticket assignment and resolution with requester confirmation, a maintenance failure-to-rollback path, and independent peer review for a high-risk change. Each state passed the API gates and was read back from SQLite.
- If the backend becomes unavailable during a write, or the app is already in browser fallback, subsequent edits are backed up in local storage and surfaced with the backup/recovery controls so a later server load cannot silently replace them.
- The confirmed server-copy action validates that a shared snapshot is reachable before removing the local backup. Chromium verified an offline attempt keeps the backup, while a live two-browser conflict reloads the accepted writer's server copy and leaves no JavaScript errors.
- A `Retry sync` action reuses the last acknowledged revision, persisted locally across reloads. Chromium verified that an outage backup restored after reload can be written once the service returns, and is cleared only after the server accepts the write. A stale retry was rejected with HTTP 409 after another browser advanced the shared state, preserving both the remote writer and local backup.
- Chromium checked all six routes at 320, 390, 768, 1024, and 1440 px (30 combinations), with no horizontal overflow. It also created an offline helpdesk ticket, reloaded the page, and confirmed the unsynced backup and recovery actions remained available; at 320 px those actions use compact, accessibly named icon buttons without overflow.
- An empty database is seeded from a valid existing browser save when available, otherwise from the synthetic default fixture. The API rejects invalid core fields; the browser also runs the full model validator before loading a persisted snapshot.

## Scope limits

The browser checks support the specific UI and workflow behaviors listed above. They are not a complete accessibility audit, cross-browser matrix, production acceptance, or operational suitability review. The applications use synthetic, rule-based examples and a local SQLite snapshot with a browser-cache fallback. They do not connect to infrastructure, scan for vulnerabilities, probe networks, send notifications, enforce identities, or provide cloud persistence. The preview server binds only to loopback; use an SSH tunnel for a private VPS demo. No CI pipeline or public deployment was configured.
