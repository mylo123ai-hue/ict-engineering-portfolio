export const readinessChecks = [
  ["scopeOwner", "Scope and owner are clear"],
  ["windowConfirmed", "Maintenance window is agreed"],
  ["impactAssessed", "Service impact is assessed"],
  ["rollbackDocumented", "Rollback steps are documented"],
  ["validationReady", "Post-change validation is defined"]
];
export const casebookLimits = Object.freeze({ findings: 500, tickets: 500, maintenance: 300, events: 100 });
// Python's len(str) counts Unicode code points; String.length counts UTF-16 units.
export const textLength = value => Array.from(value).length;

export const seed = {
  nodes: [
    { id: "core-sw-01", name: "Core switch · North campus", type: "Network", zone: "North campus", health: "Healthy", latency: 8, uptime: "99.99%", icon: "⇄", signals: { portUtilization: 42, interfaceErrors: 0.1 } },
    { id: "app-srv-02", name: "Application server · ERP", type: "Compute", zone: "Cloud region A", health: "Degraded", latency: 184, uptime: "98.70%", icon: "▣", signals: { cpu: 88, memory: 81, queueDepth: 42 } },
    { id: "db-pri-01", name: "Primary database · Finance", type: "Database", zone: "Cloud region A", health: "Healthy", latency: 14, uptime: "99.98%", icon: "◈", signals: { connectionUtilization: 38, storage: 64 } },
    { id: "fw-edge-01", name: "Edge firewall · HQ", type: "Security", zone: "Head office", health: "Healthy", latency: 12, uptime: "99.96%", icon: "⬡", signals: { cpu: 24, sessionUtilization: 41 } },
    { id: "ap-east-14", name: "Wireless AP · East wing", type: "Access point", zone: "East wing", health: "Offline", latency: null, uptime: "96.20%", icon: "⌁", signals: { missedHeartbeats: 8, poeDraw: 0 } }
  ],
  findings: [
    { id: "SEC-2418", title: "Unpatched Linux kernel", asset: "app-srv-02", severity: "Critical", cvss: 9.8, age: "2 days", status: "Open", description: "A kernel security update is overdue on the ERP application host.", exposure: "Internal · reachable from user VLAN", impact: "Potential privilege escalation on a business-critical host", recommendedAction: "Schedule vendor patch, validate application health, then close the finding", owner: "Unassigned", responsePlan: "", resolution: "" },
    { id: "SEC-2413", title: "Excessive sign-in attempts", asset: "idp-gateway", severity: "High", cvss: 8.1, age: "4 hours", status: "Investigating", description: "Repeated authentication failures from a single monitored source.", exposure: "Identity edge · public sign-in endpoint", impact: "Account lockout or credential compromise risk", recommendedAction: "Correlate source with identity logs; block only after confirming false-positive risk", owner: "R. Patel", responsePlan: "Review sign-in source and affected accounts", resolution: "" },
    { id: "SEC-2407", title: "TLS certificate expires soon", asset: "portal-web-01", severity: "Medium", cvss: 5.3, age: "3 days", status: "Open", description: "The portal certificate expires within 14 days.", exposure: "External · HTTPS service", impact: "Service trust warnings if renewal is missed", recommendedAction: "Renew the certificate and verify the full chain before the expiry window", owner: "Unassigned", responsePlan: "", resolution: "" },
    { id: "SEC-2398", title: "Stale service account", asset: "backup-agent", severity: "Low", cvss: 3.1, age: "1 week", status: "Open", description: "The service account has not been used in the last 90 days.", exposure: "Internal · scheduled backup identity", impact: "Unneeded credentials can widen access if retained", recommendedAction: "Confirm ownership and dependency, then disable with a recovery path", owner: "Unassigned", responsePlan: "", resolution: "" }
  ],
  tickets: [
    { id: "HD-1048", subject: "ERP sign-in is unusually slow", requester: "Jordan Lee", category: "Access & accounts", priority: "High", status: "In progress", assignee: "R. Patel", created: "09:42", ageMinutes: 26, firstResponseMinutes: 6, details: "Three finance users report 10–15 second sign-in delays since the morning login window.", updates: ["09:48 · Checked identity provider status; no current outage." ] },
    { id: "HD-1046", subject: "New starter laptop setup", requester: "Avery Chen", category: "Hardware", priority: "Normal", status: "New", assignee: "Unassigned", created: "09:18", ageMinutes: 18, firstResponseMinutes: null, details: "Prepare a managed laptop and confirm the standard access bundle before the start date.", updates: [] },
    { id: "HD-1042", subject: "East wing Wi-Fi drops out", requester: "Sam Morgan", category: "Network", priority: "High", status: "Waiting", assignee: "T. Brown", created: "08:56", ageMinutes: 52, firstResponseMinutes: 8, details: "Intermittent disconnects reported from two desks near access point AP-EAST-14.", updates: ["09:04 · Requested a reconnect test after access point recovery." ] }
  ],
  maintenance: [
    { id: "CHG-208", title: "ERP host security patching", system: "Application server · ERP", window: "Planned · 22:00–22:30", risk: "Medium", status: "Pending approval", owner: "R. Patel", impact: "Finance users may see a brief sign-in delay while the host restarts; validate ERP login and queue depth before closing.", rollback: "Restore the pre-change VM snapshot and revert the package set.", readiness: { scopeOwner: true, windowConfirmed: true, impactAssessed: true, rollbackDocumented: true, validationReady: false }, history: ["Request created · awaiting review"] }
  ],
  events: ["09:42 · ERP host latency crossed 150 ms", "09:37 · East wing access point stopped responding", "09:21 · Security finding SEC-2418 opened"]
};

