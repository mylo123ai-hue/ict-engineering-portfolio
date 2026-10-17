# Northstar · ICT Engineering Portfolio

A responsive, single-page ICT engineering portfolio with five interactive operational demos. It runs as a static site and uses browser local storage; there is no backend, service, or external data connection.

## Run locally

Requires Node.js 20+ for tests and Python 3 for the static server. No package installation is required.

```sh
npm test
npm start
```

Open `http://localhost:4173`. To reset all sample state, use **Reset demo** in the top bar. The reset also clears saved changes in the browser.

## Applications

- **Infrastructure health monitor:** view five sample assets, availability, response time, active alerts, acknowledge an alert, and toggle a simulated latency incident.
- **Security findings:** filter findings by severity and status, move an issue into investigation, resolve it, and export a JSON report.
- **IT helpdesk:** create tickets, filter the queue, and advance ticket status through new, in progress, waiting, and resolved.
- **Network fault isolation:** select a site, symptom, and impact scope to run simulated endpoint, gateway, and DNS checks; turn the output into a helpdesk ticket.
- **Maintenance & rollback:** submit a change request, approve or reject pending work, mark an approved change complete, or record rollback execution.

## Data and limitations

All names, events, metrics, findings, and changes are fictional. Data persists in the current browser profile only. Reloading retains changes; **Reset demo** restores the original fixtures. Diagnostic results are rule-based illustrations, not live tests. Approval and rollback actions update the demo state only and never affect infrastructure. The application has no user authentication, server-side storage, integrations, notifications, or access controls. Use it as a portfolio demonstration, not as an operational control plane.

## Verification

Run `npm test` for automated domain-workflow tests. Browser-based verification evidence and any constraints are recorded in [`docs/verification.md`](docs/verification.md).
