import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneSeed, migrateDemoState, isDemoState, textLength, nextCaseId, nextTicketId, transitionTicket, triageFinding, resolveFinding,
  simulateIncident, recordIncidentInvestigation, recordIncidentRecovery, recoveryChecks,
  diagnoseNetwork, updateTicket, assessTicketSla, maintenanceAction, readinessChecks
} from "../src/model.js";

test("synthetic fixtures are isolated and cover the five operational data sets", () => {
  const first = cloneSeed();
  const second = cloneSeed();
  first.nodes[0].health = "Offline";
  assert.equal(second.nodes[0].health, "Healthy");
  assert.equal(second.nodes.length, 5);
  assert.equal(second.nodes.find(node => node.id === "db-pri-01").signals.connectionUtilization, 38);
  assert.equal(second.nodes.find(node => node.id === "fw-edge-01").signals.sessionUtilization, 41);
  assert.ok(second.findings.length && second.tickets.length && second.maintenance.length);
});

test("demo state validation rejects truncated or malformed saved data", () => {
  const saved = cloneSeed();
  assert.equal(isDemoState(saved), true);
  assert.equal(isDemoState(null), false);
  assert.equal(isDemoState({ ...saved, nodes: [] }), false);
  assert.equal(isDemoState({ ...saved, nodes: saved.nodes.filter(node => node.id !== "app-srv-02") }), false);
  assert.equal(isDemoState({ ...saved, nodes: saved.nodes.map(node => node.id === "core-sw-01" ? { ...node, id: "unsupported-node-01" } : node) }), false);
  assert.equal(isDemoState({ ...saved, tickets: [saved.tickets[0], { ...saved.tickets[1], id: saved.tickets[0].id }] }), false);
  assert.equal(isDemoState({ ...saved, nodes: saved.nodes.map(node => node.id === "app-srv-02" ? { ...node, investigation: { cause: "CPU pressure", action: "Drain the worker pool", status: "Investigating" } } : node) }), false);
  assert.equal(isDemoState({ ...saved, tickets: [{ id: "HD-1", status: "Unknown" }] }), false);
  assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[0], priority: "Urgent" }] }), false);
  assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[0], status: "In progress", assignee: "Unassigned" }] }), false);
  assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[0], createdAt: "not a timestamp" }] }), false);
  for (const createdAt of ["2026-W01-1", "2026-001", "2026-10-19T10:00:00", "2026-02-30T10:00:00.000Z", "0000-01-01T00:00:00.000Z"]) {
    assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[1], createdAt }] }), false, `rejects non-canonical ticket timestamp ${createdAt}`);
  }
  assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[1], createdAt: "2026-10-19T10:00:00.000Z" }] }), true);
  for (const field of ["subject", "requester"]) {
    assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[1], [field]: "   " }] }), false, `rejects a blank ${field}`);
  }
  assert.equal(isDemoState({ ...saved, findings: [{ ...saved.findings[0], severity: "<img src=x onerror=alert(1)>" }] }), false);
  assert.equal(isDemoState({ ...saved, findings: [{ ...saved.findings[0], cvss: '9.8"><img src=x>' }] }), false);
  assert.equal(isDemoState({ ...saved, nodes: [{ ...saved.nodes[0], signals: { ...saved.nodes[0].signals, interfaceErrors: "4.8%" } }] }), false);
  assert.equal(isDemoState({ ...saved, nodes: saved.nodes.map(node => node.id === "db-pri-01" ? { ...node, signals: { connections: 38, storage: 64 } } : node) }), false);
  assert.equal(isDemoState({ ...saved, nodes: saved.nodes.map(node => node.id === "fw-edge-01" ? { ...node, signals: { cpu: 24, sessions: 41 } } : node) }), false);
  assert.equal(isDemoState({ ...saved, maintenance: [{ ...saved.maintenance[0], readiness: null }] }), false);
  for (const field of ["title", "system", "window", "impact", "rollback"]) {
    assert.equal(isDemoState({ ...saved, maintenance: [{ ...saved.maintenance[0], [field]: "   " }] }), false, `rejects a blank change ${field}`);
  }
  assert.equal(isDemoState({ ...saved, maintenance: [{ ...saved.maintenance[0], impact: "😀".repeat(6) }] }), false, "six emoji are six Unicode characters, not twelve evidence characters");
  assert.equal(isDemoState({ ...saved, maintenance: [{ ...saved.maintenance[0], readiness: { ...saved.maintenance[0].readiness, validationReady: true }, validationPlan: "   " }] }), false);
  const planGate = cloneSeed();
  assert.equal(isDemoState(planGate), true, "unready request can be saved while the plan is outstanding");
  planGate.maintenance[0].readiness.validationReady = true;
  assert.equal(isDemoState(planGate), false, "validation cannot be marked ready without a recorded plan");
  planGate.maintenance[0].validationPlan = "Verify ERP sign-in, response time, and queue depth after the change.";
  assert.equal(isDemoState(planGate), true, "a measurable plan allows readiness to be recorded");
  assert.equal(isDemoState({ ...saved, findings: [{ ...saved.findings[0], status: "Resolved", owner: "R. Patel", responsePlan: "Patch and verify the application", resolution: "" }] }), false);
  assert.equal(isDemoState({ ...saved, tickets: [{ ...saved.tickets[0], status: "Resolved" }] }), false);
  assert.equal(isDemoState({ ...saved, nodes: saved.nodes.map(node => node.id === "app-srv-02" ? { ...node, investigation: { owner: "R. Patel", cause: "CPU pressure", action: "Scale worker pool", status: "Resolved" } } : node) }), false);
  assert.equal(isDemoState({ ...saved, maintenance: [{ ...saved.maintenance[0], status: "In progress", readiness: Object.fromEntries(readinessChecks.map(([key]) => [key, true])) }] }), false);
  assert.equal(isDemoState({ ...saved, maintenance: [{ ...saved.maintenance[0], risk: "High", status: "Approved", readiness: { ...Object.fromEntries(readinessChecks.map(([key]) => [key, true])), peerReview: true }, history: ["Approved by Jamie Diaz"] }] }), false);
  const readyChange = {
    ...saved.maintenance[0], status: "Completed",
    readiness: Object.fromEntries(readinessChecks.map(([key]) => [key, true])),
    preChangeEvidence: "Baseline health check passed before work.",
    validationPlan: "Confirm the service response against the approved baseline.",
    validationEvidence: "ERP response returned below the agreed threshold.",
    history: [
      "09:00 · Approved by Jamie Diaz · Impact and recovery checks are defined.",
      "22:00 · Implementation started in approved window · Baseline health check passed before work.",
      "22:20 · Validation passed · ERP response returned below the agreed threshold."
    ]
  };
  assert.equal(isDemoState({ ...saved, maintenance: [readyChange] }), true);
  assert.equal(isDemoState({ ...saved, maintenance: [{ ...readyChange, status: "Rolled back", rollbackEvidence: "Restored snapshot and confirmed service recovery.", history: [...readyChange.history, "22:30 · Validation failed · ERP response remained above its baseline.", "22:35 · Rollback executed · Restored snapshot and confirmed service recovery."] }] }), true);
});