export const cloneSeed = () => structuredClone(seed);

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
function isText(value) {
  if (typeof value !== "string") return false;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function isIsoTimestamp(value) {
  return isText(value) && !value.startsWith("0000-") && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function isPortableJSON(root) {
  const pending = [{ value: root, leave: false }];
  const active = new Set();
  while (pending.length) {
    const current = pending.pop();
    const value = current.value;
    if (current.leave) { active.delete(value); continue; }
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") { if (!isText(value)) return false; continue; }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) && !value.toString().includes("e")) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (active.has(value)) return false;
      active.add(value); pending.push({ value, leave: true });
      for (const item of value) pending.push({ value: item, leave: false });
      continue;
    }
    if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key)) || active.has(value)) return false;
    active.add(value); pending.push({ value, leave: true });
    for (const [key, item] of Object.entries(value)) {
      if (!isText(key)) return false;
      pending.push({ value: item, leave: false });
    }
  }
  return true;
}
const nodeSignalFields = {
  "core-sw-01": ["portUtilization", "interfaceErrors"],
  "app-srv-02": ["cpu", "memory", "queueDepth"],
  "db-pri-01": ["connectionUtilization", "storage"],
  "fw-edge-01": ["cpu", "sessionUtilization"],
  "ap-east-14": ["missedHeartbeats", "poeDraw"]
};
const healthySignalThresholds = {
  "core-sw-01": { portUtilization: 80, interfaceErrors: 1 },
  "app-srv-02": { cpu: 80, queueDepth: 25 },
  "ap-east-14": { missedHeartbeats: 3 }
};
const nodeStatuses = ["Healthy", "Degraded", "Offline"];
const findingStatuses = ["Open", "Investigating", "Resolved"];
const ticketStatuses = ["New", "In progress", "Waiting", "Resolved"];
const changeStatuses = ["Pending approval", "Rejected", "Approved", "In progress", "Completed", "Rollback required", "Rolled back"];
const readyChangeStatuses = ["Approved", "In progress", "Completed", "Rollback required", "Rolled back"];
const closedChangeStatuses = ["Completed", "Rolled back"];

