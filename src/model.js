export const seed = {
  nodes: [
    { id: "core-sw-01", name: "Core switch · North campus", type: "Network", zone: "North campus", health: "Healthy", latency: 8, uptime: "99.99%", icon: "⇄" },
    { id: "app-srv-02", name: "Application server · ERP", type: "Compute", zone: "Cloud region A", health: "Degraded", latency: 184, uptime: "98.70%", icon: "▣" },
    { id: "db-pri-01", name: "Primary database · Finance", type: "Database", zone: "Cloud region A", health: "Healthy", latency: 14, uptime: "99.98%", icon: "◈" },
    { id: "fw-edge-01", name: "Edge firewall · HQ", type: "Security", zone: "Head office", health: "Healthy", latency: 12, uptime: "99.96%", icon: "⬡" },
    { id: "ap-east-14", name: "Wireless AP · East wing", type: "Access point", zone: "East wing", health: "Offline", latency: null, uptime: "96.20%", icon: "⌁" }
  ],
  findings: [
    { id: "SEC-2418", title: "Unpatched Linux kernel", asset: "app-srv-02", severity: "Critical", age: "2 days", status: "Open", description: "Kernel security updates are overdue on the ERP application host." },
    { id: "SEC-2413", title: "Excessive sign-in attempts", asset: "idp-gateway", severity: "High", age: "4 hours", status: "Investigating", description: "Repeated authentication failures from a single monitored source." },
    { id: "SEC-2407", title: "TLS certificate expires soon", asset: "portal-web-01", severity: "Medium", age: "3 days", status: "Open", description: "Certificate renewal is due within the next 14 days." },
    { id: "SEC-2398", title: "Stale service account", asset: "backup-agent", severity: "Low", age: "1 week", status: "Open", description: "Service account has not been used in the last 90 days." }
  ],
  tickets: [
    { id: "HD-1048", subject: "ERP sign-in is unusually slow", requester: "Jordan Lee", category: "Access & accounts", priority: "High", status: "In progress", assignee: "R. Patel", created: "09:42" },
    { id: "HD-1046", subject: "New starter laptop setup", requester: "Avery Chen", category: "Hardware", priority: "Normal", status: "New", assignee: "Unassigned", created: "09:18" },
    { id: "HD-1042", subject: "East wing Wi-Fi drops out", requester: "Sam Morgan", category: "Network", priority: "High", status: "Waiting", assignee: "T. Brown", created: "08:56" }
  ],
  maintenance: [
    { id: "CHG-208", title: "ERP host security patching", system: "Application server · ERP", window: "Today · 22:00–22:30", risk: "Medium", status: "Pending approval", owner: "R. Patel", rollback: "Restore latest VM snapshot and revert package set." }
  ],
  events: ["09:42 · ERP host latency crossed 150 ms", "09:37 · East wing access point stopped responding", "09:21 · Security finding SEC-2418 opened"]
};

export const cloneSeed = () => structuredClone(seed);
export function nextTicketId(tickets) {
  const max = tickets.reduce((n, t) => Math.max(n, Number(t.id.split("-")[1]) || 1040), 1040);
  return `HD-${max + 1}`;
}
export function transitionTicket(ticket, action) {
  const next = { ...ticket };
  if (action === "start" && next.status === "New") next.status = "In progress";
  else if (action === "wait" && next.status === "In progress") next.status = "Waiting";
  else if (action === "resolve" && next.status !== "Resolved") next.status = "Resolved";
  else return ticket;
  return next;
}
export function reduceFinding(finding, action) {
  if (action === "investigate" && finding.status === "Open") return { ...finding, status: "Investigating" };
  if (action === "resolve" && finding.status !== "Resolved") return { ...finding, status: "Resolved" };
  return finding;
}
export function maintenanceAction(change, action) {
  const allowed = { approve: ["Pending approval", "Approved"], reject: ["Pending approval", "Rejected"], rollback: ["Approved", "Rolled back"] };
  const state = allowed[action];
  return state && change.status === state[0] ? { ...change, status: state[1] } : change;
}
export function diagnoseNetwork({ site, symptom, scope }) {
  const fault = site === "East wing" || symptom === "Packet loss" || scope === "Single room" ? "Wireless access point or local uplink" : symptom === "No connectivity" ? "Gateway or upstream circuit" : "DNS resolver or name service";
  return [
    { label: "Endpoint link", result: scope === "Multiple sites" ? "Reachable" : "Check client link and local signal", ok: scope === "Multiple sites" },
    { label: "Default gateway", result: symptom === "No connectivity" ? "No response" : "Responding · 2 ms", ok: symptom !== "No connectivity" },
    { label: "DNS resolution", result: symptom === "Name lookup failure" ? "Lookup timed out" : "Resolved · 18 ms", ok: symptom !== "Name lookup failure" },
    { label: "Likely fault domain", result: fault, ok: false }
  ];
}
