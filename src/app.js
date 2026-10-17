import {
  cloneSeed, nextTicketId, transitionTicket, triageFinding, resolveFinding,
  simulateIncident, recordIncidentInvestigation, recordIncidentRecovery,
  diagnoseNetwork, updateTicket, assessTicketSla, maintenanceAction, readinessChecks
} from "./model.js";

const navItems = [
  { id: "home", icon: "⌂", label: "Overview" },
  { id: "health", icon: "⌁", label: "Infrastructure health", short: "Health monitor" },
  { id: "security", icon: "⬡", label: "Security findings", short: "Security findings" },
  { id: "helpdesk", icon: "▤", label: "IT helpdesk", short: "Helpdesk tickets" },
  { id: "network", icon: "⌘", label: "Network isolation", short: "Fault isolation" },
  { id: "maintenance", icon: "◷", label: "Maintenance & rollback", short: "Maintenance" }
];
const storageKey = "northstar-ict-demo-v2";
let state;
try {
  const cached = JSON.parse(localStorage.getItem(storageKey));
  const required = ["nodes", "findings", "tickets", "maintenance", "events"];
  state = cached && required.every(key => Array.isArray(cached[key])) ? cached : cloneSeed();
} catch { state = cloneSeed(); }
let networkResult = null;
let currentRoute = "";
const app = document.querySelector("#app");