function validNode(node) {
  if (!isRecord(node) || !/^[a-z0-9-]+$/.test(node.id) || !nodeSignalFields[node.id] || ![node.name, node.type, node.zone, node.icon, node.uptime].every(isText) || !nodeStatuses.includes(node.health) || !isRecord(node.signals)) return false;
  const signalFields = nodeSignalFields[node.id];
  if (!signalFields.every(key => Number.isFinite(node.signals[key]) && node.signals[key] >= 0)) return false;
  if (node.health === "Healthy" && Object.entries(healthySignalThresholds[node.id] || {}).some(([key, threshold]) => node.signals[key] > threshold)) return false;
  if (!(node.latency === null || Number.isFinite(node.latency) && node.latency >= 0)) return false;
  if (node.investigation === undefined || node.investigation === null) return true;
  const incident = node.investigation;
  if (!isRecord(incident) || !isText(incident.owner) || !incident.owner.trim() || incident.owner === "Unassigned" || !isText(incident.cause) || !incident.cause.trim() || !isText(incident.action) || !incident.action.trim() || !["Investigating", "Resolved"].includes(incident.status)) return false;
  if (incident.status === "Investigating") return node.health !== "Healthy";
  return node.health === "Healthy" && isText(incident.verification) && recoveryChecks(node).includes(incident.verification) && isText(incident.notes) && textLength(incident.notes.trim()) >= 8;
}

function validFinding(finding) {
  if (!isRecord(finding) || !/^SEC-\d+$/.test(finding.id) || !isText(finding.title) || !findingStatuses.includes(finding.status) || !["Critical", "High", "Medium", "Low"].includes(finding.severity) || !Number.isFinite(finding.cvss) || finding.cvss < 0 || finding.cvss > 10 || !isText(finding.asset) || !isText(finding.owner) || !isText(finding.responsePlan) || !isText(finding.resolution)) return false;
  if (finding.status !== "Open" && (!finding.owner.trim() || finding.owner === "Unassigned" || textLength(finding.responsePlan.trim()) < 12)) return false;
  return finding.status !== "Resolved" || textLength(finding.resolution.trim()) >= 12;
}

function validTicket(ticket) {
  if (!isRecord(ticket) || !/^HD-\d+$/.test(ticket.id) || !isText(ticket.subject) || !ticket.subject.trim() || !isText(ticket.requester) || !ticket.requester.trim() || !["Access & accounts", "Hardware", "Network", "Software", "Other"].includes(ticket.category) || !["Low", "Normal", "High"].includes(ticket.priority) || !ticketStatuses.includes(ticket.status) || !isText(ticket.assignee) || !Number.isFinite(ticket.ageMinutes) || ticket.ageMinutes < 0 || !(ticket.firstResponseMinutes === null || Number.isFinite(ticket.firstResponseMinutes) && ticket.firstResponseMinutes >= 0) || !(ticket.createdAt === undefined || isIsoTimestamp(ticket.createdAt)) || !Array.isArray(ticket.updates) || !ticket.updates.every(isText)) return false;
  if (ticket.status === "New" && ticket.firstResponseMinutes !== null) return false;
  if (ticket.status !== "New" && (!ticket.assignee.trim() || ticket.assignee === "Unassigned" || ticket.firstResponseMinutes === null || !ticket.updates.some(update => textLength(update.trim()) >= 8))) return false;
  return ticket.status !== "Resolved" || ticket.updates.some(update => update.includes("requester/service recovery confirmed"));
}

