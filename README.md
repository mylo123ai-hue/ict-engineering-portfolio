# Northstar · ICT Engineering Portfolio

A recruiter-facing casebook with five interactive, browser-local ICT operations simulations. Each application walks through a synthetic scenario from signal or request, through investigation and decision, to a recorded outcome. The portfolio is a static site with no backend, database, external service, or runtime dependency.

## Run locally

Requires Node.js 20+ for automated tests and Python 3 for the static server. No install step is needed.

```sh
npm test
npm start
```

Open <http://localhost:4173>. Use **Reset demo** to restore seeded scenarios in the current browser. State is saved in local storage under the V2 demo key.

## The five applications

| Application | Engineering evidence | Demonstration |
| --- | --- | --- |
| Infrastructure Health Monitor | Correlate threshold signals, record a likely cause and action, verify recovery against service metrics | Investigate an alert, then record a recovery check |
| Security Findings Dashboard | Prioritise exposure and impact; assign ownership and a response plan; close only with verification evidence | Triage or resolve a synthetic finding |
| IT Helpdesk Ticket System | Capture requester impact, assign ownership, track a priority-based response target, maintain work notes and valid lifecycle transitions | Create a ticket or progress a queued request |
| Network Fault Isolation Tool | Move from impact scope through client, gateway and service checks; distinguish local, DNS and upstream fault domains | Run a diagnostic and hand the findings to the service desk |
| Maintenance Approval & Rollback | Gate approval on readiness evidence; document impact, validation, implementation decision and recovery path | Review a change, validate it, or route failure into rollback |

All actions are simulations. They update only the browser-local casebook and never contact infrastructure or real users.

## Engineering case studies

See [the case studies](docs/case-studies.md) for the problem, investigation, decision, verification and lesson represented by each scenario. [Verification evidence](docs/verification.md) records the checks actually run and their limits. Screenshots are available in [`docs/`](docs/).

## Architecture and limits

The app is a no-build vanilla JavaScript single-page interface: `src/model.js` owns synthetic fixtures and domain transitions, `src/app.js` renders workflows and handles local interactions, and `src/styles.css` provides the responsive design system. `index.html` supplies shared navigation and status. Tests use Node's built-in test runner; there are no installed packages or services.

All names, alerts, metrics, findings, tickets, changes and outcomes are fictional. Diagnostic results are rule-based examples, not live probes. The application has no authentication, server persistence, access controls, integrations or real notifications and is not an operational control plane.