const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const statusClass = value => String(value).toLowerCase().replace(/[^a-z]+/g, "-");
const title = (heading, description, actions = "") => `<div class="page-heading"><div><div class="eyebrow">OPERATIONS CENTER <span> / </span> ${esc(heading.toUpperCase())}</div><h1>${esc(heading)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
const button = (label, action, cls = "button button-primary", extra = "") => `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const card = (inner, cls = "card") => `<section class="${cls}">${inner}</section>`;
const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { toast("Changes are active for this session but browser storage is unavailable."); }
}
function addEvent(message) {
  state.events.unshift(`${nowLabel()} · ${message}`);
  state.events = state.events.slice(0, 20);
}
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
function renderNav(route) {
  document.querySelector("#nav").innerHTML = navItems.map(item => `<a class="nav-item ${route === item.id ? "active" : ""}" href="#${item.id}" aria-label="${esc(item.label)}" ${route === item.id ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${esc(item.label)}</span>${item.id === "security" ? `<span class="nav-count">${state.findings.filter(f => f.status !== "Resolved").length}</span>` : ""}</a>`).join("");
  const active = navItems.find(item => item.id === route) || navItems[0];
  document.querySelector("#breadcrumbs").innerHTML = `<a href="#home">Workspace</a><span>/</span><strong>${esc(active.short || active.label)}</strong>`;
}
const evidence = {
  health: ["184 ms ERP response · 88% CPU", "Compare host signals with dependency latency", "A recorded cause, remediation, and post-check"],
  security: ["Kernel patch overdue on a business-critical host", "Rank exposure and impact before assigning work", "Owner, response plan, and resolution evidence"],
  helpdesk: ["A request enters the queue with a response target", "Assign an owner and maintain a useful update trail", "Status transitions and first-response SLA"],
  network: ["Connectivity symptom and affected scope", "Test client, gateway, DNS, and upstream path", "Evidence-led fault domain and next test"],
  maintenance: ["ERP host patch has a 30-minute window", "Check readiness, impact, and rollback before approval", "Approval decision and validated completion or rollback"]
};
function engineeringBrief(id) {
  const [signal, method, proof] = evidence[id];
  return `<section class="engineering-brief" aria-label="Engineering method"><div class="brief-title"><span class="brief-mark">⌘</span><div><strong>Engineering method</strong><small>Simulated case · synthetic evidence</small></div></div><div class="brief-step"><b>Signal</b><span>${esc(signal)}</span></div><div class="brief-step"><b>Investigation</b><span>${esc(method)}</span></div><div class="brief-step"><b>Evidence</b><span>${esc(proof)}</span></div></section>`;
}
function renderHome() {
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const attention = state.nodes.filter(n => n.health !== "Healthy").length;
  const openFindings = state.findings.filter(f => f.status !== "Resolved").length;
  const openTickets = state.tickets.filter(t => t.status !== "Resolved").length;
  const pendingChanges = state.maintenance.filter(m => m.status === "Pending approval").length;
  return `${title("ICT Engineering Portfolio", `Evidence-led case studies across infrastructure, security, service operations, networks, and change control. ${today}.`, `<span class="date-chip">◉ &nbsp;Interactive casebook</span>`)}
    <div class="welcome-banner"><div class="banner-copy"><span class="banner-kicker"><span class="pulse"></span> ENGINEERING CASEBOOK · SIMULATED</span><h2>Investigate the signal.<br/>Decide with evidence.</h2><p>Five practical workflows demonstrate engineering judgement from first symptom to recorded outcome.</p><a href="#health" class="banner-link">Explore an infrastructure incident <span>↗</span></a></div><div class="banner-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="art-core"><span>✳</span></div><i class="art-dot dot-one"></i><i class="art-dot dot-two"></i><i class="art-dot dot-three"></i></div></div>
    <div class="section-heading"><div><h2>Operational snapshot</h2><p>Scenario state across the five application labs</p></div><span class="muted small">Browser-local demo data</span></div>
    <div class="metric-grid"><div class="metric-card"><div class="metric-top"><span>Infrastructure health</span><span class="metric-symbol mint">⌁</span></div><div class="metric-value">${state.nodes.length - attention}<small> / ${state.nodes.length} healthy</small></div><div class="metric-foot"><span class="${attention ? "text-amber" : "text-green"}">${attention} alerts to investigate</span><span class="sparkline mint-line">▁▃▂▅▃▆▄▇</span></div></div><div class="metric-card"><div class="metric-top"><span>Open security findings</span><span class="metric-symbol coral">⬡</span></div><div class="metric-value">${openFindings}<small> active findings</small></div><div class="metric-foot"><span class="text-coral">${state.findings.filter(f => f.severity === "Critical" && f.status !== "Resolved").length} critical · prioritize</span><span class="sparkline coral-line">▆▄▅▃▅▂▄▂</span></div></div><div class="metric-card"><div class="metric-top"><span>Helpdesk queue</span><span class="metric-symbol blue">▤</span></div><div class="metric-value">${openTickets}<small> open tickets</small></div><div class="metric-foot"><span class="text-blue">${state.tickets.filter(t => t.priority === "High" && t.status !== "Resolved").length} high priority</span><span class="sparkline blue-line">▂▄▃▅▄▆▃▅</span></div></div><div class="metric-card"><div class="metric-top"><span>Change requests</span><span class="metric-symbol violet">◷</span></div><div class="metric-value">${pendingChanges}<small> awaiting approval</small></div><div class="metric-foot"><span class="text-violet">Readiness gated</span><span class="sparkline violet-line">▂▃▂▄▃▅▄▆</span></div></div></div>
    <div class="section-heading casebook-heading"><div><h2>Engineering casebook</h2><p>Pick a scenario to see the operational method and evidence</p></div></div>
    <div class="casebook-grid">${navItems.slice(1).map((item, i) => {
      const [signal, method, proof] = evidence[item.id];
      return `<a class="casebook-card" href="#${item.id}"><div class="casebook-card-top"><span class="quick-icon quick-${i}">${item.icon}</span><span class="casebook-number">0${i + 1}</span></div><h3>${esc(item.label)}</h3><p>${esc(signal)}</p><div class="casebook-proof"><b>Method</b> ${esc(method)}<br/><b>Evidence</b> ${esc(proof)}</div><span class="casebook-link">Open scenario <b>↗</b></span></a>`;
    }).join("")}</div>
    <div class="home-columns"><div>${card(`<div class="card-header"><div><h3>Recent activity</h3><p>Actions recorded in this browser session</p></div><span class="header-icon">⌁</span></div><div class="activity-list">${state.events.slice(0, 4).map((event, i) => `<div class="activity-row"><span class="activity-dot tone-${i}"></span><span>${esc(event.split(" · ").slice(1).join(" · "))}</span><time>${esc(event.split(" · ")[0])}</time></div>`).join("") || `<div class="empty-state compact">No activity yet. Start a scenario to record a decision.</div>`}</div>`)}</div>
    <div>${card(`<div class="card-header"><div><h3>Engineering skills demonstrated</h3><p>Practical decisions represented by each lab</p></div></div><div class="skill-list"><span>Incident response</span><span>Root-cause analysis</span><span>Risk prioritization</span><span>SLA-aware service</span><span>Network troubleshooting</span><span>Change control</span><span>Rollback judgement</span><span>Technical communication</span></div><p class="skill-note">All scenarios are synthetic demonstrations. No live environment is connected.</p>`)}</div></div>`;
}
function renderHealth() {
  const healthy = state.nodes.filter(n => n.health === "Healthy").length;
  const core = state.nodes.find(n => n.id === "core-sw-01");
  const incidents = state.nodes.filter(n => n.health !== "Healthy");
  return `${title("Infrastructure health monitor", "Investigate service degradation using correlated host, network, and availability signals.", button(core.health === "Healthy" ? "⚡ Run capacity drill" : "↺ Reset capacity drill", "health-simulate", "button button-secondary"))}
  ${engineeringBrief("health")}
  <div class="health-summary"><div class="health-score"><div class="score-ring" style="--score:${Math.round(healthy / state.nodes.length * 100)}"><div><strong>${Math.round(healthy / state.nodes.length * 100)}<small>%</small></strong><span>HEALTH SCORE</span></div></div></div><div class="health-copy"><div class="eyebrow">ESTATE STATUS</div><h2>${healthy === state.nodes.length ? "All monitored services are healthy" : `${incidents.length} service${incidents.length === 1 ? "" : "s"} need investigation`}</h2><p>Use the measured signal to identify a likely cause, then record a recovery check.</p><div class="status-legend"><span><i class="legend-green"></i>${healthy} healthy</span><span><i class="legend-amber"></i>${state.nodes.filter(n => n.health === "Degraded").length} degraded</span><span><i class="legend-red"></i>${state.nodes.filter(n => n.health === "Offline").length} offline</span></div></div><div class="health-mini"><span>Mean response · reachable assets</span><strong>${Math.round(state.nodes.filter(n => n.latency !== null).reduce((sum, n) => sum + n.latency, 0) / Math.max(1, state.nodes.filter(n => n.latency !== null).length))} <small>ms</small></strong><span class="muted">Synthetic measurement</span></div></div>
  ${card(`<div class="table-header"><div><h3>Monitored assets <span class="count-pill">${state.nodes.length}</span></h3><p>Signals are scenario fixtures, not telemetry</p></div><button class="button button-quiet button-small" data-action="health-refresh">↻ Recheck</button></div><div class="table-wrap"><table><thead><tr><th>ASSET</th><th>TYPE / ZONE</th><th>STATUS</th><th>KEY SIGNAL</th><th>LATENCY</th><th>UPTIME</th></tr></thead><tbody>${state.nodes.map(node => `<tr><td><div class="asset-cell"><span class="asset-icon">${node.icon}</span><span><strong>${esc(node.name)}</strong><small>${esc(node.id)}</small></span></div></td><td>${esc(node.type)}<small class="cell-subtext">${esc(node.zone)}</small></td><td><span class="status-pill ${statusClass(node.health)}"><i></i>${node.health}${node.investigation?.status === "Investigating" ? " · under review" : ""}</span></td><td>${signalSummary(node)}</td><td>${node.latency === null ? "No heartbeat" : `${node.latency} ms`}</td><td>${node.uptime}</td></tr>`).join("")}</tbody></table></div><div class="table-bottom"><span>Five synthetic assets · refresh reruns no live checks</span><span>${incidents.length} alert${incidents.length === 1 ? "" : "s"} open</span></div>`)}
  <div class="split-grid">${card(`<div class="card-header"><div><h3>Investigation queue</h3><p>Choose a cause from the signal, not from guesswork</p></div><span class="alert-count">${incidents.length}</span></div><div class="alert-list">${incidents.map(node => `<div class="alert-row alert-row-expanded"><span class="alert-indicator ${statusClass(node.health)}">!</span><div class="alert-copy"><strong>${node.health === "Offline" ? "Heartbeat missed" : "Response / capacity threshold exceeded"}</strong><small>${esc(node.name)} · ${signalSummary(node)}</small>${node.investigation ? `<small class="decision-note">Cause: ${esc(node.investigation.cause)} · Action: ${esc(node.investigation.action)}</small>` : ""}</div>${button(node.investigation ? "Record recovery" : "Investigate", node.investigation ? "health-recover" : "health-investigate", "button button-secondary button-small", `data-id="${node.id}"`)}</div>`).join("") || `<div class="empty-state compact"><span class="empty-check">✓</span>All clear. No active alerts.</div>`}</div>`)}${card(`<div class="card-header"><div><h3>Signal interpretation</h3><p>Thresholds shown for the active case</p></div></div><div class="signal-guide"><div><span>ERP host CPU</span><b>88% <i class="signal-high">High · &gt; 80%</i></b></div><div><span>ERP sign-in queue</span><b>42 <i class="signal-high">High · &gt; 25</i></b></div><div><span>AP heartbeat</span><b>8 missed <i class="signal-critical">Offline · &gt; 3</i></b></div><p>Correlate resource pressure with response latency. Confirm the path before assigning a network cause.</p></div>`)}</div>`;
}
function signalSummary(node) {
  if (node.id === "app-srv-02") return `CPU ${node.signals.cpu}% · queue ${node.signals.queueDepth}`;
  if (node.id === "ap-east-14") return `${node.signals.missedHeartbeats} missed heartbeats · PoE ${node.signals.poeDraw} W`;
  if (node.id === "core-sw-01") return `Port use ${node.signals.portUtilization}% · errors ${node.signals.interfaceErrors}%`;
  if (node.signals.connections !== undefined) return `DB connections ${node.signals.connections}% · storage ${node.signals.storage}%`;
  return `Firewall CPU ${node.signals.cpu}% · sessions ${node.signals.sessions}%`;
}
function renderSecurity() {
  const openCritical = state.findings.filter(f => f.severity === "Critical" && f.status !== "Resolved").length;
  return `${title("Security findings", "Prioritize risk using asset impact and exposure, then record remediation ownership and evidence.", `<button class="button button-secondary" data-action="security-export">↓ &nbsp;Export findings</button>`)}
  ${engineeringBrief("security")}
  <div class="security-priority-note"><span class="priority-note-icon">!</span><div><strong>${openCritical ? `${openCritical} critical finding needs an owned response` : "No critical findings remain open"}</strong><p>Severity is a triage input. Exposure, business impact, and a verifiable fix determine the response plan.</p></div><span class="synthetic-label">SYNTHETIC RISK REGISTER</span></div>
  <div class="security-metrics"><div class="severity-card critical"><span>CRITICAL</span><strong>${state.findings.filter(f => f.severity === "Critical" && f.status !== "Resolved").length}</strong><small>Same-day response target</small></div><div class="severity-card high"><span>HIGH</span><strong>${state.findings.filter(f => f.severity === "High" && f.status !== "Resolved").length}</strong><small>One business-day target</small></div><div class="severity-card medium"><span>MEDIUM</span><strong>${state.findings.filter(f => f.severity === "Medium" && f.status !== "Resolved").length}</strong><small>Planned remediation</small></div><div class="severity-card low"><span>LOW</span><strong>${state.findings.filter(f => f.severity === "Low" && f.status !== "Resolved").length}</strong><small>Review and confirm owner</small></div></div>
  ${card(`<div class="table-header"><div><h3>Findings <span class="count-pill">${state.findings.length}</span></h3><p>Filter by severity and triage state</p></div><div class="table-controls"><label class="sr-only" for="severityFilter">Filter by severity</label><select id="severityFilter" class="select-control"><option value="All">All severities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><label class="sr-only" for="findingStatusFilter">Filter by status</label><select id="findingStatusFilter" class="select-control"><option value="Active">Active findings</option><option value="All">All findings</option><option>Open</option><option>Investigating</option><option>Resolved</option></select></div></div><div class="finding-list">${state.findings.map(finding => `<article class="finding-row" data-severity="${finding.severity}" data-status="${finding.status}"><span class="finding-icon sev-${statusClass(finding.severity)}">${finding.severity === "Critical" ? "!" : "◈"}</span><div class="finding-main"><div><strong>${esc(finding.title)}</strong><span class="severity-tag sev-${statusClass(finding.severity)}">${finding.severity} · CVSS ${finding.cvss}</span></div><p>${esc(finding.description)}</p><div class="finding-meta"><span>${esc(finding.id)}</span><span>Asset · ${esc(finding.asset)}</span><span>${esc(finding.exposure)}</span></div><div class="finding-impact"><b>Business impact</b> ${esc(finding.impact)}</div>${finding.responsePlan ? `<div class="finding-plan"><b>Owner:</b> ${esc(finding.owner)} · <b>Plan:</b> ${esc(finding.responsePlan)}</div>` : ""}${finding.resolution ? `<div class="finding-plan resolution-note"><b>Resolution evidence:</b> ${esc(finding.resolution)}</div>` : ""}</div><div class="finding-right"><span class="status-pill ${statusClass(finding.status)}"><i></i>${finding.status}</span>${finding.status === "Resolved" ? `<span class="resolved-check">✓ Evidence recorded</span>` : button(finding.status === "Open" ? "Start triage" : "Resolve with evidence", finding.status === "Open" ? "finding-triage" : "finding-resolve", `button ${finding.status === "Open" ? "button-primary" : "button-secondary"} button-small`, `data-id="${finding.id}"`)}</div></article>`).join("")}</div><div class="table-bottom"><span>CVSS and exposure are fictional scenario inputs, not a security scan</span><span>${state.findings.filter(f => f.status !== "Resolved").length} active</span></div>`)}
  <div class="info-strip"><span class="info-icon">i</span><div><strong>Triage decision record</strong><p>Open findings need an accountable owner and actionable response plan. Resolution requires a verification note.</p></div><a href="#maintenance">Plan controlled remediation →</a></div>`;
}
function ticketSla(ticket) {
  const sla = assessTicketSla(ticket);
  return `<span class="sla-pill sla-${statusClass(sla.state)}"><i></i>${esc(sla.label)}</span>`;
}
function renderHelpdesk() {
  const overdue = state.tickets.filter(ticket => assessTicketSla(ticket).state === "Breached").length;
  const slaSummary = overdue ? `${overdue} response target${overdue === 1 ? "" : "s"} breached` : "No first-response breaches";
  return `${title("IT helpdesk", "Work the request from intake through an owned update and a clear resolution record.", `<button class="button button-primary" data-action="open-ticket-form">＋ &nbsp;New ticket</button>`)}
  ${engineeringBrief("helpdesk")}
  <div class="ticket-metrics"><div class="ticket-metric"><span class="metric-symbol blue">▤</span><div><small>Open tickets</small><strong>${state.tickets.filter(t => t.status !== "Resolved").length}</strong></div><span class="metric-trend">All queues</span></div><div class="ticket-metric"><span class="metric-symbol coral">◷</span><div><small>High priority</small><strong>${state.tickets.filter(t => t.priority === "High" && t.status !== "Resolved").length}</strong></div><span class="metric-trend">Needs attention</span></div><div class="ticket-metric"><span class="metric-symbol mint">✓</span><div><small>Resolved</small><strong>${state.tickets.filter(t => t.status === "Resolved").length}</strong></div><span class="metric-trend">Session total</span></div><div class="ticket-metric sla-summary"><span class="metric-symbol violet">◎</span><div><small>First response SLA</small><strong>${esc(slaSummary)}</strong></div></div></div>
  ${card(`<div class="table-header"><div><h3>Service queue <span class="count-pill">${state.tickets.length}</span></h3><p>High priority first-response target · 15 min · Standard · 30 min</p></div><div class="table-controls"><label class="sr-only" for="ticketFilter">Filter tickets by status</label><select id="ticketFilter" class="select-control"><option value="Active">Active tickets</option><option value="All">All tickets</option><option>New</option><option>In progress</option><option>Waiting</option><option>Resolved</option></select><button class="button button-quiet button-small" data-action="ticket-refresh" aria-label="Refresh ticket queue">↻</button></div></div><div class="table-wrap"><table><thead><tr><th>TICKET / REQUEST</th><th>REQUESTER</th><th>PRIORITY</th><th>FIRST RESPONSE</th><th>ASSIGNEE</th><th>STATUS</th><th></th></tr></thead><tbody>${state.tickets.map(ticket => `<tr data-ticket-status="${ticket.status}"><td><div class="ticket-subject"><small>${esc(ticket.id)} · ${esc(ticket.category)}</small><strong>${esc(ticket.subject)}</strong></div></td><td>${esc(ticket.requester)}</td><td><span class="priority ${statusClass(ticket.priority)}"><i></i>${ticket.priority}</span></td><td>${ticketSla(ticket)}</td><td>${esc(ticket.assignee)}</td><td><span class="status-pill ${statusClass(ticket.status)}"><i></i>${ticket.status}</span></td><td><button class="button button-quiet button-small" data-action="ticket-review" data-id="${ticket.id}" aria-label="Review ${esc(ticket.id)}">Review</button></td></tr>`).join("")}</tbody></table></div><div class="table-bottom"><span>SLA clock is a synthetic training value; response targets are configurable examples</span><span>Ticket updates are saved locally</span></div>`)}
  <div class="split-grid">${card(`<div class="card-header"><div><h3>Queue by status</h3><p>Current service workload</p></div></div><div class="queue-bars">${["New", "In progress", "Waiting", "Resolved"].map((status, i) => `<div><span>${status}</span><div class="queue-track"><i style="width:${Math.max(8, state.tickets.filter(t => t.status === status).length / Math.max(1, state.tickets.length) * 100)}%;--q:${["#7188ff", "#42c6a5", "#efb756", "#a78bfa"][i]}"></i></div><b>${state.tickets.filter(t => t.status === status).length}</b></div>`).join("")}</div>`)}${card(`<div class="card-header"><div><h3>Good service-desk practice</h3><p>Each update should help the next engineer</p></div></div><div class="note-items"><div><span>01</span><p><strong>Capture impact and scope</strong>Record who is affected and when it started.</p></div><div><span>02</span><p><strong>Assign a clear owner</strong>Keep the requester informed at each handoff.</p></div><div><span>03</span><p><strong>Close with evidence</strong>Note the recovery check and user confirmation.</p></div></div>`)}</div>
  <div id="ticketFormMount"></div>`;
}
function renderNetwork() {
  return `${title("Network fault isolation", "Follow the test results to a defensible fault domain and choose the next discriminating check.", `<span class="date-chip">◉ &nbsp;Offline diagnostic simulator</span>`)}
  ${engineeringBrief("network")}
  <div class="network-intro"><div><span class="network-badge">⌘</span><div><h2>Guided connectivity check</h2><p>Symptoms narrow the path. The selected scope determines which comparison tests are meaningful.</p></div></div><span class="sim-tag"><i></i> NO LIVE PROBES</span></div>
  <div class="network-layout"><div class="diagnostic-card">${card(`<div class="card-header"><div><h3>Incident details</h3><p>Record the reported symptom before testing</p></div><span class="step-count">4 TEST POINTS</span></div><form id="diagnosticForm" class="diagnostic-form"><label>Site or location<select name="site" required><option>North campus</option><option>East wing</option><option>Head office</option><option>Cloud region A</option></select></label><label>Observed symptom<select name="symptom" required><option>Slow connection</option><option>Packet loss</option><option>No connectivity</option><option>Name lookup failure</option></select></label><label>Impact scope<select name="scope" required><option>Single room</option><option>Single user</option><option>Multiple sites</option><option>Entire floor</option></select></label><button class="button button-primary full-width" type="submit">Run isolation sequence &nbsp;→</button><p class="form-footnote">Results are reproducible scenario data. Confirm against live counters before remediation.</p></form>`)}<div id="diagnosticResults">${networkResult ? renderDiagnosticResults() : `<div class="diagnostic-placeholder"><div class="placeholder-art"><span>⌘</span><i></i><i></i><i></i></div><strong>Ready to isolate the fault</strong><p>Choose the symptom and affected scope. Each checkpoint will show supporting evidence.</p></div>`}</div></div>
  <aside class="network-aside">${card(`<div class="card-header"><div><h3>Isolation sequence</h3><p>Move outward one boundary at a time</p></div></div><div class="sequence-list">${[["01", "Confirm impact", "Scope and location"], ["02", "Check client link", "Local interface / Wi-Fi"], ["03", "Test gateway", "Default route response"], ["04", "Verify service", "DNS or upstream path"], ["05", "Choose next test", "Compare at the fault boundary"]].map((item, i) => { const result = networkResult?.checks[i]; const tone = result ? `sequence-${result[2]}` : ""; const marker = result ? (result[2] === "pass" ? "✓" : result[2] === "blocked" ? "–" : "!") : item[0]; return `<div class="sequence-item ${tone}"><span>${marker}</span><div><strong>${item[1]}</strong><small>${item[2]}</small></div>${i < 4 ? "<i>›</i>" : ""}</div>`; }).join("")}</div>`)}${card(`<div class="help-callout"><span>✧</span><strong>Engineering note</strong><p>A failed ping identifies a boundary, not a device. Compare a known-good endpoint or interface counter before changing configuration.</p></div>`)}</aside></div>`;
}
function renderDiagnosticResults() {
  const result = networkResult;
  return card(`<div class="diagnostic-result-head"><div><span class="result-icon">⌁</span><div><h3>Isolation sequence complete</h3><p>${esc(result.site)} · ${esc(result.symptom)} · ${esc(result.scope)}</p></div></div><button class="text-action" data-action="diagnostic-clear">Clear</button></div><div class="result-summary"><span class="result-alert">!</span><div><strong>Likely fault domain: ${esc(result.likelyCause)}</strong><p>${esc(result.confidence)}</p></div></div><div class="check-list">${result.checks.map((check, i) => `<div class="check-row"><span class="check-index">0${i + 1}</span><span>${esc(check[0])}</span><strong class="check-${statusClass(check[2])}"><i>${check[2] === "pass" ? "✓" : check[2] === "blocked" ? "–" : "!"}</i>${esc(check[1])}</strong></div>`).join("")}</div><div class="next-test"><b>Next discriminating test</b><p>${esc(result.nextAction)}</p></div><button class="button button-secondary full-width" data-action="diagnostic-ticket">Create handoff ticket &nbsp;↗</button>`);
}
function readinessComplete(change) {
  return readinessChecks.every(([key]) => change.readiness?.[key] === true) && (change.risk !== "High" || change.readiness?.peerReview === true);
}
function renderMaintenance() {
  return `${title("Maintenance & rollback", "Assess readiness before approval, then record implementation and validation outcomes.", `<button class="button button-primary" data-action="new-change">＋ &nbsp;New change request</button>`)}
  ${engineeringBrief("maintenance")}
  <div class="change-banner"><div class="change-banner-icon">◷</div><div><strong>Approval is a risk decision.</strong><p>Every change needs an owner, agreed window, impact check, rollback path, and post-change validation plan.</p></div><span>SYNTHETIC CHANGE CONTROL</span></div>
  <div class="change-stats"><div><span>Pending review</span><strong>${state.maintenance.filter(m => m.status === "Pending approval").length}</strong><i class="stat-pending"></i></div><div><span>Approved / in progress</span><strong>${state.maintenance.filter(m => ["Approved", "In progress"].includes(m.status)).length}</strong><i class="stat-approved"></i></div><div><span>Completed / rollback</span><strong>${state.maintenance.filter(m => ["Completed", "Rolled back"].includes(m.status)).length}</strong><i class="stat-complete"></i></div></div>
  <div class="change-columns"><div>${card(`<div class="table-header"><div><h3>Change requests <span class="count-pill">${state.maintenance.length}</span></h3><p>Readiness is persisted per request and gates approval</p></div><button class="button button-quiet button-small" data-action="maintenance-refresh">↻ Refresh</button></div><div class="change-list">${state.maintenance.map(change => {
    const checks = readinessChecks.map(([key, label]) => `<label class="readiness-check"><input type="checkbox" data-action="change-check" data-id="${change.id}" data-key="${key}" ${change.readiness?.[key] ? "checked" : ""} ${change.status !== "Pending approval" ? "disabled" : ""}><span>${esc(label)}</span></label>`).join("");
    const peerReview = change.risk === "High" ? `<label class="readiness-check risk-check"><input type="checkbox" data-action="change-check" data-id="${change.id}" data-key="peerReview" ${change.readiness?.peerReview ? "checked" : ""} ${change.status !== "Pending approval" ? "disabled" : ""}><span>Independent peer review recorded (high-risk gate)</span></label>` : "";
    let actions = "";
    if (change.status === "Pending approval") actions = `${button("Approve after review", "change-approve", "button button-primary button-small", `data-id="${change.id}" ${readinessComplete(change) ? "" : "disabled"}`)} ${button("Reject with reason", "change-reject", "button button-secondary button-small", `data-id="${change.id}"`)}`;
    else if (change.status === "Approved") actions = button("Begin implementation", "change-start", "button button-primary button-small", `data-id="${change.id}"`);
    else if (change.status === "In progress") actions = button("Record validation outcome", "change-validation", "button button-secondary button-small", `data-id="${change.id}"`);
    else if (change.status === "Rollback required") actions = button("Execute documented rollback", "change-rollback", "button button-danger button-small", `data-id="${change.id}"`);
    else actions = `<span class="muted small">${change.status === "Rolled back" ? "Rollback recorded · service checks required" : change.status === "Completed" ? "Validation passed · change closed" : "Request closed"}</span>`;
    const readiness = change.status === "Pending approval" ? `<div class="readiness-panel"><div class="readiness-heading"><strong>Approval readiness</strong><span>${readinessChecks.filter(([key]) => change.readiness?.[key]).length}/${readinessChecks.length} complete${change.risk === "High" ? ` · ${change.readiness?.peerReview ? "peer review set" : "peer review required"}` : ""}</span></div>${checks}${peerReview}</div>` : "";
    return `<article class="change-item"><div class="change-item-top"><span class="change-id">${esc(change.id)} · ${esc(change.owner)}</span><span class="status-pill ${statusClass(change.status)}"><i></i>${esc(change.status)}</span></div><h3>${esc(change.title)}</h3><div class="change-meta"><span>▣ ${esc(change.system)}</span><span>◷ ${esc(change.window)}</span><span>Risk · <b class="risk-${statusClass(change.risk)}">${esc(change.risk)}</b></span></div>${change.impact ? `<div class="change-impact"><b>Impact assessment</b>${esc(change.impact)}</div>` : ""}<div class="rollback-box"><span>↶</span><div><strong>Rollback plan</strong><p>${esc(change.rollback)}</p></div></div>${readiness}<div class="change-actions">${actions}</div>${change.history?.length ? `<div class="change-history"><b>Decision log</b>${change.history.map(entry => `<span>${esc(entry)}</span>`).join("")}</div>` : ""}</article>`;
  }).join("") || `<div class="empty-state"><span>◷</span><strong>No change requests yet</strong><p>Create a request to start a review workflow.</p></div>`}</div>`)}
  </div><aside>${card(`<div class="card-header"><div><h3>Decision standard</h3><p>Evidence expected at each gate</p></div><span class="checklist-mark">✓</span></div><div class="decision-standard"><div><b>1 · Review</b><span>Scope, impact, window, owner, and rollback.</span></div><div><b>2 · Implement</b><span>Start only within the approved window.</span></div><div><b>3 · Validate</b><span>Record a health check and user-impact result.</span></div><div><b>4 · Recover</b><span>Failed checks require documented rollback.</span></div></div>`)}${card(`<div class="approval-note"><span>ⓘ</span><p><strong>Simulation only.</strong> Approval, validation, and rollback write a browser-local audit trail. They do not trigger infrastructure changes.</p></div>`)}</aside></div>`;
}