function validChange(change) {
  if (!isRecord(change) || !/^CHG-\d+$/.test(change.id) || !isText(change.title) || !change.title.trim() || !isText(change.system) || !change.system.trim() || !isText(change.window) || !change.window.trim() || !isText(change.impact) || textLength(change.impact.trim()) < 12 || !isText(change.rollback) || textLength(change.rollback.trim()) < 12 || !["Low", "Medium", "High"].includes(change.risk) || !changeStatuses.includes(change.status) || !isText(change.owner) || !change.owner.trim() || change.owner === "Unassigned" || !isRecord(change.readiness) || !readinessChecks.every(([key]) => typeof change.readiness[key] === "boolean") || !Array.isArray(change.history) || !change.history.every(isText)) return false;
  if (change.readiness.validationReady && (!isText(change.validationPlan) || textLength(change.validationPlan.trim()) < 12)) return false;
  const hasRecordedDecision = marker => change.history.some(entry => entry.includes(marker) && textLength(entry.split(" · ").at(-1).trim()) >= 12);
  const hasIndependentPeerReview = change.history.some(entry => {
    const marker = "Peer review by ";
    const markerIndex = entry.indexOf(marker);
    if (markerIndex === -1) return false;
    const reviewer = entry.slice(markerIndex + marker.length).split(" · ")[0].trim();
    return reviewer && reviewer.toLocaleLowerCase() !== change.owner.trim().toLocaleLowerCase();
  });
  if (readyChangeStatuses.includes(change.status) && !readinessChecks.every(([key]) => change.readiness[key] === true)) return false;
  if (readyChangeStatuses.includes(change.status) && !hasRecordedDecision("Approved by ")) return false;
  if (change.status === "Rejected" && !hasRecordedDecision("Rejected by ")) return false;
  if (readyChangeStatuses.includes(change.status) && change.risk === "High" && (change.readiness.peerReview !== true || !hasIndependentPeerReview)) return false;
  if (change.status === "In progress" || closedChangeStatuses.includes(change.status)) {
    if (!isText(change.preChangeEvidence) || textLength(change.preChangeEvidence.trim()) < 12 || !hasRecordedDecision("Implementation started in approved window")) return false;
  }
  if (change.status === "Completed" || change.status === "Rollback required") {
    const outcome = change.status === "Completed" ? "Validation passed" : "Validation failed";
    if (!isText(change.validationEvidence) || textLength(change.validationEvidence.trim()) < 12 || !hasRecordedDecision(outcome)) return false;
  }
  if (change.status === "Rolled back" && (!isText(change.rollbackEvidence) || textLength(change.rollbackEvidence.trim()) < 12 || !hasRecordedDecision("Rollback executed"))) return false;
  return true;
}

const hasUniqueIds = items => new Set(items.map(item => item?.id)).size === items.length;

export function migrateDemoState(value) {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return value;
  const legacySignals = [
    ["db-pri-01", "connections", "connectionUtilization"],
    ["fw-edge-01", "sessions", "sessionUtilization"]
  ];
  const pending = legacySignals.filter(([id, oldKey, newKey]) => {
    const node = value.nodes.find(item => item?.id === id);
    return node?.signals && node.signals[newKey] === undefined && Number.isFinite(node.signals[oldKey]);
  });
  if (pending.length === 0) return value;
  const migrated = structuredClone(value);
  for (const [id, oldKey, newKey] of pending) {
    const node = migrated.nodes.find(item => item?.id === id);
    node.signals[newKey] = node.signals[oldKey];
    delete node.signals[oldKey];
  }
  return migrated;
}

export function isDemoState(value) {
  const stateKeys = ["nodes", "findings", "tickets", "maintenance", "events"];
  if (!isRecord(value) || Object.keys(value).length !== stateKeys.length || !stateKeys.every(key => Array.isArray(value[key])) || !stateKeys.every(key => Object.hasOwn(value, key)) || !isPortableJSON(value)) return false;
  let serialized;
  try { serialized = JSON.stringify(value); } catch { return false; }
  if (new TextEncoder().encode(serialized).length > 1_000_000) return false;
  if (value.findings.length > casebookLimits.findings || value.tickets.length > casebookLimits.tickets || value.maintenance.length > casebookLimits.maintenance || value.events.length > casebookLimits.events) return false;
  const nodeIds = new Set(value.nodes.map(node => node?.id));
  if (value.nodes.length !== Object.keys(nodeSignalFields).length || !Object.keys(nodeSignalFields).every(id => nodeIds.has(id)) || !value.events.every(isText)) return false;
  if (![value.nodes, value.findings, value.tickets, value.maintenance].every(hasUniqueIds)) return false;
  const findingIds = new Set(value.findings.map(finding => finding?.id));
  if (value.tickets.some(ticket => ticket?.relatedAssetId !== undefined && (!isText(ticket.relatedAssetId) || ticket.relatedAssetId && !nodeIds.has(ticket.relatedAssetId)))) return false;
  if (value.maintenance.some(change => change?.findingId !== undefined && (!isText(change.findingId) || change.findingId && !findingIds.has(change.findingId)))) return false;
  return value.nodes.every(validNode) && value.findings.every(validFinding) && value.tickets.every(validTicket) && value.maintenance.every(validChange);
}