test("browser state validation matches API evidence gates for worked tickets", () => {
  const missingFirstResponse = cloneSeed();
  missingFirstResponse.tickets[0].firstResponseMinutes = null;
  assert.equal(isDemoState(missingFirstResponse), false);

  const missingWorkNote = cloneSeed();
  missingWorkNote.tickets[0].updates = [];
  assert.equal(isDemoState(missingWorkNote), false);

  const newTicketWithResponse = cloneSeed();
  newTicketWithResponse.tickets[1].firstResponseMinutes = 3;
  assert.equal(isDemoState(newTicketWithResponse), false);

  const brokenAssetHandoff = cloneSeed();
  brokenAssetHandoff.tickets[0].relatedAssetId = "missing-host";
  assert.equal(isDemoState(brokenAssetHandoff), false);

  const brokenFindingHandoff = cloneSeed();
  brokenFindingHandoff.maintenance[0].findingId = "SEC-9999";
  assert.equal(isDemoState(brokenFindingHandoff), false);

  const healthyOverThreshold = cloneSeed();
  const erp = healthyOverThreshold.nodes.find(node => node.id === "app-srv-02");
  erp.health = "Healthy";
  assert.equal(isDemoState(healthyOverThreshold), false);

  const unsubstantiatedApproval = cloneSeed();
  Object.keys(unsubstantiatedApproval.maintenance[0].readiness).forEach(key => { unsubstantiatedApproval.maintenance[0].readiness[key] = true; });
  unsubstantiatedApproval.maintenance[0].status = "Approved";
  assert.equal(isDemoState(unsubstantiatedApproval), false);

  const sameOwnerPeerReview = cloneSeed();
  const highRiskChange = sameOwnerPeerReview.maintenance[0];
  highRiskChange.risk = "High";
  highRiskChange.status = "Approved";
  Object.keys(highRiskChange.readiness).forEach(key => { highRiskChange.readiness[key] = true; });
  highRiskChange.readiness.peerReview = true;
  highRiskChange.history.push("09:00 · Peer review by R. Patel · Scope and rollback reviewed.");
  highRiskChange.history.push("09:01 · Approved by Jamie Diaz · Impact and recovery checks are defined.");
  assert.equal(isDemoState(sameOwnerPeerReview), false);

  const recordedIndependentReview = cloneSeed();
  const reviewedChange = recordedIndependentReview.maintenance[0];
  reviewedChange.risk = "High";
  reviewedChange.status = "Approved";
  reviewedChange.validationPlan = "Confirm ERP sign-in and compare response time with the approved baseline.";
  Object.keys(reviewedChange.readiness).forEach(key => { reviewedChange.readiness[key] = true; });
  reviewedChange.readiness.peerReview = true;
  reviewedChange.history.push("09:00 · Peer review by Jamie Diaz · Scope and rollback reviewed.");
  reviewedChange.history.push("09:01 · Approved by Jamie Diaz · Impact and recovery checks are defined.");
  assert.equal(isDemoState(recordedIndependentReview), true);

  const overLimit = cloneSeed();
  overLimit.events = Array.from({ length: 101 }, () => "Synthetic event");
  assert.equal(isDemoState(overLimit), false);

  const extraTopLevelField = cloneSeed();
  extraTopLevelField.debug = true;
  assert.equal(isDemoState(extraTopLevelField), false);

  const unsafeExtensionInteger = cloneSeed();
  unsafeExtensionInteger.nodes[0].extensionCounter = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(isDemoState(unsafeExtensionInteger), false);

  const invalidUnicode = cloneSeed();
  invalidUnicode.events = ["\ud800"];
  assert.equal(isDemoState(invalidUnicode), false);

  const oversizedCasebook = cloneSeed();
  oversizedCasebook.nodes[0].extensionText = "x".repeat(1_000_000);
  assert.equal(isDemoState(oversizedCasebook), false);

  assert.equal(isDemoState(cloneSeed()), true);
});

