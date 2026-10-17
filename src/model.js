export const readinessChecks = [
  ["scopeOwner", "Scope and owner are clear"],
  ["windowConfirmed", "Maintenance window is agreed"],
  ["impactAssessed", "Service impact is assessed"],
  ["rollbackDocumented", "Rollback steps are documented"],
  ["validationReady", "Post-change validation is defined"]
];

export const seed = {
  nodes: [
    { id: "core-sw-01", name: "Core switch · North campus", type: "Network", zone: "North campus", health: "Healthy", latency: 8, uptime: "99.99%", icon: "⇄", signals: { portUtilization: 42, interfaceErrors: 0.1 } },
    { id: "app-srv-02", name: "Application server · ERP", type: "Compute", zone: "Cloud region A", health: "Degraded", latency: 184, uptime: "98.70%", icon: "▣", signals: { cpu: 88, memory: 81, queueDepth: 42 } },
    { id: "db-pri-01", name: "Primary database · Finance", type: "Database", zone: "Cloud region A", health: "Healthy", latency: 14, uptime: "99.98%", icon: "◈", signals: { connections: 38, storage: 64 } },
    { id: "fw-edge-01", name: "Edge firewall · HQ", type: "Security", zone: "Head office", health: "Healthy", latency: 12, uptime: "99.96%", icon: "⬡", signals: { cpu: 24, sessions: 41 } },
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
    { id: "CHG-208", title: "ERP host security patching", system: "Application server · ERP", window: "Today · 22:00–22:30", risk: "Medium", status: "Pending approval", owner: "R. Patel", impact: "Finance users may see a brief sign-in delay while the host restarts; validate ERP login and queue depth before closing.", rollback: "Restore the pre-change VM snapshot and revert the package set.", readiness: { scopeOwner: true, windowConfirmed: true, impactAssessed: true, rollbackDocumented: true, validationReady: false }, history: ["Request created · awaiting review"] }
  ],
  events: ["09:42 · ERP host latency crossed 150 ms", "09:37 · East wing access point stopped responding", "09:21 · Security finding SEC-2418 opened"]
};

export const cloneSeed = () => structuredClone(seed);

export function nextTicketId(tickets) {
  const max = tickets.reduce((n, t) => Math.max(n, Number(t.id.split("-")[1]) || 1040), 1040);
  return `HD-${max + 1}`;
}

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
  if (finding.status === "Resolved" || !owner?.trim() || !responsePlan?.trim()) return finding;
  return { ...finding, status: "Investigating", owner: owner.trim(), responsePlan: responsePlan.trim() };
}

export function resolveFinding(finding, { resolution }) {
  if (finding.status !== "Investigating" || !resolution?.trim()) return finding;
  return { ...finding, status: "Resolved", resolution: resolution.trim() };
}

export function simulateIncident(node) {
  if (node.id !== "core-sw-01" || node.health !== "Healthy") return node;
  return { ...node, health: "Degraded", latency: 241, signals: { ...node.signals, portUtilization: 96, interfaceErrors: 4.8 }, investigation: null };
}

export function recordIncidentInvestigation(node, { cause, action }) {
  if (node.health === "Healthy" || !cause?.trim() || !action?.trim()) return node;
  return { ...node, investigation: { cause: cause.trim(), action: action.trim(), status: "Investigating" } };
}

export function recordIncidentRecovery(node, { verification, notes }) {
  if (!node.investigation || !verification?.trim() || !notes?.trim()) return node;
  const signals = { ...node.signals };
  if (node.id === "app-srv-02") Object.assign(signals, { cpu: 61, memory: 67, queueDepth: 8 });
  if (node.id === "ap-east-14") Object.assign(signals, { missedHeartbeats: 0, poeDraw: 7.2 });
  if (node.id === "core-sw-01") Object.assign(signals, { portUtilization: 48, interfaceErrors: 0.2 });
  if (node.id === "app-srv-02" || node.id === "core-sw-01") return { ...node, health: "Healthy", latency: 38, signals, investigation: { ...node.investigation, status: "Resolved", verification: verification.trim(), notes: notes.trim() } };
  if (node.id === "ap-east-14") return { ...node, health: "Healthy", latency: 13, signals, investigation: { ...node.investigation, status: "Resolved", verification: verification.trim(), notes: notes.trim() } };
  return { ...node, health: "Healthy", latency: Math.min(node.latency || 30, 30), signals, investigation: { ...node.investigation, status: "Resolved", verification: verification.trim(), notes: notes.trim() } };
}

