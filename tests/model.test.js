import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneSeed, nextTicketId, transitionTicket, triageFinding, resolveFinding,
  simulateIncident, recordIncidentInvestigation, recordIncidentRecovery,
  diagnoseNetwork, updateTicket, assessTicketSla, maintenanceAction, readinessChecks
} from "../src/model.js";

test("synthetic fixtures are isolated and cover the five operational data sets", () => {
  const first = cloneSeed();
  const second = cloneSeed();
  first.nodes[0].health = "Offline";
  assert.equal(second.nodes[0].health, "Healthy");
  assert.equal(second.nodes.length, 5);
  assert.ok(second.findings.length && second.tickets.length && second.maintenance.length);
});

test("ticket transitions reject invalid steps and permit a deliberate reopen", () => {
  const ticket = { id: "HD-1048", status: "New" };
  assert.equal(transitionTicket(ticket, "start").status, "In progress");
  assert.equal(transitionTicket(ticket, "wait"), ticket);
  assert.equal(transitionTicket({ ...ticket, status: "In progress" }, "wait").status, "Waiting");
  assert.equal(transitionTicket({ ...ticket, status: "Waiting" }, "resolve").status, "Resolved");
  assert.equal(transitionTicket({ ...ticket, status: "New" }, "resolve").status, "New");
  assert.equal(transitionTicket({ ...ticket, status: "Resolved" }, "reopen").status, "In progress");
});

test("ticket IDs increment from the highest existing sequence", () => {
  assert.equal(nextTicketId([{ id: "HD-1042" }, { id: "HD-1050" }]), "HD-1051");
  assert.equal(nextTicketId([]), "HD-1041");
});

test("first response SLA uses priority target and recorded response time", () => {
  assert.equal(assessTicketSla({ priority: "High", ageMinutes: 4 }).state, "On track");
  assert.equal(assessTicketSla({ priority: "Normal", ageMinutes: 26 }).state, "Due soon");
  assert.equal(assessTicketSla({ priority: "High", ageMinutes: 20 }).state, "Breached");
  assert.equal(assessTicketSla({ priority: "High", firstResponseMinutes: 12 }).state, "Met");
  assert.equal(assessTicketSla({ priority: "Normal", firstResponseMinutes: 34 }).state, "Breached");
});

test("ticket update stores owner and work note with an allowed transition", () => {
  const ticket = { status: "New", assignee: "Unassigned", updates: [], ageMinutes: 8 };
  const changed = updateTicket(ticket, { status: "start", assignee: "R. Patel", note: "Confirmed account is not locked." });
  assert.equal(changed.status, "In progress");
  assert.equal(changed.assignee, "R. Patel");
  assert.match(changed.updates[0], /Confirmed account/);
  assert.equal(updateTicket(ticket, { status: "resolve", assignee: "R. Patel", note: "Attempted fix." }), ticket);
  assert.equal(updateTicket(ticket, { status: "start", assignee: "", note: "Missing owner." }), ticket);
});

test("security triage requires ownership and plan; closure requires evidence", () => {
  const finding = { status: "Open", owner: "Unassigned" };
  assert.equal(triageFinding(finding, { owner: "", responsePlan: "Patch" }), finding);
  const triaged = triageFinding(finding, { owner: "R. Patel", responsePlan: "Patch and verify application health" });
  assert.equal(triaged.status, "Investigating");
  assert.equal(resolveFinding(triaged, { resolution: "" }), triaged);
  assert.equal(resolveFinding(triaged, { resolution: "Updated package set; health checks passed." }).status, "Resolved");
  assert.equal(triageFinding({ ...triaged, status: "Resolved" }, { owner: "Jamie", responsePlan: "Reopen" }).status, "Resolved");
});

test("infrastructure investigation records cause and only closes on a recovery check", () => {
  const seed = cloneSeed();
  const node = seed.nodes.find(item => item.id === "app-srv-02");
  const triaged = recordIncidentInvestigation(node, { cause: "CPU saturation", action: "Scale worker pool" });
  assert.equal(triaged.health, "Degraded");
  assert.equal(triaged.investigation.status, "Investigating");
  assert.equal(recordIncidentRecovery(triaged, { verification: "", notes: "" }), triaged);
  const recovered = recordIncidentRecovery(triaged, { verification: "Latency below threshold", notes: "Response at 38 ms; sign-in test passed." });
  assert.equal(recovered.health, "Healthy");
  assert.equal(recovered.signals.cpu, 61);
  assert.equal(recovered.investigation.status, "Resolved");
});

test("capacity drill produces correlated interface signals", () => {
  const node = cloneSeed().nodes[0];
  const incident = simulateIncident(node);
  assert.equal(incident.health, "Degraded");
  assert.equal(incident.latency, 241);
  assert.equal(incident.signals.interfaceErrors, 4.8);
  assert.equal(simulateIncident(incident), incident);
});

test("network fault isolation distinguishes DNS, local loss, gateway, and WAN scenarios", () => {
  const dns = diagnoseNetwork({ site: "North campus", symptom: "Name lookup failure", scope: "Single user" });
  assert.equal(dns.likelyCause, "DNS resolver or name service");
  assert.equal(dns.checks[2][2], "pass");
  assert.equal(dns.checks[3][2], "fail");
  const local = diagnoseNetwork({ site: "East wing", symptom: "Packet loss", scope: "Single room" });
  assert.equal(local.likelyCause, "Wireless access point or local uplink");
  assert.equal(local.checks[1][2], "warning");
  const gateway = diagnoseNetwork({ site: "North campus", symptom: "No connectivity", scope: "Entire floor" });
  assert.equal(gateway.checks[2][2], "fail");
  assert.equal(gateway.checks[3][2], "blocked");
  const wan = diagnoseNetwork({ site: "Head office", symptom: "Packet loss", scope: "Multiple sites" });
  assert.equal(wan.likelyCause, "WAN edge congestion or circuit loss");
  assert.equal(wan.checks[3][2], "fail");
});

test("change readiness gates approval; implementation records pass or rollback path", () => {
  const change = cloneSeed().maintenance[0];
  assert.equal(readinessChecks.length, 5);
  assert.equal(maintenanceAction(change, "approve"), change);
  const ready = { ...change, readiness: { ...change.readiness, validationReady: true } };
  const approved = maintenanceAction(ready, "approve");
  assert.equal(approved.status, "Approved");
  const started = maintenanceAction(approved, "start");
  assert.equal(started.status, "In progress");
  const rollbackRequired = maintenanceAction(started, "failed");
  assert.equal(rollbackRequired.status, "Rollback required");
  assert.equal(maintenanceAction(rollbackRequired, "rollback").status, "Rolled back");
  assert.equal(maintenanceAction(started, "passed").status, "Completed");
  assert.equal(maintenanceAction(change, "rollback"), change);
});

test("high-risk changes require an independent peer review", () => {
  const change = { ...cloneSeed().maintenance[0], risk: "High", readiness: Object.fromEntries(readinessChecks.map(([key]) => [key, true])) };
  assert.equal(maintenanceAction(change, "approve"), change);
  assert.equal(maintenanceAction({ ...change, readiness: { ...change.readiness, peerReview: true } }, "approve").status, "Approved");
});