test("demo state migration preserves a browser save with previous utilization signal names", () => {
  const saved = cloneSeed();
  const database = saved.nodes.find(node => node.id === "db-pri-01");
  database.signals.connections = database.signals.connectionUtilization;
  delete database.signals.connectionUtilization;
  const firewall = saved.nodes.find(node => node.id === "fw-edge-01");
  firewall.signals.sessions = firewall.signals.sessionUtilization;
  delete firewall.signals.sessionUtilization;
  const migrated = migrateDemoState(saved);
  assert.equal(migrated.nodes.find(node => node.id === "db-pri-01").signals.connectionUtilization, 38);
  assert.equal(migrated.nodes.find(node => node.id === "db-pri-01").signals.connections, undefined);
  assert.equal(migrated.nodes.find(node => node.id === "fw-edge-01").signals.sessionUtilization, 41);
  assert.equal(migrated.nodes.find(node => node.id === "fw-edge-01").signals.sessions, undefined);
  assert.equal(isDemoState(migrated), true);
  assert.equal(saved.nodes.find(node => node.id === "db-pri-01").signals.connections, 38, "migration does not mutate the original save object");
  assert.equal(saved.nodes.find(node => node.id === "fw-edge-01").signals.sessions, 41, "migration leaves the prior firewall signal intact");
  const current = cloneSeed();
  assert.equal(migrateDemoState(current), current, "current schema returns without copying");
  assert.equal(migrateDemoState({ nodes: [] }).nodes.length, 0, "missing database fixture returns unchanged");
  assert.equal(migrateDemoState({ nodes: [{ id: "db-pri-01", signals: { connections: "38" } }] }).nodes[0].signals.connections, "38", "invalid legacy values are left for state validation");
  assert.equal(migrateDemoState(null), null);
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
  assert.equal(nextTicketId([{ id: "HD-9007199254740992" }, { id: "HD-9007199254740993" }]), "HD-9007199254740994");
  assert.equal(nextCaseId([{ id: "CHG-999999999999999999999999999999" }], "CHG", 208), "CHG-1000000000000000000000000000000");
});

