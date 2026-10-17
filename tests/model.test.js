import test from "node:test";
import assert from "node:assert/strict";
import { cloneSeed, nextTicketId, transitionTicket, reduceFinding, maintenanceAction, diagnoseNetwork } from "../src/model.js";

test("demo seed is isolated and includes the five operational datasets", () => {
  const one = cloneSeed();
  const two = cloneSeed();
  one.nodes[0].health = "Offline";
  assert.equal(two.nodes[0].health, "Healthy");
  assert.equal(two.nodes.length, 5);
  assert.ok(two.findings.length && two.tickets.length && two.maintenance.length);
});

test("ticket lifecycle only allows valid transitions", () => {
  const t = { id: "HD-1048", status: "New" };
  assert.equal(transitionTicket(t, "start").status, "In progress");
  assert.equal(transitionTicket(t, "wait"), t);
  assert.equal(transitionTicket({ ...t, status: "In progress" }, "wait").status, "Waiting");
  assert.equal(transitionTicket({ ...t, status: "Waiting" }, "resolve").status, "Resolved");
});

test("ticket IDs increment from the highest existing sequence", () => {
  assert.equal(nextTicketId([{ id: "HD-1042" }, { id: "HD-1050" }]), "HD-1051");
  assert.equal(nextTicketId([]), "HD-1041");
});

test("finding triage progresses through investigate and resolve", () => {
  const f = { id: "SEC-1", status: "Open" };
  assert.equal(reduceFinding(f, "investigate").status, "Investigating");
  assert.equal(reduceFinding(f, "resolve").status, "Resolved");
  assert.equal(reduceFinding({ ...f, status: "Resolved" }, "investigate").status, "Resolved");
});

test("maintenance approval and rollback enforce state order", () => {
  const c = { status: "Pending approval" };
  assert.equal(maintenanceAction(c, "approve").status, "Approved");
  assert.equal(maintenanceAction(c, "rollback"), c);
  assert.equal(maintenanceAction({ status: "Approved" }, "rollback").status, "Rolled back");
  assert.equal(maintenanceAction({ status: "Pending approval" }, "reject").status, "Rejected");
});

test("network diagnostics adapt checks to site and symptoms", () => {
  const loss = diagnoseNetwork({ site: "East wing", symptom: "Packet loss", scope: "Single room" });
  assert.equal(loss[3].result, "Wireless access point or local uplink");
  const gateway = diagnoseNetwork({ site: "North campus", symptom: "No connectivity", scope: "Entire floor" });
  assert.equal(gateway[1].result, "No response");
  assert.equal(gateway[1].ok, false);
  const dns = diagnoseNetwork({ site: "HQ", symptom: "Name lookup failure", scope: "Single user" });
  assert.match(dns[2].result, /timed out/);
});
