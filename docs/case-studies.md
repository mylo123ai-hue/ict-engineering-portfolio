# Engineering case studies

These are fictional scenarios built from synthetic data. The UI records simulated decisions in the browser; none describes a real incident, customer, change or production action.

## 1 · Infrastructure health — ERP latency

**Problem.** The ERP host reports 184 ms latency, 88% CPU, 81% memory use and a growing queue. The scenario represents degraded service rather than a confirmed outage.

**Investigation.** Compare host health and correlated resource signals, record a likely cause and mitigation, then keep the incident open until recovery evidence is entered.

**Decision and trade-off.** The operator records a targeted action instead of claiming that an alert acknowledgement fixed the service. Recovery updates the synthetic signals, making a before/after check visible.

**Verification.** The workflow requires a verification result and an observation note. Automated model checks cover investigation, invalid empty evidence and recovery state changes; browser checks exercised the investigation and recovery dialogs.

**Lesson demonstrated.** Monitoring is useful when telemetry informs a hypothesis and closure is tied to a measurable recovery check.

## 2 · Security findings — overdue kernel update

**Problem.** Finding SEC-2418 is a critical, externally unexposed but user-VLAN-reachable kernel patch gap on a business-critical ERP host (CVSS 9.8).

**Investigation.** Consider severity with reachability and business impact, assign an accountable owner, and write a response plan. Closure requires a verification record.

**Decision and trade-off.** The recommended route schedules a vendor patch and checks application health. The adjacent sign-in alert demonstrates why source correlation should precede blocking, to reduce false-positive lockout risk.

**Verification.** Tests confirm that missing owner/plan prevents triage and missing closure evidence prevents resolution. Browser verification completed triage and evidence-backed resolution.

**Lesson demonstrated.** A severity score helps prioritise work, but exposure, impact, ownership and verification make the decision operationally useful.

## 3 · IT helpdesk — response and ownership

**Problem.** The synthetic queue includes high-priority access and connectivity requests with requester impact, age and first-response history.

**Investigation.** Review the request details and response target, assign an owner, choose a valid lifecycle action, and leave a work note that another engineer can continue from.

**Decision and trade-off.** High priority receives a shorter illustrative 15-minute first-response target, compared with 30 minutes for standard priority. These are demo rules, not a service contract.

**Verification.** Domain tests cover targets, invalid transitions, ownership and work-note requirements. Browser checks progressed an existing ticket and created a ticket from network diagnostic evidence.

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

**Decision and trade-off.** The operator must complete missing validation planning before approval. During implementation, a failed validation routes the change to rollback-required; recorded recovery evidence then closes the path as rolled back.

**Verification.** Tests cover readiness gates, peer review and both pass/rollback transitions. Browser verification exercised the disabled approval gate, readiness completion, implementation, failed validation and rollback.

**Lesson demonstrated.** Change approval is an explicit risk decision, and a rehearsable recovery path is part of the change rather than an afterthought.

## Scope and interpretation

The portfolio demonstrates reasoning, workflow design and state validation in a small static application. It does not demonstrate live monitoring, vulnerability scanning, network probing, identity controls, service-desk integrations, production change execution or certification against a particular framework.