test("first response SLA uses priority target and recorded response time", () => {
  assert.equal(assessTicketSla({ priority: "High", ageMinutes: 4 }).state, "On track");
  assert.equal(assessTicketSla({ priority: "Normal", ageMinutes: 26 }).state, "Due soon");
  assert.equal(assessTicketSla({ priority: "High", ageMinutes: 15 }).label, "Breached · due now");
  assert.equal(assessTicketSla({ priority: "High", ageMinutes: 20 }).state, "Breached");
  assert.equal(assessTicketSla({ priority: "High", firstResponseMinutes: 12 }).state, "Met");
  assert.equal(assessTicketSla({ priority: "High", firstResponseMinutes: 15 }).state, "Met");
  assert.equal(assessTicketSla({ priority: "Normal", firstResponseMinutes: 34 }).state, "Breached");
});

test("new ticket SLA age advances from its creation timestamp with an injectable clock", () => {
  const openedAt = Date.parse("2026-10-17T10:00:00Z");
  const ticket = { priority: "High", ageMinutes: 0, createdAt: new Date(openedAt).toISOString() };
  assert.deepEqual(assessTicketSla(ticket, openedAt + 14 * 60_000), {
    state: "Due soon", targetMinutes: 15, ageMinutes: 14, label: "Due in 1 min"
  });
  assert.deepEqual(assessTicketSla(ticket, openedAt + 16 * 60_000), {
    state: "Breached", targetMinutes: 15, ageMinutes: 16, label: "Breached · 1 min ago"
  });
  assert.equal(assessTicketSla({ ...ticket, createdAt: "not a date" }, openedAt + 20 * 60_000).ageMinutes, 0);
});

test("ticket update stores owner and work note with an allowed transition", () => {
  const ticket = { status: "New", assignee: "Unassigned", updates: [], ageMinutes: 8 };
  const changed = updateTicket(ticket, { status: "start", assignee: "R. Patel", note: "Confirmed account is not locked." });
  assert.equal(changed.status, "In progress");
  assert.equal(changed.assignee, "R. Patel");
  assert.equal(changed.firstResponseMinutes, 8, "first response is recorded from ticket age when an owner starts work");
  assert.match(changed.updates[0], /Confirmed account/);
  const previouslyAnswered = updateTicket({ ...ticket, firstResponseMinutes: 4 }, { status: "start", assignee: "R. Patel", note: "Reviewed the existing response and assigned follow-up." });
  assert.equal(previouslyAnswered.firstResponseMinutes, 4, "reassignment does not replace a previously recorded first response");
  assert.equal(updateTicket(ticket, { status: "resolve", assignee: "R. Patel", note: "Attempted fix." }), ticket);
  assert.equal(updateTicket(ticket, { status: "start", assignee: "R. Patel", note: "short" }), ticket);
  assert.equal(updateTicket(ticket, { status: "start", assignee: "R. Patel", note: "😀".repeat(4) }), ticket);
  assert.equal(updateTicket(ticket, { status: "start", assignee: "", note: "Missing owner." }), ticket);
  assert.equal(updateTicket(ticket, { status: "start", assignee: "Unassigned", note: "Still needs an owner." }), ticket);
  const active = { ...changed, status: "In progress" };
  assert.equal(updateTicket(active, { status: "resolve", assignee: "R. Patel", note: "Fixed the issue successfully.", resolutionVerified: false }), active);
  assert.equal(updateTicket(active, { status: "resolve", assignee: "R. Patel", note: "Fixed now.", resolutionVerified: true }), active);
  const resolved = updateTicket(active, { status: "resolve", assignee: "R. Patel", note: "Restarted service; user confirmed sign-in works.", resolutionVerified: true });
  assert.equal(resolved.status, "Resolved");
  assert.equal(resolved.firstResponseMinutes, changed.firstResponseMinutes, "later updates preserve the original first-response measurement");
  assert.match(resolved.updates.at(-1), /requester\/service recovery confirmed/);
});