export function nextCaseId(records, prefix, minimum) {
  let max = BigInt(minimum);
  for (const record of records) {
    const id = record?.id;
    if (typeof id !== "string") continue;
    const parts = id.split("-");
    if (parts.length !== 2 || parts[0] !== prefix || !/^[0-9]+$/.test(parts[1])) continue;
    const sequence = BigInt(parts[1]);
    if (sequence > max) max = sequence;
  }
  return `${prefix}-${max + 1n}`;
}
export const nextTicketId = tickets => nextCaseId(tickets, "HD", 1040);

const ticketTransitions = {
  start: ["New", "In progress"],
  wait: ["In progress", "Waiting"],
  resolve: [["Waiting", "In progress"], "Resolved"],
  reopen: ["Resolved", "In progress"]
};

export function transitionTicket(ticket, action) {
  const transition = ticketTransitions[action];
  if (!transition) return ticket;
  const [from, to] = transition;
  if (Array.isArray(from) ? !from.includes(ticket.status) : ticket.status !== from) return ticket;
  return { ...ticket, status: to };
}

export function triageFinding(finding, { owner, responsePlan }) {
  const ownerName = typeof owner === "string" ? owner.trim() : "";
  const plan = typeof responsePlan === "string" ? responsePlan.trim() : "";
  if (finding.status === "Resolved" || !ownerName || ownerName === "Unassigned" || textLength(plan) < 12) return finding;
  return { ...finding, status: "Investigating", owner: ownerName, responsePlan: plan };
}

export function resolveFinding(finding, { resolution, verified }) {
  const evidence = typeof resolution === "string" ? resolution.trim() : "";
  if (finding.status !== "Investigating" || textLength(evidence) < 12 || verified !== "yes") return finding;
  return { ...finding, status: "Resolved", resolution: evidence };
}

export function simulateIncident(node) {
  if (node.id !== "core-sw-01" || node.health !== "Healthy") return node;
  return { ...node, health: "Degraded", latency: 241, signals: { ...node.signals, portUtilization: 96, interfaceErrors: 4.8 }, investigation: null };
}

export function recordIncidentInvestigation(node, { owner, cause, action }) {
  const ownerName = typeof owner === "string" ? owner.trim() : "";
  const hypothesis = typeof cause === "string" ? cause.trim() : "";
  const firstAction = typeof action === "string" ? action.trim() : "";
  if (node.health === "Healthy" || !ownerName || ownerName === "Unassigned" || !hypothesis || !firstAction) return node;
  return { ...node, investigation: { owner: ownerName, cause: hypothesis, action: firstAction, status: "Investigating" } };
}

export function recoveryChecks(node) {
  if (node.id === "app-srv-02") return ["ERP login passed; latency and queue depth returned below threshold"];
  if (node.id === "ap-east-14") return ["AP heartbeat restored; client gateway and DNS checks passed"];
  if (node.id === "core-sw-01") return ["Interface errors normalized; gateway probe loss returned below threshold"];
  return ["Service response and key resource signals returned to the expected range"];
}

export function recordIncidentRecovery(node, { verification, notes }) {
  const evidence = typeof notes === "string" ? notes.trim() : "";
  if (!node.investigation || !recoveryChecks(node).includes(verification) || textLength(evidence) < 8) return node;
  const signals = { ...node.signals };
  if (node.id === "app-srv-02") Object.assign(signals, { cpu: 61, memory: 67, queueDepth: 8 });
  if (node.id === "ap-east-14") Object.assign(signals, { missedHeartbeats: 0, poeDraw: 7.2 });
  if (node.id === "core-sw-01") Object.assign(signals, { portUtilization: 48, interfaceErrors: 0.2 });
  if (node.id === "app-srv-02" || node.id === "core-sw-01") return { ...node, health: "Healthy", latency: 38, signals, investigation: { ...node.investigation, status: "Resolved", verification: verification.trim(), notes: evidence } };
  if (node.id === "ap-east-14") return { ...node, health: "Healthy", latency: 13, signals, investigation: { ...node.investigation, status: "Resolved", verification: verification.trim(), notes: evidence } };
  return { ...node, health: "Healthy", latency: Math.min(node.latency || 30, 30), signals, investigation: { ...node.investigation, status: "Resolved", verification: verification.trim(), notes: evidence } };
}

