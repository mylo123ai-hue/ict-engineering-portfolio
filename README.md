# Northstar · ICT Engineering Portfolio

**Five interactive ICT operations applications that show how an engineer investigates, decides, verifies, and records the outcome.** This recruiter-facing casebook combines infrastructure monitoring, security response, IT service management, network fault isolation, and maintenance change control in a responsive web interface.

The applications run on synthetic scenarios. Their workflows write to a local Python API and SQLite casebook so investigation notes, handoffs, decisions, recovery evidence, and revisions can be inspected after reload. They do not connect to real infrastructure.

**Human-directed, AI-implemented:** the owner selected the project and set its engineering principles. Luna 6 High implemented the original build; Codex Cloud completed the improvement cycles described below.

[Screenshots](docs/screenshots.md) · [Engineering case studies](docs/case-studies.md) · [Verification evidence](docs/verification.md) · [Run locally](#run-the-demo-locally)

<p align="center"><a href="docs/screenshots/final-cycle/homepage-desktop.jpg"><img src="docs/screenshots/final-cycle/homepage-desktop.jpg" alt="Northstar ICT Engineering Portfolio homepage showing five operational applications and a SQLite-backed synthetic casebook" width="100%"></a></p>

<p align="center"><strong>Current application · desktop · synthetic casebook saved to local SQLite</strong></p>

## What the portfolio demonstrates

Each lab presents a concrete operational situation, guided investigation, constrained decision, and recorded evidence. Use the left navigation or the casebook cards to open each application.

| Application | Engineering work shown |
| --- | --- |
| **Infrastructure Health Monitor** | Correlate host and availability signals, document a cause hypothesis and action, then close an incident only after a recovery check. |
| **Security Findings Dashboard** | Consider exposure and business impact, assign an owner, document a response plan, and resolve only with verification evidence. |
| **IT Helpdesk Ticket System** | Capture impact, assign ownership, track illustrative first-response targets, preserve work notes, and confirm resolution with the requester. |
| **Network Fault Isolation Tool** | Compare client, gateway, DNS, and upstream checkpoints; identify a likely fault boundary and hand findings to a ticket. |
| **Maintenance Approval & Rollback** | Gate change approval on readiness evidence, confirm the window and baseline, record validation, and document recovery after a failed check. |

### Real browser captures

These screenshots were captured from the running application in headless Chromium against a temporary SQLite database. The records and people shown are fictional. The full-resolution image opens when selected.

| Infrastructure recovery | Security remediation |
| --- | --- |
| [![Health monitor showing the ERP host recovered with measured signals and one separate synthetic alert still open](docs/screenshots/final-cycle/health-recovery.jpg)](docs/screenshots/final-cycle/health-recovery.jpg) | [![Security dashboard showing SEC-2418 resolved with owner, plan, and evidence while other findings remain visible](docs/screenshots/final-cycle/security-remediation.jpg)](docs/screenshots/final-cycle/security-remediation.jpg) |

| Helpdesk ownership and response | Network fault isolation |
| --- | --- |
| [![Helpdesk queue with a newly created ticket assigned to an engineer and first response recorded](docs/screenshots/final-cycle/helpdesk-first-response.jpg)](docs/screenshots/final-cycle/helpdesk-first-response.jpg) | [![Network diagnostic identifying a likely East wing wireless access point or local uplink fault and next test](docs/screenshots/final-cycle/network-isolation.jpg)](docs/screenshots/final-cycle/network-isolation.jpg) |

| Maintenance recovery |
| --- |
| [![Maintenance request showing approval, implementation, failed validation, and documented rollback evidence](docs/screenshots/final-cycle/maintenance-rollback.jpg)](docs/screenshots/final-cycle/maintenance-rollback.jpg) |

#### Responsive view

![Genuine 390-pixel mobile Chromium capture of the portfolio homepage, its application cards, and synthetic operational summary](docs/screenshots/final-cycle/homepage-mobile.jpg)

**Mobile workflow capture · 390 px**

<p align="center"><a href="docs/screenshots/final-cycle/network-isolation-mobile.jpg"><img src="docs/screenshots/final-cycle/network-isolation-mobile.jpg" alt="Mobile network fault isolation workflow with East wing packet-loss results and an available helpdesk handoff" width="320"></a></p>

## How the project was made

The work began with a single owner prompt: “Build me something that someone hiring an ICT engineer might find impressive.” Prompt Perfect structured the request for the owner’s custom-configured Designer. Designer applied the owner’s engineering principles and proposed project options; the owner selected the ICT Engineering Portfolio. **Luna 6 High implemented the original applications. Codex Cloud performed the later engineering work.**

| Stage | Work | Time |
| --- | --- | --- |
| Original build · Luna 6 High | Implemented the five application simulations and initial portfolio. This work is separate from the improvement-cycle budget. | Original build |
| Frontend improvement · Codex Cloud | Refined recruiter-facing presentation, application workflows, responsive layouts, and accessibility. | 3 hours, as recorded by the owner |
| Backend improvement · Codex Cloud | Added the local API, SQLite persistence, revision-aware writes, retained history, restore, and verified backups. | 3 hours, as recorded by the owner |
| Final engineering refinement · Codex Cloud | Closed browser/API validation gaps, made concurrent-write recovery deliberate and revision-safe, verified all five workflows, and refreshed the screenshots and technical evidence. | See the measured duration in [final-cycle verification](docs/verification.md) |

The owner directed the project, chose the solution, and reviewed the work. Source-code authorship is attributed to the AI systems that implemented each stage; this README does not represent the code as personally hand-written by the owner.

## Architecture

The project keeps a small, dependency-free architecture: vanilla JavaScript in the browser, a Python standard-library server, and a local SQLite file. Browser storage preserves a recovery copy if the local API is unavailable. The server listens on loopback only.

```mermaid
flowchart LR
    UI[Browser · five applications] -->|JSON with expected revision| API[Python standard-library API]
    UI -.->|local fallback and recovery copy| LS[Browser local storage]
    API -->|validate and compare revision| DB[(SQLite casebook)]
    DB -->|checked, no-overwrite copy| Backup[SQLite backup]
```

| Area | Implementation |
| --- | --- |
| Frontend | No-build HTML, responsive CSS, and vanilla JavaScript; `src/model.js` owns fixtures and domain transitions, while `src/app.js` renders workflows and synchronizes state. |
| API | `scripts/serve.py` serves same-origin static assets and JSON endpoints on `127.0.0.1:4173`. It validates host, request framing, payload size, and casebook invariants. |
| Persistence | SQLite stores the active casebook and up to 25 consecutive snapshots. Compare-and-swap revisions reject stale writes; restore creates a new revision and records its source. |
| Recovery | `scripts/backup_demo_state.py` checks database integrity and history consistency, then creates a permission-restricted backup without overwriting an existing destination. |
| Dependencies | Python standard library and Node built-ins for the app and tests. No install step, framework, hosted database, or external service. |

## Verification

The checks below were run locally; there is no GitHub Actions pipeline configured for this repository.

- `npm test` — **19 JavaScript model/accessibility tests and 69 Python API/server tests** pass. Regression coverage checks non-empty asset/finding identities and audit entries; a cross-runtime test sends nine representative states through the live SQLite API and compares the client-side JavaScript and Python validators across 3,895 deterministic single-field and combined casebook mutations.
- `npm run check` — JavaScript syntax checks pass; `python3 -m py_compile scripts/serve.py scripts/backup_demo_state.py` passes.
- **Chromium workflow check** — exercised an infrastructure investigation and recovery, security triage and evidence-backed resolution, helpdesk ticket creation and first response, network diagnosis with ticket handoff, and the maintenance approval-to-rollback path. Each saved state was read back from the temporary SQLite API.
- **Responsive/accessibility checks** — 48 Chromium checks across all six routes and widths from 320 to 1440 CSS px found no horizontal overflow, unnamed visible controls, page errors, or external requests. Dialog checks cover initial focus, background inertness, Tab containment, Escape, and focus return. On a fresh 320 px load, the first Tab reached the skip link. A targeted text-contrast pass prompted darker, slightly larger page labels and helpdesk priority/SLA states; its repeat run found no visible app text below 4.5:1 against solid backgrounds. This is not a formal WCAG audit; detailed scope is in [verification.md](docs/verification.md).
- **Recovery check** — stale writes returned HTTP 409 without replacing the accepted snapshot; restore created a new head and `/api/health` matched retained history. A two-browser conflict check verified cancel preserves both copies, while a confirmed retry saves the browser backup and keeps the previous server revision retrievable in SQLite history. A backup passed `PRAGMA integrity_check` and had POSIX mode `0600`.
- **Browser errors and external requests** — none observed in the final capture/workflow run.

See the [verification record](docs/verification.md) for test scope, browser steps, prior-cycle evidence, and limits. See the [screenshot gallery](docs/screenshots.md) for all current captures and selected earlier views.

## Run the demo locally

Requirements: Python 3.10+ and Node.js 20+. No package installation is needed.

```sh
npm test
npm run check
npm start
```

Open <http://127.0.0.1:4173>. Route directly to an app with `#health`, `#security`, `#helpdesk`, `#network`, or `#maintenance`. The default SQLite file lives outside the repository at `~/.local/share/northstar-ict-portfolio/demo.sqlite3`; `ICT_PORTFOLIO_DB` can select another path. For backup, restore, API examples, and the private SSH-tunnel workflow, see [backend operations](docs/backend-operations.md).

## Scope and limitations

All names, findings, assets, requests, metrics, checks, and change outcomes are synthetic. Health changes, security remediation, network diagnostics, service-desk actions, and change control are simulations: there are no real probes, scans, notifications, external integrations, or infrastructure actions.

The local SQLite casebook is intended for a single operator and a private demo. The server has no authentication or multi-user authorization and must not be exposed publicly. History is bounded and stored in the same database; it is a recovery feature, not an immutable audit log. Browser verification is not a formal WCAG audit, a production acceptance test, or a cross-browser compatibility matrix.

## Project notes

- [Engineering case studies](docs/case-studies.md) — problem, investigation, decision, verification, and lesson for each scenario.
- [Final-cycle screenshots](docs/screenshots.md) — real captures from the running application.
- [Verification record](docs/verification.md) — exact tests, browser evidence, and known scope limits.
- [Backend operations](docs/backend-operations.md) — local data, backups, revisions, restore, and safe VPS viewing.