test("security triage requires ownership and plan; closure requires evidence", () => {
  const finding = { status: "Open", owner: "Unassigned" };
  assert.equal(textLength("😀😀😀😀😀😀"), 6, "string thresholds match Python Unicode code-point counting");
  assert.equal(triageFinding(finding, { owner: "", responsePlan: "Patch" }), finding);
  assert.equal(triageFinding(finding, { owner: "Unassigned", responsePlan: "Patch and validate the app" }), finding);
  assert.equal(triageFinding(finding, { owner: "R. Patel", responsePlan: "Patch" }), finding);
  assert.equal(triageFinding(finding, { owner: "R. Patel", responsePlan: "             " }), finding);
  assert.equal(triageFinding(finding, { owner: "R. Patel", responsePlan: "😀".repeat(6) }), finding);
  const triaged = triageFinding(finding, { owner: "R. Patel", responsePlan: "Patch and verify application health" });
  assert.equal(triaged.status, "Investigating");
  assert.equal(resolveFinding(triaged, { resolution: "" }), triaged);
  assert.equal(resolveFinding(triaged, { resolution: "Updated package set; health checks passed." }), triaged);
  assert.equal(resolveFinding(triaged, { resolution: "Short", verified: "yes" }), triaged);
  assert.equal(resolveFinding(triaged, { resolution: "Updated package set; health checks passed.", verified: "yes" }).status, "Resolved");
  assert.equal(triageFinding({ ...triaged, status: "Resolved" }, { owner: "Jamie", responsePlan: "Reopen" }).status, "Resolved");
});

test("infrastructure investigation records cause and only closes on a recovery check", () => {
  const seed = cloneSeed();
  const node = seed.nodes.find(item => item.id === "app-srv-02");
  assert.equal(recordIncidentInvestigation(node, { owner: "", cause: "CPU saturation", action: "Scale worker pool" }), node);
  assert.equal(recordIncidentInvestigation(node, { owner: "R. Patel", cause: "CPU saturation", action: "   " }), node);
  const triaged = recordIncidentInvestigation(node, { owner: "R. Patel", cause: "CPU saturation", action: "Scale worker pool" });
  assert.equal(triaged.health, "Degraded");
  assert.equal(triaged.investigation.owner, "R. Patel");
  assert.equal(triaged.investigation.status, "Investigating");
  assert.equal(recordIncidentRecovery(triaged, { verification: "", notes: "" }), triaged);
  assert.equal(recordIncidentRecovery(triaged, { verification: recoveryChecks(node)[0], notes: 123 }), triaged);
  assert.equal(recordIncidentRecovery(triaged, { verification: recoveryChecks(node)[0], notes: null }), triaged);
  assert.equal(recordIncidentRecovery(triaged, { verification: recoveryChecks(node)[0], notes: "short" }), triaged);
  assert.equal(recordIncidentRecovery(triaged, { verification: "AP heartbeat restored; client gateway and DNS checks passed", notes: "wrong service check" }), triaged);
  const recovered = recordIncidentRecovery(triaged, { verification: recoveryChecks(node)[0], notes: "Response at 38 ms; sign-in test passed." });
  assert.equal(recovered.health, "Healthy");
  assert.equal(recovered.signals.cpu, 61);
  assert.equal(recovered.investigation.status, "Resolved");
});

