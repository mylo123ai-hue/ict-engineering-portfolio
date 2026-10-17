# Northstar · ICT Engineering Portfolio

A recruiter-facing casebook with five interactive, browser-local ICT operations simulations. Each application walks through a synthetic scenario from signal or request, through investigation and decision, to a recorded outcome. It is a static, no-build site with no application packages, backend, database, or external service.

## Run locally

Requires Node.js 20+ for automated tests and Python 3 for the static server. No install step is needed.

```sh
npm test
npm run check
npm start
```

Open <http://127.0.0.1:4173>. The static preview binds to loopback, serves only the application and documentation assets, blocks hidden workspace paths, and disables directory listings. Use **Reset demo** to restore seeded scenarios in the current browser. State is saved in local storage under the V2 demo key.

The overview links to each application. For a direct local route, append `#health`, `#security`, `#helpdesk`, `#network`, or `#maintenance` to that address.

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

See [the case studies](docs/case-studies.md) for the problem, investigation, decision, verification and lesson represented by each scenario. [Verification evidence](docs/verification.md) records the checks actually run and their limits. The [before-and-after screenshot gallery](docs/screenshots.md) shows the recruiter-facing redesign and all five applications.

## Architecture and limits

The app is a no-build vanilla JavaScript single-page interface: `src/model.js` owns synthetic fixtures and domain transitions, `src/app.js` renders workflows and handles local interactions, and `src/styles.css` provides the responsive design system. `index.html` supplies shared navigation and status. Tests use Node's and Python's standard libraries; there are no installed packages or services.

All names, alerts, metrics, findings, tickets, changes and outcomes are fictional. Diagnostic results are rule-based examples, not live probes. The application has no authentication, server persistence, access controls, integrations or real notifications and is not an operational control plane.

## Personalizing the portfolio

This build intentionally uses a generic demo operator and fictional case studies. Before presenting it as your own job application portfolio, add your identity and only verified, non-sensitive work samples. Keep the simulated cases clearly labeled and do not describe them as incidents or changes from your employment history.