export function diagnoseNetwork({ site, symptom, scope }) {
  const multiSite = scope === "Multiple sites";
  const oneRoom = scope === "Single room" || site === "East wing";
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
    likelyCause = multiSite ? "WAN edge or upstream circuit" : oneRoom ? "Local endpoint, access point, or switch port" : "Access switch uplink or floor gateway";
    confidence = "Medium · gateway reachability failed; validate at the next hop";
    nextAction = multiSite ? "Check edge interface counters and provider handoff; compare a second site." : "Test a known-good endpoint on the same switch before replacing equipment.";
    checks = [
      ["Impact", multiSite ? "Multiple sites report loss" : `${scope} impact reported`, multiSite ? "fail" : "warning"],
      ["Client link", oneRoom ? "Local link / Wi-Fi association needs confirmation" : "Client link is up", oneRoom ? "warning" : "pass"],
      ["Default gateway", "No response · 4 probes", "fail"],
      ["DNS query", "Not run · gateway is unreachable", "blocked"]
    ];
  } else if (symptom === "Packet loss") {
    likelyCause = multiSite ? "WAN edge congestion or circuit loss" : oneRoom ? "Wireless access point or local uplink" : "Access switch uplink or queue congestion";
    confidence = "Medium · local-versus-upstream boundary needs one comparison test";
    nextAction = "Compare wired and wireless packet loss, then check interface errors on the nearest uplink.";
    checks = [
      ["Impact", multiSite ? "Loss reported at multiple sites" : `${scope} impact at ${site}`, multiSite ? "warning" : "pass"],
      ["Client link", oneRoom ? "Wireless RSSI varies · 3% retry rate" : "Client link stable", oneRoom ? "warning" : "pass"],
      ["Default gateway", "Responding · 2% probe loss", "warning"],
      ["Upstream path", multiSite ? "Loss persists beyond local gateway" : "No confirmed upstream loss", multiSite ? "fail" : "pass"]
    ];
  } else {
    likelyCause = multiSite ? "WAN latency or shared upstream service" : oneRoom ? "Wireless airtime or local access uplink" : "Application path or local queue saturation";
    confidence = "Medium · compare endpoint and gateway latency to isolate the segment";
    nextAction = "Compare wired and wireless response time; inspect interface utilization at the nearest hop.";
    checks = [
      ["Impact", multiSite ? "Several sites report slow response" : `${scope} impact at ${site}`, multiSite ? "warning" : "pass"],
      ["Client link", oneRoom ? "Wireless channel utilization elevated" : "Client link stable", oneRoom ? "warning" : "pass"],
      ["Default gateway", multiSite ? "Responding · 96 ms" : "Responding · 18 ms", multiSite ? "warning" : "pass"],
      ["DNS query", "Resolved · 18 ms", "pass"]
    ];
  }
  return { likelyCause, confidence, nextAction, checks, site, symptom, scope };
}

export function updateTicket(ticket, { status, assignee, note }) {
  const next = transitionTicket(ticket, status);
  if (next === ticket || !assignee?.trim() || !note?.trim()) return ticket;
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { ...next, assignee: assignee.trim(), updates: [...(ticket.updates || []), `${now} · ${note.trim()}`] };
}

export function assessTicketSla(ticket) {
  const targetMinutes = ticket.priority === "High" ? 15 : 30;
  if (ticket.firstResponseMinutes !== null && ticket.firstResponseMinutes !== undefined) {
    const met = ticket.firstResponseMinutes <= targetMinutes;
    return { state: met ? "Met" : "Breached", targetMinutes, label: met ? `Met · ${ticket.firstResponseMinutes} min` : `Breached · ${ticket.firstResponseMinutes} min` };
  }
  const remaining = targetMinutes - (ticket.ageMinutes || 0);
  if (remaining <= 0) return { state: "Breached", targetMinutes, label: `Breached · ${Math.abs(remaining)} min ago` };
  if (remaining <= 5) return { state: "Due soon", targetMinutes, label: `Due in ${remaining} min` };
  return { state: "On track", targetMinutes, label: `${remaining} min remaining` };
}

export function maintenanceAction(change, action) {
  const required = readinessChecks.map(([key]) => key);
  const ready = required.every(key => change.readiness?.[key] === true);
  const transitions = {
    reject: ["Pending approval", "Rejected"],
    start: ["Approved", "In progress"],
    passed: ["In progress", "Completed"],
    failed: ["In progress", "Rollback required"],
    rollback: ["Rollback required", "Rolled back"]
  };
  if (action === "approve") {
    if (change.status !== "Pending approval" || !ready || (change.risk === "High" && change.readiness?.peerReview !== true)) return change;
    return { ...change, status: "Approved" };
  }
  const transition = transitions[action];
  if (!transition || change.status !== transition[0]) return change;
  return { ...change, status: transition[1] };
}