test("wireless and unclassified infrastructure recovery update the matching health signals", () => {
  const ap = cloneSeed().nodes.find(item => item.id === "ap-east-14");
  const investigation = recordIncidentInvestigation(ap, { owner: "T. Brown", cause: "PoE supply or access-switch port", action: "Check PoE budget and reseat the AP uplink" });
  const recovered = recordIncidentRecovery(investigation, { verification: recoveryChecks(ap)[0], notes: "Heartbeat returned and gateway and DNS checks passed." });
  assert.equal(recovered.health, "Healthy");
  assert.equal(recovered.latency, 13);
  assert.equal(recovered.signals.missedHeartbeats, 0);
  assert.equal(recovered.signals.poeDraw, 7.2);

  const generic = { id: "storage-node-08", health: "Degraded", latency: 18, signals: {}, investigation: { cause: "Resource threshold", action: "Compare a peer" } };
  assert.match(recoveryChecks(generic)[0], /expected range/);
  const genericRecovery = recordIncidentRecovery(generic, { verification: recoveryChecks(generic)[0], notes: "Service response returned to expected range." });
  assert.equal(genericRecovery.health, "Healthy");
  assert.equal(genericRecovery.latency, 18);
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
  const multiSiteLoss = diagnoseNetwork({ site: "East wing", symptom: "Packet loss", scope: "Multiple sites" });
  assert.equal(multiSiteLoss.likelyCause, "WAN edge congestion or circuit loss");
  assert.equal(multiSiteLoss.checks[1][1], "Client link stable");
  assert.equal(multiSiteLoss.checks[3][2], "fail");
  const slow = diagnoseNetwork({ site: "North campus", symptom: "Slow connection", scope: "Single user" });
  assert.equal(slow.likelyCause, "Endpoint link or local access path");
  assert.match(slow.nextAction, /known-good peer/);
  assert.equal(slow.checks[2][1], "Responding · 18 ms");
  const local = diagnoseNetwork({ site: "East wing", symptom: "Packet loss", scope: "Single room" });
  assert.equal(local.likelyCause, "Wireless access point or local uplink");
  assert.equal(local.checks[1][2], "warning");
  assert.match(local.nextAction, /wired and wireless/);
  const gateway = diagnoseNetwork({ site: "North campus", symptom: "No connectivity", scope: "Entire floor" });
  assert.equal(gateway.checks[2][2], "fail");
  assert.equal(gateway.checks[3][2], "blocked");
  const eastFloor = diagnoseNetwork({ site: "East wing", symptom: "No connectivity", scope: "Entire floor" });
  assert.equal(eastFloor.likelyCause, "Access switch uplink or floor gateway");
  assert.equal(eastFloor.checks[1][1], "Client link is up");
  const singleUser = diagnoseNetwork({ site: "North campus", symptom: "No connectivity", scope: "Single user" });
  assert.equal(singleUser.likelyCause, "Endpoint link or local access port");
  assert.match(singleUser.nextAction, /known-good endpoint on the same switch/);
  const wan = diagnoseNetwork({ site: "Head office", symptom: "Packet loss", scope: "Multiple sites" });
  assert.equal(wan.likelyCause, "WAN edge congestion or circuit loss");
  assert.equal(wan.checks[3][2], "fail");
});

test("network diagnostics return coherent evidence for every supported scope and symptom", () => {
  const sites = ["North campus", "East wing", "Head office", "Cloud region A"];
  const symptoms = ["Slow connection", "No connectivity", "Packet loss", "Name lookup failure"];
  const scopes = ["Single user", "Single room", "Entire floor", "Multiple sites"];
  for (const site of sites) for (const symptom of symptoms) for (const scope of scopes) {
    const result = diagnoseNetwork({ site, symptom, scope });
    assert.equal(result.site, site);
    assert.equal(result.symptom, symptom);
    assert.equal(result.scope, scope);
    assert.equal(result.checks.length, 4);
    assert.ok(result.checks.every(([, , outcome]) => ["pass", "warning", "fail", "blocked"].includes(outcome)));
    assert.ok(result.likelyCause && result.nextAction && result.confidence);
  }
});