export function diagnoseNetwork({ site, symptom, scope }) {
  const multiSite = scope === "Multiple sites";
  const localAccess = scope === "Single room" || scope === "Single user";
  const eastWingWireless = localAccess && site === "East wing";
  let likelyCause;
  let confidence;
  let nextAction;
  let checks;

  if (symptom === "Name lookup failure") {
    likelyCause = "DNS resolver or name service";
    confidence = "High · gateway responds while lookups time out";
    nextAction = "Compare resolver health and query logs before changing client settings.";
    checks = [
      ["Impact", multiSite ? "Reported across several sites" : `${scope} impact at ${site}`, multiSite ? "warning" : "pass"],
      ["Client link", "Link is up · local interface responds", "pass"],
      ["Default gateway", "Responding · 2 ms", "pass"],
      ["DNS query", "Resolver query timed out · 3 attempts", "fail"]
    ];
  } else if (symptom === "No connectivity") {
    likelyCause = multiSite ? "WAN edge or upstream circuit" : eastWingWireless ? "Local endpoint, access point, or switch port" : localAccess ? "Endpoint link or local access port" : "Access switch uplink or floor gateway";
    confidence = "Medium · gateway reachability failed; validate at the next hop";
    nextAction = multiSite ? "Check edge interface counters and provider handoff; compare a second site." : "Test a known-good endpoint on the same switch before replacing equipment.";
    checks = [
      ["Impact", multiSite ? "Multiple sites report loss" : `${scope} impact reported`, multiSite ? "fail" : "warning"],
      ["Client link", eastWingWireless ? "Wi-Fi association needs confirmation" : localAccess ? "Endpoint link or access port needs confirmation" : "Client link is up", localAccess ? "warning" : "pass"],
      ["Default gateway", "No response · 4 probes", "fail"],
      ["DNS query", "Not run · gateway is unreachable", "blocked"]
    ];
  } else if (symptom === "Packet loss") {
    likelyCause = multiSite ? "WAN edge congestion or circuit loss" : eastWingWireless ? "Wireless access point or local uplink" : localAccess ? "Endpoint link or local access port" : "Access switch uplink or queue congestion";
    confidence = "Medium · local-versus-upstream boundary needs one comparison test";
    nextAction = multiSite ? "Compare loss at the provider handoff and a second site." : eastWingWireless ? "Compare wired and wireless packet loss, then check AP uplink counters." : localAccess ? "Compare with a known-good endpoint and inspect local interface counters." : "Check switch uplink errors and queue drops before changing configuration.";
    checks = [
      ["Impact", multiSite ? "Loss reported at multiple sites" : `${scope} impact at ${site}`, multiSite ? "warning" : "pass"],
      ["Client link", eastWingWireless ? "Wireless RSSI varies · 3% retry rate" : localAccess ? "Endpoint link needs comparison with a known-good peer" : "Client link stable", localAccess ? "warning" : "pass"],
      ["Default gateway", "Responding · 2% probe loss", "warning"],
      ["Upstream path", multiSite ? "Loss persists beyond local gateway" : "No confirmed upstream loss", multiSite ? "fail" : "pass"]
    ];
  } else {
    likelyCause = multiSite ? "WAN latency or shared upstream service" : eastWingWireless ? "Wireless airtime or local access uplink" : localAccess ? "Endpoint link or local access path" : "Application path or local queue saturation";
    confidence = "Medium · compare endpoint and gateway latency to isolate the segment";
    nextAction = multiSite ? "Compare service latency from a second site and at the provider edge." : eastWingWireless ? "Compare wired and wireless response time; inspect airtime at the AP." : localAccess ? "Compare endpoint latency with a known-good peer and inspect local link counters." : "Compare endpoint and gateway latency, then inspect queue utilization on the nearest uplink.";
    checks = [
      ["Impact", multiSite ? "Several sites report slow response" : `${scope} impact at ${site}`, multiSite ? "warning" : "pass"],
      ["Client link", eastWingWireless ? "Wireless channel utilization elevated" : localAccess ? "Compare endpoint link with a known-good peer" : "Client link stable", localAccess ? "warning" : "pass"],
      ["Default gateway", multiSite ? "Responding · 96 ms" : "Responding · 18 ms", multiSite ? "warning" : "pass"],
      ["DNS query", "Resolved · 18 ms", "pass"]
    ];
  }
  return { likelyCause, confidence, nextAction, checks, site, symptom, scope };
}

