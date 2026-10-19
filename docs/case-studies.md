# Engineering case studies

These are fictional scenarios built from synthetic data. The UI records simulated decisions in the browser; none describes a real incident, customer, change or production action.

## 1 · Infrastructure health — ERP latency

**Problem.** The ERP host reports 184 ms latency, 88% CPU, 81% memory use and a growing queue. The scenario represents degraded service rather than a confirmed outage.

**Investigation.** Compare host health and correlated resource signals, record a likely cause and mitigation, then keep the incident open until recovery evidence is entered.

**Decision and trade-off.** The operator records a targeted action instead of claiming that an alert acknowledgement fixed the service. Recovery updates the synthetic signals, making a before/after check visible.

**Verification.** The workflow requires a verification result and an observation note. Automated model checks cover investigation, invalid empty evidence and recovery state changes; browser checks exercised the investigation and recovery dialogs.

**Lesson demonstrated.** Monitoring is useful when telemetry informs a hypothesis and closure is tied to a measurable recovery check.

## 2 · Security findings — overdue kernel update

**Problem.** Finding SEC-2418 is a critical kernel patch gap on a business-critical ERP host. It is internally reachable from the user VLAN (CVSS 9.8).

**Investigation.** Consider severity with reachability and business impact, assign an accountable owner, and write a response plan. Closure requires a verification record.

**Decision and trade-off.** The recommended route schedules a vendor patch and checks application health. The adjacent sign-in alert demonstrates why source correlation should precede blocking, to reduce false-positive lockout risk.

**Verification.** Tests confirm that missing owner/plan prevents triage and missing closure evidence prevents resolution. Browser verification completed triage and evidence-backed resolution.

**Lesson demonstrated.** A severity score helps prioritise work, but exposure, impact, ownership and verification make the decision operationally useful.

## 3 · IT helpdesk — response and ownership

**Problem.** The synthetic queue includes high-priority access and connectivity requests with requester impact, age and first-response history.

**Investigation.** Review the request details and response target, assign an owner, choose a valid lifecycle action, and leave a work note that another engineer can continue from.

**Decision and trade-off.** High priority receives a shorter illustrative 15-minute first-response target, compared with 30 minutes for standard priority. Newly created tickets age from their browser-local creation timestamp; seeded tickets retain fixed synthetic fixture ages. These are demo rules, not a service contract.

**Verification.** Domain tests cover response targets, invalid transitions, ownership, work-note requirements and requester-confirmed closure. Browser checks progressed an existing ticket and created a ticket from network diagnostic evidence.

**Lesson demonstrated.** Good service-desk work preserves impact, accountability and a useful handover rather than just changing a status label.

## 4 · Network fault isolation — East wing packet loss

**Problem.** Users in one room report packet loss while the synthetic client link shows variable wireless signal and the gateway responds with loss.

**Investigation.** Compare impact scope, local link, default gateway and upstream checks, moving outward from the endpoint. Interpret a failed check as a boundary clue rather than proof that a specific device is faulty.

**Decision and trade-off.** The scenario points to the AP or local uplink with medium confidence. The next discriminating check compares wired and wireless loss and inspects nearest-uplink counters before configuration changes.

**Verification.** Model tests distinguish DNS, local, floor and multi-site symptoms. Browser verification observed the East wing AP/local fault domain and passed its evidence into a new service ticket.

**Lesson demonstrated.** Scope and comparative tests reduce guesswork and make escalation evidence actionable.

## 5 · Change control — ERP security patch

**Problem.** A 22:00–22:30 ERP patch has a documented rollback but lacks a defined post-change validation step.

**Investigation.** Review ownership, window, impact, rollback and validation readiness. The approval gate requires all five readiness checks. High-risk changes also require an independent peer review.

**Decision and trade-off.** The operator records measurable post-change checks and an acceptance threshold before marking validation ready; the UI keeps that readiness gate disabled until the plan exists. Starting implementation also requires confirmation that the approved window is open and a pre-change checkpoint; the confirmation is written to the decision log. A failed validation routes the change to rollback-required; recorded recovery evidence then closes the path as rolled back.

**Verification.** Tests cover readiness gates, independent peer review and pass/rollback transitions, including a start attempt without window confirmation. Browser verification exercised the disabled approval gate, readiness completion, window confirmation, pre-change evidence, failed validation and rollback.

**Lesson demonstrated.** Change approval is an explicit risk decision, and a rehearsable recovery path is part of the change rather than an afterthought.

## Backend case study — recoverable casebook API

**Problem.** The five scenarios shared a browser casebook and a local SQLite snapshot, but an accepted bad change could only be undone by browser-local recovery or a manual database backup restore.

**Investigation.** Keep the service dependency-free and loopback-only, preserve revision compare-and-swap behavior, inspect the existing SQLite schema, and test upgrades from a database created before revision history existed.

**Decision and trade-off.** Each accepted write stores the live snapshot and its history record in one SQLite transaction. The service retains 25 snapshots, adds UTC timestamps and restore lineage, and offers a restore API that requires the caller's expected current revision. Restore reads the source, compares the head, writes the new revision, and prunes history in one transaction. Both normal writes and restores keep the old head if the history insert fails. Restores create a new revision rather than moving the head backwards. Existing databases seed history from their current snapshot; revisions from before the upgrade cannot be reconstructed. State validation checks that the monitored health, the dashboard's illustrative signal thresholds, and investigation status agree, and that ticket asset and change-to-finding handoffs target existing casebook records. Worked tickets need an assigned owner, a recorded first-response time, and a meaningful update. Change approval, rejection, implementation start, validation, and rollback must have matching evidence in the decision trail; high-risk approval also verifies that the peer reviewer differs from the owner. A same-origin Content Security Policy and framing/MIME headers constrain the browser surface; the local handler accepts only loopback Host names and rejects ambiguous request headers and framing to reduce browser-origin and request-smuggling exposure. Duplicate JSON keys and unsupported numeric or Unicode values are rejected. Every API operation checks that retained revisions are consecutive and that the newest record matches the active snapshot; the backup utility verifies SQLite and the same logical relationship before atomically publishing a new backup without overwriting an existing file. When a browser retry meets a newer shared revision, it asks before replacing that view; the prior server snapshot remains in SQLite history, and compare-and-swap still rejects a writer that races the confirmation. This gives a bounded recovery window without adding a database service or claiming an immutable audit log. History is local and can be altered by an operator with file access.

**Verification.** Standard-library tests cover migration, retention, history queries, restore, stale-writer conflicts, corrupted-history rejection, logically inconsistent backup rejection, malformed request framing, and rollback when either a write or restore history insert fails. A local browser check exercised the API round trip on an isolated synthetic database and verified the UI routes at four viewport widths.

**Lesson demonstrated.** Recovery operations should be concurrency-aware, leave a traceable new state, and fail closed when the source snapshot cannot pass domain validation.

## Scope and interpretation

The portfolio demonstrates reasoning, workflow design and state validation in a small static application. It does not demonstrate live monitoring, vulnerability scanning, network probing, identity controls, service-desk integrations, production change execution or certification against a particular framework.