function render() {
  const route = location.hash.replace(/^#\/?/, "") || "home";
  currentRoute = navItems.some(item => item.id === route) ? route : "home";
  renderNav(currentRoute);
  const views = { home: renderHome, health: renderHealth, security: renderSecurity, helpdesk: renderHelpdesk, network: renderNetwork, maintenance: renderMaintenance };
  app.innerHTML = views[currentRoute]();
  const activeIncidents = state.nodes.filter(node => node.health !== "Healthy").length;
  const systemStatus = document.querySelector("#systemStatus");
  systemStatus.classList.toggle("status-attention", activeIncidents > 0);
  systemStatus.innerHTML = `<i></i>${activeIncidents ? `${activeIncidents} synthetic alert${activeIncidents === 1 ? "" : "s"} open` : "Scenario baseline healthy"}`;
  document.querySelector("#resetTop").onclick = reset;
  bindPageEvents();
}
function openDialog({ eyebrow = "ENGINEERING CASE", heading, description, content, submit = "Record decision", onSubmit, cancel = "Cancel" }) {
  const root = document.createElement("div");
  root.className = "dialog-root";
  const headingId = `dialog-${Math.random().toString(36).slice(2)}`;
  root.innerHTML = `<div class="modal-backdrop"><section class="modal-card dialog-card" role="dialog" aria-modal="true" aria-labelledby="${headingId}"><div class="modal-heading"><div><span class="eyebrow">${esc(eyebrow)}</span><h2 id="${headingId}">${esc(heading)}</h2><p>${esc(description)}</p></div><button type="button" class="modal-close" data-close-dialog aria-label="Close dialog">×</button></div><form class="dialog-form">${content}<div class="modal-actions"><button type="button" class="button button-secondary" data-close-dialog>${esc(cancel)}</button><button class="button button-primary" type="submit">${esc(submit)}</button></div></form></section></div>`;
  document.body.append(root);
  const close = () => root.remove();
  root.querySelectorAll("[data-close-dialog]").forEach(el => el.addEventListener("click", close));
  root.querySelector(".modal-backdrop").addEventListener("click", event => { if (event.target === event.currentTarget) close(); });
  root.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (onSubmit(data) !== false) close();
  });
  root.querySelector("input,select,textarea")?.focus();
  return root;
}
function openIncidentInvestigation(node) {
  const defaults = {
    "app-srv-02": { cause: "CPU saturation", action: "Scale the ERP worker pool and drain the hottest process" },
    "ap-east-14": { cause: "PoE supply or access-switch port", action: "Check switch PoE budget and reseat the AP uplink" },
    "core-sw-01": { cause: "Oversubscribed uplink queue", action: "Review top talkers and rebalance the uplink queue" }
  }[node.id] || { cause: "Resource threshold", action: "Compare the affected service with a known-good peer" };
  const causeOptions = node.id === "app-srv-02" ? ["CPU saturation", "Memory pressure", "Upstream dependency latency"] : node.id === "ap-east-14" ? ["PoE supply or access-switch port", "Radio interference", "Upstream gateway"] : ["Oversubscribed uplink queue", "Duplex mismatch", "Upstream congestion"];
  openDialog({ eyebrow: "INCIDENT TRIAGE · SYNTHETIC", heading: `Investigate ${node.id}`, description: `${node.name}. Signal: ${signalSummary(node)} · ${node.latency === null ? "no heartbeat" : `${node.latency} ms response`}. Record a likely cause and a testable action.`, submit: "Record investigation", content: `<label>Likely cause<select name="cause" required>${causeOptions.map(cause => `<option ${cause === defaults.cause ? "selected" : ""}>${esc(cause)}</option>`).join("")}</select></label><label>First action / discriminating check<input name="action" required value="${esc(defaults.action)}" maxlength="140"></label><p class="dialog-hint">A hypothesis is not a confirmed cause. Keep the alert open until a post-action check passes.</p>`, onSubmit: form => {
    const index = state.nodes.findIndex(item => item.id === node.id);
    state.nodes[index] = recordIncidentInvestigation(node, form);
    addEvent(`${node.id} investigation started · ${form.cause}`);
    save(); render(); toast("Investigation recorded; verify recovery before closing the alert.");
  } });
}
function openIncidentRecovery(node) {
  openDialog({ eyebrow: "INCIDENT RECOVERY · SYNTHETIC", heading: "Record recovery check", description: `Investigation: ${node.investigation.cause}. Confirm the result that would justify closing this demo incident.`, submit: "Record passing check", content: `<label>Post-action verification<select name="verification" required><option value="">Choose a check</option><option>Latency and resource use returned below threshold</option><option>Client reconnected; gateway and DNS checks passed</option><option>Interface errors cleared and probe loss normalized</option></select></label><label>Evidence note<textarea name="notes" rows="3" required minlength="8" placeholder="Record the measured result and who confirmed service recovery."></textarea></label>`, onSubmit: form => {
    const index = state.nodes.findIndex(item => item.id === node.id);
    state.nodes[index] = recordIncidentRecovery(node, form);
    addEvent(`${node.id} recovered in simulation · ${form.verification}`);
    save(); render(); toast("Passing check recorded; simulated service returned to healthy.");
  } });
}
function openFindingTriage(finding) {
  openDialog({ eyebrow: `SECURITY TRIAGE · ${finding.id}`, heading: "Assign the remediation", description: `${finding.severity} · CVSS ${finding.cvss} · ${finding.exposure}. ${finding.impact}.`, submit: "Save triage plan", content: `<label>Owner<select name="owner" required><option value="">Assign an engineer</option><option>R. Patel</option><option>T. Brown</option><option>Jamie Diaz</option><option>Security operations</option></select></label><label>Response plan<textarea name="responsePlan" rows="3" required minlength="12">${esc(finding.recommendedAction)}</textarea></label><p class="dialog-hint">Choose a plan that can be verified. Prioritize by impact and exposure as well as the severity score.</p>`, onSubmit: form => {
    const index = state.findings.findIndex(item => item.id === finding.id);
    state.findings[index] = triageFinding(finding, form);
    addEvent(`${finding.id} triaged · owner ${form.owner}`);
    save(); render(); toast("Finding assigned with a response plan.");
  } });
}
function openFindingResolution(finding) {
  openDialog({ eyebrow: `SECURITY REMEDIATION · ${finding.id}`, heading: "Verify and resolve", description: `Planned action: ${finding.responsePlan}. Record the evidence that confirms risk reduction.`, submit: "Record resolution", content: `<label>Resolution evidence<textarea name="resolution" rows="4" required minlength="12" placeholder="Patch version, validation result, and any remaining risk..."></textarea></label><label class="confirm-check"><input type="checkbox" name="verified" value="yes" required><span>I verified the remediation outcome in this synthetic scenario.</span></label>`, onSubmit: form => {
    const index = state.findings.findIndex(item => item.id === finding.id);
    state.findings[index] = resolveFinding(finding, form);
    addEvent(`${finding.id} resolved · evidence recorded`);
    save(); render(); toast("Resolution evidence recorded.");
  } });
}
function openTicketReview(ticket) {
  const allowed = { "New": [["start", "In progress"]], "In progress": [["wait", "Waiting"], ["resolve", "Resolved"]], "Waiting": [["start", "In progress"], ["resolve", "Resolved"]], "Resolved": [["reopen", "In progress"]] }[ticket.status] || [];
  const sla = assessTicketSla(ticket);
  openDialog({ eyebrow: `SERVICE DESK · ${ticket.id}`, heading: ticket.subject, description: `${ticket.requester} · ${ticket.category} · ${ticket.priority} priority · ${sla.label}.`, submit: "Save ticket update", content: `<div class="ticket-detail-box"><b>Request context</b><p>${esc(ticket.details || "No extra detail provided.")}</p><b>Update history</b><ul>${(ticket.updates || []).map(item => `<li>${esc(item)}</li>`).join("") || "<li>Ticket created · awaiting first update</li>"}</ul></div><div class="form-row"><label>Next status<select name="status" required>${allowed.map(([action, status]) => `<option value="${action}">${status}</option>`).join("")}</select></label><label>Assignee<select name="assignee" required>${["Unassigned", "R. Patel", "T. Brown", "Jamie Diaz"].map(owner => `<option ${ticket.assignee === owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label></div><label>Work note<textarea name="note" rows="3" required minlength="8" placeholder="What was checked, changed, or communicated?"></textarea></label>`, onSubmit: form => {
    const index = state.tickets.findIndex(item => item.id === ticket.id);
    const updated = updateTicket(ticket, form);
    if (updated === ticket) { toast("Choose a valid next status and add an update note."); return false; }
    if (ticket.status === "New" && form.status === "start") updated.firstResponseMinutes = ticket.ageMinutes;
    state.tickets[index] = updated;
    addEvent(`${ticket.id} moved to ${updated.status} · ${form.note}`);
    save(); render(); toast(`${ticket.id} updated with an audit note.`);
  } });
}
function showTicketForm(prefill = {}) {
  const mount = document.querySelector("#ticketFormMount");
  if (!mount) { location.hash = "#helpdesk"; setTimeout(() => showTicketForm(prefill), 50); return; }
  const values = typeof prefill === "string" ? { subject: prefill } : prefill;
  mount.innerHTML = `<div class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="ticketDialogTitle"><div class="modal-heading"><div><span class="eyebrow">SERVICE DESK · SYNTHETIC</span><h2 id="ticketDialogTitle">Create a ticket</h2><p>Capture impact, assign ownership, and set a response priority.</p></div><button type="button" class="modal-close" data-close-ticket aria-label="Close dialog">×</button></div><form id="ticketForm"><label>Request summary<input name="subject" required maxlength="90" value="${esc(values.subject || "")}" placeholder="What does the requester need help with?"></label><div class="form-row"><label>Requester<input name="requester" required placeholder="Name"></label><label>Category<select name="category">${["Access & accounts", "Hardware", "Network", "Software", "Other"].map(x => `<option ${values.category === x ? "selected" : ""}>${x}</option>`).join("")}</select></label></div><div class="form-row"><label>Priority<select name="priority">${["Normal", "High", "Low"].map(x => `<option ${values.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>Assign to<select name="assignee">${["Unassigned", "R. Patel", "T. Brown", "Jamie Diaz"].map(x => `<option>${x}</option>`).join("")}</select></label></div><label>Impact and troubleshooting details<textarea name="details" rows="3" required minlength="8" placeholder="Who is affected, when did it start, and what has been checked?">${esc(values.details || "")}</textarea></label><div class="modal-actions"><button type="button" class="button button-secondary" data-close-ticket>Cancel</button><button class="button button-primary" type="submit">Create ticket</button></div></form></section></div>`;
  const close = () => { mount.innerHTML = ""; };
  mount.querySelectorAll("[data-close-ticket]").forEach(el => el.addEventListener("click", close));
  mount.querySelector(".modal-backdrop").addEventListener("click", event => { if (event.target === event.currentTarget) close(); });
  mount.querySelector("#ticketForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const ticket = { id: nextTicketId(state.tickets), subject: form.subject.trim(), requester: form.requester.trim(), category: form.category, priority: form.priority, status: "New", assignee: form.assignee, created: nowLabel(), ageMinutes: 0, firstResponseMinutes: null, details: form.details.trim(), updates: ["Ticket created · awaiting first response"] };
    state.tickets.unshift(ticket);
    addEvent(`${ticket.id} created · ${ticket.subject}`);
    save(); render(); toast(`${ticket.id} created; first-response clock started.`);
  });
  mount.querySelector("input")?.focus();
}
function openChangeDecision(change, decision) {
  const reject = decision === "reject";
  openDialog({ eyebrow: `CHANGE CONTROL · ${change.id}`, heading: reject ? "Reject this request" : "Approve after readiness review", description: `${change.title} · ${change.risk} risk · ${change.window}. ${reject ? "Record the reason so the requester can revise the plan." : "Confirm why the plan is acceptable and its control evidence."}`, submit: reject ? "Record rejection" : "Record approval", content: `<label>${reject ? "Rejection reason" : "Approval rationale"}<textarea name="note" rows="3" required minlength="12" placeholder="Summarize impact, controls, and decision basis."></textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    const updated = maintenanceAction(change, decision);
    if (updated === change) { toast("Approval is locked until all required readiness checks are complete."); return false; }
    updated.history = [...(change.history || []), `${nowLabel()} · ${reject ? "Rejected" : "Approved"} by Jamie Diaz · ${form.note.trim()}`];
    state.maintenance[index] = updated;
    addEvent(`${change.id} ${reject ? "rejected" : "approved"} · ${form.note.trim()}`);
    save(); render(); toast(`Change ${reject ? "rejection" : "approval"} recorded.`);
  } });
}
function openValidationDecision(change) {
  openDialog({ eyebrow: `CHANGE VALIDATION · ${change.id}`, heading: "Record post-change checks", description: `Implemented: ${change.title}. Record the measured outcome. A failed check routes the request to rollback.`, submit: "Record validation result", content: `<label>Validation outcome<select name="outcome" required><option value="">Choose result</option><option value="passed">Passed · service health within expected range</option><option value="failed">Failed · service impact or threshold breach remains</option></select></label><label>Evidence / observation<textarea name="note" rows="3" required minlength="12" placeholder="Health check result, user impact, and comparison with baseline."></textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    const action = form.outcome;
    const updated = maintenanceAction(change, action);
    if (updated === change) { toast("This request is not ready for a validation outcome."); return false; }
    updated.history = [...(change.history || []), `${nowLabel()} · Validation ${action} · ${form.note.trim()}`];
    updated.validationEvidence = form.note.trim();
    state.maintenance[index] = updated;
    addEvent(`${change.id} validation ${action} · ${form.note.trim()}`);
    save(); render(); toast(action === "passed" ? "Change closed after a passing check." : "Rollback required after failed validation.");
  } });
}
function openRollback(change) {
  openDialog({ eyebrow: `RECOVERY · ${change.id}`, heading: "Execute documented rollback", description: `Rollback plan: ${change.rollback}. Record the recovery action and service check.`, submit: "Record rollback", content: `<label>Rollback evidence<textarea name="note" rows="3" required minlength="12" placeholder="What was reverted and which service check passed?">${esc(change.rollback)}</textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    const updated = maintenanceAction(change, "rollback");
    if (updated === change) return false;
    updated.history = [...(change.history || []), `${nowLabel()} · Rollback executed · ${form.note.trim()}`];
    updated.rollbackEvidence = form.note.trim();
    state.maintenance[index] = updated;
    addEvent(`${change.id} rollback recorded · recovery check documented`);
    save(); render(); toast("Rollback decision and recovery evidence recorded.");
  } });
}
function showChangeForm() {
  openDialog({ eyebrow: "CHANGE CONTROL · SYNTHETIC", heading: "New change request", description: "Define scope, impact, maintenance window, risk, and a workable recovery path.", submit: "Submit for readiness review", content: `<label>Change title<input name="title" required maxlength="90" placeholder="e.g. Apply monthly security updates"></label><label>System<select name="system"><option>Application server · ERP</option><option>Primary database · Finance</option><option>Core switch · North campus</option><option>Edge firewall · HQ</option></select></label><div class="form-row"><label>Maintenance window<input name="window" required placeholder="e.g. Friday · 22:00–23:00"></label><label>Risk level<select name="risk"><option>Low</option><option selected>Medium</option><option>High</option></select></label></div><label>Service impact assessment<textarea name="impact" rows="2" required minlength="12" placeholder="Affected users, expected impact, and communication plan."></textarea></label><label>Rollback plan<textarea name="rollback" rows="3" required minlength="12" placeholder="Pre-change state, restore steps, owner, and recovery validation."></textarea></label>`, submit: "Submit for readiness review", onSubmit: form => {
    const next = Math.max(208, ...state.maintenance.map(change => Number(change.id.split("-")[1]) || 208)) + 1;
    const change = { id: `CHG-${next}`, title: form.title.trim(), system: form.system, window: form.window.trim(), risk: form.risk, status: "Pending approval", owner: "Jamie Diaz", rollback: form.rollback.trim(), impact: form.impact.trim(), readiness: { scopeOwner: true, windowConfirmed: true, impactAssessed: true, rollbackDocumented: true, validationReady: false }, history: [`${nowLabel()} · Request submitted · readiness review required`] };
    state.maintenance.unshift(change);
    addEvent(`${change.id} submitted · ${change.title}`);
    save(); render(); toast("Request submitted; approval remains gated on its validation plan.");
  } });
}
function bindPageEvents() {
  app.onclick = event => {
    const element = event.target.closest("[data-action]");
    if (!element || element.disabled) return;
    const { id, action } = element.dataset;
    if (action === "health-simulate") {
      const index = state.nodes.findIndex(node => node.id === "core-sw-01");
      const node = state.nodes[index];
      if (node.health === "Healthy") {
        state.nodes[index] = simulateIncident(node);
        addEvent("Capacity drill raised · core switch port utilization 96%, errors 4.8%");
        save(); render(); toast("Synthetic alert created with correlated interface signals.");
      } else {
        state.nodes[index] = { ...node, health: "Healthy", latency: 8, signals: { ...node.signals, portUtilization: 42, interfaceErrors: 0.1 }, investigation: null };
        addEvent("Capacity drill reset · core switch baseline restored");
        save(); render(); toast("Capacity drill returned to the baseline fixture.");
      }
    } else if (["health-refresh", "ticket-refresh", "maintenance-refresh"].includes(action)) {
      toast("Scenario fixtures re-rendered; no live checks were sent."); render();
    } else if (action === "health-investigate") {
      const node = state.nodes.find(item => item.id === id); if (node) openIncidentInvestigation(node);
    } else if (action === "health-recover") {
      const node = state.nodes.find(item => item.id === id); if (node) openIncidentRecovery(node);
    } else if (action === "finding-triage") {
      const finding = state.findings.find(item => item.id === id); if (finding) openFindingTriage(finding);
    } else if (action === "finding-resolve") {
      const finding = state.findings.find(item => item.id === id); if (finding) openFindingResolution(finding);
    } else if (action === "security-export") {
      const blob = new Blob([JSON.stringify(state.findings, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "northstar-security-findings.json"; anchor.click(); URL.revokeObjectURL(url); toast("Synthetic findings report exported.");
    } else if (action === "open-ticket-form") {
      showTicketForm();
    } else if (action === "ticket-review") {
      const ticket = state.tickets.find(item => item.id === id); if (ticket) openTicketReview(ticket);
    } else if (action === "diagnostic-clear") {
      networkResult = null; render();
    } else if (action === "diagnostic-ticket") {
      const result = networkResult;
      location.hash = "#helpdesk";
      setTimeout(() => showTicketForm({ subject: `Network fault · ${result.likelyCause}`, category: "Network", priority: result.checks.some(check => check[2] === "fail") ? "High" : "Normal", details: `${result.site} · ${result.scope} · ${result.symptom}. Likely fault domain: ${result.likelyCause}. Evidence: ${result.checks.map(check => `${check[0]}: ${check[1]}`).join("; ")}. Next test: ${result.nextAction}` }), 30);
    } else if (action === "new-change") {
      showChangeForm();
    } else if (action === "change-approve" || action === "change-reject") {
      const change = state.maintenance.find(item => item.id === id); if (change) openChangeDecision(change, action.split("-")[1]);
    } else if (action === "change-start") {
      updateChange(id, "start", "Implementation started in the approved window.");
    } else if (action === "change-validation") {
      const change = state.maintenance.find(item => item.id === id); if (change) openValidationDecision(change);
    } else if (action === "change-rollback") {
      const change = state.maintenance.find(item => item.id === id); if (change) openRollback(change);
    }
  };
  app.addEventListener("change", event => {
    const input = event.target.closest('[data-action="change-check"]');
    if (!input) return;
    const change = state.maintenance.find(item => item.id === input.dataset.id);
    if (!change || change.status !== "Pending approval") return;
    change.readiness[input.dataset.key] = input.checked;
    addEvent(`${change.id} readiness updated · ${input.dataset.key} ${input.checked ? "confirmed" : "cleared"}`);
    save(); render();
  });
  const diagnosticForm = document.querySelector("#diagnosticForm");
  if (diagnosticForm) diagnosticForm.onsubmit = event => {
    event.preventDefault();
    networkResult = diagnoseNetwork(Object.fromEntries(new FormData(diagnosticForm)));
    render();
  };
  const severity = document.querySelector("#severityFilter"), findingStatus = document.querySelector("#findingStatusFilter");
  const applyFindings = () => {
    document.querySelectorAll(".finding-row").forEach(row => {
      const severityMatches = !severity || severity.value === "All" || row.dataset.severity === severity.value;
      const statusMatches = !findingStatus || findingStatus.value === "All" || (findingStatus.value === "Active" && row.dataset.status !== "Resolved") || row.dataset.status === findingStatus.value;
      row.hidden = !(severityMatches && statusMatches);
    });
  };
  severity?.addEventListener("change", applyFindings);
  findingStatus?.addEventListener("change", applyFindings);
  document.querySelector("#ticketFilter")?.addEventListener("change", event => {
    document.querySelectorAll("[data-ticket-status]").forEach(row => row.hidden = !((event.target.value === "All") || (event.target.value === "Active" && row.dataset.ticketStatus !== "Resolved") || row.dataset.ticketStatus === event.target.value));
  });
}
function updateChange(id, action, note) {
  const index = state.maintenance.findIndex(change => change.id === id);
  if (index < 0) return;
  const change = state.maintenance[index];
  const updated = maintenanceAction(change, action);
  if (updated === change) { toast("The change has not met the required workflow gate."); return; }
  updated.history = [...(change.history || []), `${nowLabel()} · ${updated.status} · ${note}`];
  state.maintenance[index] = updated;
  addEvent(`${change.id} ${updated.status.toLowerCase()} · ${note}`);
  save(); render(); toast(`Change moved to ${updated.status}.`);
}
function reset() {
  state = cloneSeed(); networkResult = null; save(); render(); toast("Synthetic casebook restored to its starting state.");
}
window.addEventListener("hashchange", () => { if (currentRoute !== "network") networkResult = null; render(); });
window.addEventListener("keydown", event => {
  if (event.key === "Escape") document.querySelector(".dialog-root, #ticketFormMount .modal-backdrop")?.remove();
});
render();