export function updateTicket(ticket, { status, assignee, note, resolutionVerified = false }) {
  const next = transitionTicket(ticket, status);
  const owner = typeof assignee === "string" ? assignee.trim() : "";
  const workNote = typeof note === "string" ? note.trim() : "";
  if (next === ticket || !owner || owner === "Unassigned" || textLength(workNote) < 8) return ticket;
  if (status === "resolve" && (textLength(workNote) < 20 || resolutionVerified !== true)) return ticket;
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const auditNote = status === "resolve" ? `${workNote} · requester/service recovery confirmed` : workNote;
  const firstResponseMinutes = ticket.status === "New" && status === "start" && ticket.firstResponseMinutes == null
    ? assessTicketSla(ticket).ageMinutes
    : ticket.firstResponseMinutes ?? null;
  return { ...next, assignee: owner, firstResponseMinutes, updates: [...(ticket.updates || []), `${now} · ${auditNote}`] };
}

export function assessTicketSla(ticket, now = Date.now()) {
  const targetMinutes = ticket.priority === "High" ? 15 : 30;
  const openedAt = ticket.createdAt ? Date.parse(ticket.createdAt) : NaN;
  const elapsedMinutes = Number.isFinite(openedAt) ? Math.max(0, Math.floor((now - openedAt) / 60_000)) : 0;
  const ageMinutes = Math.max(Number(ticket.ageMinutes) || 0, elapsedMinutes);
  if (ticket.firstResponseMinutes !== null && ticket.firstResponseMinutes !== undefined) {
    const met = ticket.firstResponseMinutes <= targetMinutes;
    return { state: met ? "Met" : "Breached", targetMinutes, ageMinutes, label: met ? `Met · ${ticket.firstResponseMinutes} min` : `Breached · ${ticket.firstResponseMinutes} min` };
  }
  const remaining = targetMinutes - ageMinutes;
  if (remaining <= 0) return { state: "Breached", targetMinutes, ageMinutes, label: remaining === 0 ? "Breached · due now" : `Breached · ${Math.abs(remaining)} min ago` };
  if (remaining <= 5) return { state: "Due soon", targetMinutes, ageMinutes, label: `Due in ${remaining} min` };
  return { state: "On track", targetMinutes, ageMinutes, label: `${remaining} min remaining` };
}

export function maintenanceAction(change, action, { peerReviewer, windowOpenConfirmed = false, evidence } = {}) {
  const decisionEvidence = typeof evidence === "string" ? evidence.trim() : "";
  const required = readinessChecks.map(([key]) => key);
  const ready = required.every(key => change.readiness?.[key] === true)
    && isText(change.validationPlan) && textLength(change.validationPlan.trim()) >= 12;
  const transitions = {
    reject: ["Pending approval", "Rejected"],
    start: ["Approved", "In progress"],
    passed: ["In progress", "Completed"],
    failed: ["In progress", "Rollback required"],
    rollback: ["Rollback required", "Rolled back"]
  };
  if (["approve", "reject", "start", "passed", "failed", "rollback"].includes(action) && textLength(decisionEvidence) < 12) return change;
  if (action === "start" && windowOpenConfirmed !== true) return change;
  if (action === "approve") {
    const reviewerName = typeof peerReviewer === "string" ? peerReviewer.trim() : "";
    const ownerName = typeof change.owner === "string" ? change.owner.trim() : "";
    const sameReviewer = reviewerName.toLowerCase() === ownerName.toLowerCase();
    if (change.status !== "Pending approval" || !ready || !ownerName || ownerName === "Unassigned" || !["Low", "Medium", "High"].includes(change.risk)) return change;
    if (change.risk === "High" && (change.readiness?.peerReview !== true || !reviewerName || sameReviewer)) return change;
    return { ...change, status: "Approved" };
  }
  const transition = transitions[action];
  if (!transition || change.status !== transition[0]) return change;
  return { ...change, status: transition[1] };
}