test("change readiness, window confirmation, and decision evidence gate every transition", () => {
  const change = cloneSeed().maintenance[0];
  assert.equal(readinessChecks.length, 5);
  assert.equal(maintenanceAction(change, "approve"), change);
  const flagWithoutPlan = { ...change, readiness: { ...change.readiness, validationReady: true } };
  assert.equal(maintenanceAction(flagWithoutPlan, "approve", { evidence: "Impact, controls, owner, and rollback are suitable for this window." }), flagWithoutPlan, "validation readiness needs a recorded plan");
  const ready = { ...change, validationPlan: "Confirm ERP sign-in and compare response time with the approved baseline.", readiness: { ...change.readiness, validationReady: true } };
  const approvalEvidence = "Impact, controls, owner, and rollback are suitable for this window.";
  assert.equal(maintenanceAction(ready, "approve", { evidence: "Impact scope · service owner · rollback evidence reviewed for approval." }).status, "Approved", "decision evidence may contain the history separator");
  assert.equal(maintenanceAction(ready, "approve"), ready, "approval needs a recorded rationale");
  const shortUnicodeEvidence = { ...ready, validationPlan: "😀".repeat(6) };
  assert.equal(maintenanceAction(shortUnicodeEvidence, "approve", { evidence: approvalEvidence }), shortUnicodeEvidence, "Unicode evidence minimum matches Python code-point validation");
  const approved = maintenanceAction(ready, "approve", { evidence: approvalEvidence });
  assert.equal(approved.status, "Approved");
  const ownerless = { ...ready, owner: "" };
  assert.equal(maintenanceAction(ownerless, "approve", { evidence: approvalEvidence }), ownerless);
  const unassigned = { ...ready, owner: "Unassigned" };
  assert.equal(maintenanceAction(unassigned, "approve", { evidence: approvalEvidence }), unassigned);
  assert.equal(maintenanceAction(approved, "start"), approved, "implementation waits for window confirmation");
  const checkpoint = "Pre-change health check passed; service owner is ready.";
  assert.equal(maintenanceAction(approved, "start", { windowOpenConfirmed: true }), approved, "implementation also needs a checkpoint");
  const started = maintenanceAction(approved, "start", { windowOpenConfirmed: true, evidence: checkpoint });
  assert.equal(started.status, "In progress");
  const validationEvidence = "ERP response remains above the approved threshold after the patch.";
  assert.equal(maintenanceAction(started, "failed"), started, "validation outcome needs evidence");
  const rollbackRequired = maintenanceAction(started, "failed", { evidence: validationEvidence });
  assert.equal(rollbackRequired.status, "Rollback required");
  const rollbackEvidence = "Snapshot restored and ERP sign-in returned to the baseline.";
  assert.equal(maintenanceAction(rollbackRequired, "rollback"), rollbackRequired, "rollback needs a recovery record");
  assert.equal(maintenanceAction(rollbackRequired, "rollback", { evidence: rollbackEvidence }).status, "Rolled back");
  assert.equal(maintenanceAction(started, "passed", { evidence: "ERP response and sign-in checks passed against the baseline." }).status, "Completed");
  assert.equal(maintenanceAction(change, "reject"), change, "rejection needs a recorded reason");
  assert.equal(maintenanceAction(change, "reject", { evidence: "Validation plan is missing for this window." }).status, "Rejected");
  assert.equal(maintenanceAction(change, "rollback"), change);
});

test("high-risk changes require an independent peer review", () => {
  const change = { ...cloneSeed().maintenance[0], validationPlan: "Verify sign-in, service latency, and queue depth after maintenance.", risk: "High", readiness: Object.fromEntries(readinessChecks.map(([key]) => [key, true])) };
  const approvalEvidence = "Independent controls and rollback evidence reviewed for approval.";
  assert.equal(maintenanceAction(change, "approve", { evidence: approvalEvidence }), change);
  const reviewed = { ...change, readiness: { ...change.readiness, peerReview: true } };
  assert.equal(maintenanceAction(reviewed, "approve", { evidence: approvalEvidence }), reviewed);
  assert.equal(maintenanceAction(reviewed, "approve", { peerReviewer: "R. Patel", evidence: approvalEvidence }), reviewed);
  assert.equal(maintenanceAction(reviewed, "approve", { peerReviewer: " r. patel ", evidence: approvalEvidence }), reviewed);
  const ownerless = { ...reviewed, owner: "" };
  assert.equal(maintenanceAction(ownerless, "approve", { peerReviewer: "T. Brown", evidence: approvalEvidence }), ownerless);
  assert.equal(maintenanceAction(reviewed, "approve", { peerReviewer: "T. Brown", evidence: approvalEvidence }).status, "Approved");
});
