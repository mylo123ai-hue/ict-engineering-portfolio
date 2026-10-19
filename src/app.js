import {
  cloneSeed, migrateDemoState, isDemoState, nextTicketId, transitionTicket, triageFinding, resolveFinding,
  simulateIncident, recordIncidentInvestigation, recordIncidentRecovery,
  diagnoseNetwork, updateTicket, assessTicketSla, maintenanceAction, readinessChecks, recoveryChecks
} from "./model.js";

const navItems = [
  { id: "home", icon: "⌂", label: "Overview", mobileLabel: "Home" },
  { id: "health", icon: "⌁", label: "Infrastructure health", short: "Health monitor", mobileLabel: "Health" },
  { id: "security", icon: "⬡", label: "Security findings", short: "Security findings", mobileLabel: "Security" },
  { id: "helpdesk", icon: "▤", label: "IT helpdesk", short: "Helpdesk tickets", mobileLabel: "Helpdesk" },
  { id: "network", icon: "⌘", label: "Network isolation", short: "Fault isolation", mobileLabel: "Network" },
  { id: "maintenance", icon: "◷", label: "Maintenance & rollback", short: "Maintenance", mobileLabel: "Change" }
];
const storageKey = "northstar-ict-demo-v2";
const conflictStorageKey = `${storageKey}-sync-conflict-v1`;
const revisionStorageKey = `${storageKey}-server-revision-v1`;
let state;
let storageUnavailable = false;
let hasValidLocalState = false;
let localConflictBackup = null;
try {
  const cached = migrateDemoState(JSON.parse(localStorage.getItem(storageKey)));
  hasValidLocalState = isDemoState(cached);
  state = hasValidLocalState ? cached : cloneSeed();
} catch { state = cloneSeed(); storageUnavailable = true; }
try {
  const backup = migrateDemoState(JSON.parse(localStorage.getItem(conflictStorageKey)));
  if (isDemoState(backup)) localConflictBackup = backup;
} catch {}
let backendReady = false;
let persistenceConflict = Boolean(localConflictBackup);
let appReady = false;
let backendRevision = 0;
try {
  const cachedRevision = Number(localStorage.getItem(revisionStorageKey));
  if (Number.isInteger(cachedRevision) && cachedRevision >= 0) backendRevision = cachedRevision;
} catch { storageUnavailable = true; }
let persistenceMode = "connecting";
let remoteWrites = Promise.resolve();
let networkResult = null;
let networkInputs = { site: "North campus", symptom: "Slow connection", scope: "Single room" };
let currentRoute = "";
let slaTicker = null;
const app = document.querySelector("#app");
document.querySelector(".skip-link")?.addEventListener("click", event => {
  event.preventDefault();
  app.focus();
});

const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const statusClass = value => String(value).toLowerCase().replace(/[^a-z]+/g, "-");
const title = (heading, description, actions = "") => `<div class="page-heading"><div><div class="eyebrow">OPERATIONS CENTER <span aria-hidden="true"> / </span> ${esc(heading.toUpperCase())}</div><h1 tabindex="-1">${esc(heading)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
const button = (label, action, cls = "button button-primary", extra = "") => `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const card = (inner, cls = "card") => `<section class="${cls}">${inner}</section>`;
const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function save() {
  let localSaved = false;
  try { localStorage.setItem(storageKey, JSON.stringify(state)); storageUnavailable = false; localSaved = true; }
  catch { storageUnavailable = true; }
  if (backendReady) queueBackendSave();
  else if (appReady && persistenceMode === "local") {
    preserveUnsyncedSnapshot();
    setPersistenceStatus("conflict");
    toast("Backend is unavailable; your unsynced casebook is backed up in this browser.");
  }
  if (persistenceConflict) {
    try { localStorage.setItem(conflictStorageKey, JSON.stringify(state)); localConflictBackup = structuredClone(state); }
    catch { storageUnavailable = true; }
  }
  return localSaved || backendReady;
}
function preserveUnsyncedSnapshot() {
  const snapshot = structuredClone(state);
  persistenceConflict = true;
  try { localStorage.setItem(conflictStorageKey, JSON.stringify(snapshot)); localConflictBackup = snapshot; }
  catch { storageUnavailable = true; }
}
function setPersistenceStatus(mode) {
  persistenceMode = mode;
  const status = document.querySelector("#persistenceStatus");
  if (!status) return;
  const labels = {
    connecting: "Connecting",
    connected: "DB saved",
    saving: "DB saving",
    local: "Local only",
    conflict: "Sync conflict"
  };
  status.textContent = labels[mode] || labels.local;
  status.dataset.state = mode;
  const conflict = mode === "conflict";
  const download = document.querySelector("#downloadConflict");
  const reload = document.querySelector("#reloadShared");
  const retry = document.querySelector("#retrySync");
  if (download) download.hidden = !conflict;
  if (reload) reload.hidden = !conflict;
  if (retry) retry.hidden = !conflict;
  const summary = document.querySelector("#persistenceSummary");
  if (summary) summary.textContent = mode === "connected" || mode === "saving" ? "SQLite-backed" : "browser fallback";
}
function queueBackendSave() {
  const snapshot = structuredClone(state);
  remoteWrites = remoteWrites.then(async () => {
    if (!backendReady) return;
    setPersistenceStatus("saving");
    let response;
    try {
      response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: backendRevision, state: snapshot })
      });
    } catch {
      backendReady = false;
      preserveUnsyncedSnapshot();
      setPersistenceStatus("conflict");
      toast("Backend is unavailable; your unsynced casebook is backed up in this browser. Download it before using the server copy.");
      return;
    }
    const result = await response.json().catch(() => ({}));
    if (response.status === 409) {
      backendReady = false;
      persistenceConflict = true;
      const latestSnapshot = structuredClone(state);
      try { localStorage.setItem(conflictStorageKey, JSON.stringify(latestSnapshot)); localConflictBackup = latestSnapshot; } catch { storageUnavailable = true; }
      setPersistenceStatus("conflict");
      toast("Another session changed the shared casebook. Your unsynced snapshot is backed up here; download it before using the server copy.");
      return;
    }
    if (!response.ok || !Number.isInteger(result.revision)) {
      backendReady = false;
      preserveUnsyncedSnapshot();
      setPersistenceStatus("conflict");
      toast("Backend save failed; your unsynced casebook is backed up in this browser. Download it before using the server copy.");
      return;
    }
    backendRevision = result.revision;
    try { localStorage.setItem(revisionStorageKey, String(backendRevision)); } catch { storageUnavailable = true; }
    if (persistenceConflict && JSON.stringify(snapshot) === JSON.stringify(state)) {
      persistenceConflict = false;
      localConflictBackup = null;
      try { localStorage.removeItem(conflictStorageKey); } catch { storageUnavailable = true; }
    }
    setPersistenceStatus(persistenceConflict ? "conflict" : "connected");
  }).catch(() => {
    backendReady = false;
    preserveUnsyncedSnapshot();
    setPersistenceStatus("conflict");
    toast("Backend save failed; your unsynced casebook is backed up in this browser. Download it before using the server copy.");
  });
}
function storeLocalSnapshot(snapshot) {
  try { localStorage.setItem(storageKey, JSON.stringify(snapshot)); storageUnavailable = false; }
  catch { storageUnavailable = true; }
}
async function initializeApp() {
  if (localConflictBackup) {
    state = localConflictBackup;
    persistenceConflict = true;
    appReady = true;
    setPersistenceStatus("conflict");
    render();
    toast("Restored this browser's unsynced casebook. Download a backup or deliberately use the server copy.");
    return;
  }
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Backend is unavailable");
    const remote = await response.json();
    if (!Number.isInteger(remote.revision) || remote.revision < 0) throw new Error("Invalid backend revision");
    backendRevision = remote.revision;
    try { localStorage.setItem(revisionStorageKey, String(backendRevision)); } catch { storageUnavailable = true; }
    if (remote.state !== null) {
      const restored = migrateDemoState(remote.state);
      if (!isDemoState(restored)) throw new Error("Backend state failed validation");
      state = restored;
      storeLocalSnapshot(state);
    } else if (hasValidLocalState) {
      state = migrateDemoState(state);
    } else {
      state = cloneSeed();
    }
    storeLocalSnapshot(state);
    backendReady = true;
    appReady = true;
    setPersistenceStatus("connected");
    render();
    if (remote.state === null) queueBackendSave();
  } catch {
    backendReady = false;
    appReady = true;
    storeLocalSnapshot(state);
    setPersistenceStatus("local");
    render();
  }
}
function downloadConflictBackup() {
  const content = JSON.stringify(localConflictBackup || state, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "northstar-unsynced-casebook.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function retryBackendSync() {
  if (!persistenceConflict) return;
  state = localConflictBackup || state;
  backendReady = true;
  queueBackendSave();
}
async function useServerCopy() {
  if (!window.confirm("Discard this browser's unsynced casebook and reload the current server copy? Download a backup first if you need these changes.")) return;
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("The shared casebook is unavailable");
    const remote = await response.json();
    if (!Number.isInteger(remote.revision) || remote.revision < 0 || (remote.state !== null && !isDemoState(migrateDemoState(remote.state)))) {
      throw new Error("The shared casebook failed validation");
    }
  } catch {
    toast("The shared casebook is unavailable; your browser backup is still saved.");
    return;
  }
  try {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(conflictStorageKey);
  } catch { storageUnavailable = true; }
  localConflictBackup = null;
  persistenceConflict = false;
  location.reload();
}
function addEvent(message) {
  state.events.unshift(`${nowLabel()} · ${message}`);
  state.events = state.events.slice(0, 20);
}
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = storageUnavailable && !backendReady ? `${message} Browser storage is unavailable; changes last only in this session.` : message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
function renderNav(route) {
  document.querySelector("#nav").innerHTML = navItems.map(item => `<a class="nav-item ${route === item.id ? "active" : ""}" href="#${item.id}" aria-label="${esc(item.label)}" title="${esc(item.label)}" ${route === item.id ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${item.icon}</span><span class="nav-text">${esc(item.label)}</span><span class="nav-mobile-label" aria-hidden="true">${esc(item.mobileLabel)}</span>${item.id === "security" ? `<span class="nav-count">${state.findings.filter(f => f.status !== "Resolved").length}</span>` : ""}</a>`).join("");
  const active = navItems.find(item => item.id === route) || navItems[0];
  document.title = `${route === "home" ? "ICT Engineering Portfolio" : active.short || active.label} · Northstar`;
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
  return `<section class="engineering-brief" aria-label="Engineering method"><div class="brief-title"><span class="brief-mark" aria-hidden="true">⌘</span><div><strong>Engineering method</strong><small>Simulated case · synthetic evidence</small></div></div><div class="brief-step"><b>Signal</b><span>${esc(signal)}</span></div><div class="brief-step"><b>Investigation</b><span>${esc(method)}</span></div><div class="brief-step"><b>Evidence</b><span>${esc(proof)}</span></div></section>`;
}
function renderHome() {
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const attention = state.nodes.filter(n => n.health !== "Healthy").length;
  const openFindings = state.findings.filter(f => f.status !== "Resolved").length;
  const openTickets = state.tickets.filter(t => t.status !== "Resolved").length;
  const pendingChanges = state.maintenance.filter(m => m.status === "Pending approval").length;
  return `${title("ICT Engineering Portfolio", `Evidence-led case studies across infrastructure, security, service operations, networks, and change control. ${today}.`, `<span class="date-chip">◉ &nbsp;Interactive casebook</span>`)}
    <div class="welcome-banner"><div class="banner-copy"><span class="banner-kicker"><span class="pulse"></span> ENGINEERING CASEBOOK · SIMULATED</span><h2>Investigate the signal.<br/>Decide with evidence.</h2><p>Five practical workflows demonstrate engineering judgement from first symptom to recorded outcome.</p><a href="#health" class="banner-link">Explore an infrastructure incident <span aria-hidden="true">→</span></a></div><div class="banner-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="art-core"><span>✳</span></div><i class="art-dot dot-one"></i><i class="art-dot dot-two"></i><i class="art-dot dot-three"></i></div></div>
    <div class="section-heading"><div><h2>Operational snapshot</h2><p>Scenario state across the five application labs</p></div><span class="muted small">Synthetic casebook · <span id="persistenceSummary">SQLite</span></span></div>
    <div class="metric-grid"><div class="metric-card"><div class="metric-top"><span>Infrastructure health</span><span class="metric-symbol mint" aria-hidden="true">⌁</span></div><div class="metric-value">${state.nodes.length - attention}<small> / ${state.nodes.length} healthy</small></div><div class="metric-foot"><span class="${attention ? "text-amber" : "text-green"}">${attention} alerts to investigate</span><span class="sparkline mint-line" aria-hidden="true">▁▃▂▅▃▆▄▇</span></div></div><div class="metric-card"><div class="metric-top"><span>Open security findings</span><span class="metric-symbol coral" aria-hidden="true">⬡</span></div><div class="metric-value">${openFindings}<small> active findings</small></div><div class="metric-foot"><span class="text-coral">${state.findings.filter(f => f.severity === "Critical" && f.status !== "Resolved").length} critical · prioritize</span><span class="sparkline coral-line" aria-hidden="true">▆▄▅▃▅▂▄▂</span></div></div><div class="metric-card"><div class="metric-top"><span>Helpdesk queue</span><span class="metric-symbol blue" aria-hidden="true">▤</span></div><div class="metric-value">${openTickets}<small> open tickets</small></div><div class="metric-foot"><span class="text-blue">${state.tickets.filter(t => t.priority === "High" && t.status !== "Resolved").length} high priority</span><span class="sparkline blue-line" aria-hidden="true">▂▄▃▅▄▆▃▅</span></div></div><div class="metric-card"><div class="metric-top"><span>Change requests</span><span class="metric-symbol violet" aria-hidden="true">◷</span></div><div class="metric-value">${pendingChanges}<small> awaiting approval</small></div><div class="metric-foot"><span class="text-violet">Readiness gated</span><span class="sparkline violet-line" aria-hidden="true">▂▃▂▄▃▅▄▆</span></div></div></div>
    <div class="section-heading casebook-heading"><div><h2>Engineering casebook</h2><p>Pick a scenario to see the operational method and evidence</p></div></div>
    <div class="casebook-grid">${navItems.slice(1).map((item, i) => {
      const [signal, method, proof] = evidence[item.id];
      return `<a class="casebook-card" href="#${item.id}"><div class="casebook-card-top"><span class="quick-icon quick-${i}" aria-hidden="true">${item.icon}</span><span class="casebook-number" aria-hidden="true">0${i + 1}</span></div><h3>${esc(item.label)}</h3><p>${esc(signal)}</p><div class="casebook-proof"><b>Method</b> ${esc(method)}<br/><b>Evidence</b> ${esc(proof)}</div><span class="casebook-link">Open scenario <b aria-hidden="true">→</b></span></a>`;
    }).join("")}</div>
    <div class="home-columns"><div>${card(`<div class="card-header"><div><h3>Recent activity</h3><p>Synthetic scenario events and demo decisions</p></div><span class="header-icon" aria-hidden="true">⌁</span></div><div class="activity-list">${state.events.slice(0, 4).map((event, i) => `<div class="activity-row"><span class="activity-dot tone-${i}" aria-hidden="true"></span><span>${esc(event.split(" · ").slice(1).join(" · "))}</span><time>${esc(event.split(" · ")[0])}</time></div>`).join("") || `<div class="empty-state compact">No activity yet. Start a scenario to record a decision.</div>`}</div>`)}</div>
    <div>${card(`<div class="card-header"><div><h3>Engineering skills demonstrated</h3><p>Practical decisions represented by each lab</p></div></div><div class="skill-list"><span>Incident response</span><span>Root-cause analysis</span><span>Risk prioritization</span><span>SLA-aware service</span><span>Network troubleshooting</span><span>Change control</span><span>Rollback judgement</span><span>Technical communication</span></div><p class="skill-note">All scenarios are synthetic demonstrations. No live environment is connected.</p>`)}</div></div>`;
}
function renderHealth() {
  const healthy = state.nodes.filter(n => n.health === "Healthy").length;
  const core = state.nodes.find(n => n.id === "core-sw-01");
  const erp = state.nodes.find(n => n.id === "app-srv-02");
  const accessPoint = state.nodes.find(n => n.id === "ap-east-14");
  const incidents = state.nodes.filter(n => n.health !== "Healthy");
  return `${title("Infrastructure health monitor", "Investigate service degradation using correlated host, network, and availability signals.", button(core.health === "Healthy" ? "⚡ Run capacity drill" : "↺ Reset capacity drill", "health-simulate", "button button-secondary"))}
  ${engineeringBrief("health")}
  <div class="health-summary"><div class="health-score"><div class="score-ring" style="--score:${Math.round(healthy / state.nodes.length * 100)}"><div><strong>${Math.round(healthy / state.nodes.length * 100)}<small>%</small></strong><span>HEALTH SCORE</span></div></div></div><div class="health-copy"><div class="eyebrow">ESTATE STATUS</div><h2>${healthy === state.nodes.length ? "All monitored services are healthy" : `${incidents.length} service${incidents.length === 1 ? "" : "s"} need investigation`}</h2><p>Use the measured signal to identify a likely cause, then record a recovery check.</p><div class="status-legend"><span><i class="legend-green"></i>${healthy} healthy</span><span><i class="legend-amber"></i>${state.nodes.filter(n => n.health === "Degraded").length} degraded</span><span><i class="legend-red"></i>${state.nodes.filter(n => n.health === "Offline").length} offline</span></div></div><div class="health-mini"><span>Mean response · reachable assets</span><strong>${Math.round(state.nodes.filter(n => n.latency !== null).reduce((sum, n) => sum + n.latency, 0) / Math.max(1, state.nodes.filter(n => n.latency !== null).length))} <small>ms</small></strong><span class="muted">Synthetic measurement</span></div></div>
  ${card(`<div class="table-header"><div><h3>Monitored assets <span class="count-pill">${state.nodes.length}</span></h3><p>Signals are scenario fixtures, not telemetry</p></div><button class="button button-quiet button-small" data-action="health-refresh">↻ Recheck</button></div><div class="table-wrap" role="region" tabindex="0" aria-label="Monitored assets table" aria-describedby="asset-table-scroll-help"><p id="asset-table-scroll-help" class="sr-only">Focus this region and use the left and right arrow keys to view all columns.</p><table><thead><tr><th>ASSET</th><th>TYPE / ZONE</th><th>STATUS</th><th>KEY SIGNAL</th><th>LATENCY</th><th>UPTIME</th></tr></thead><tbody>${state.nodes.map(node => `<tr><td><div class="asset-cell"><span class="asset-icon" aria-hidden="true">${esc(node.icon)}</span><span><strong>${esc(node.name)}</strong><small>${esc(node.id)}</small></span></div></td><td>${esc(node.type)}<small class="cell-subtext">${esc(node.zone)}</small></td><td><span class="status-pill ${statusClass(node.health)}"><i aria-hidden="true"></i>${esc(node.health)}${node.investigation?.status === "Investigating" ? " · under review" : ""}</span></td><td>${signalSummary(node)}</td><td>${node.latency === null ? "No heartbeat" : `${esc(node.latency)} ms`}</td><td>${esc(node.uptime)}</td></tr>`).join("")}</tbody></table></div><div class="table-bottom"><span>Five synthetic assets · refresh reruns no live checks</span><span>${incidents.length} alert${incidents.length === 1 ? "" : "s"} open</span></div>`)}
  <div class="split-grid">${card(`<div class="card-header"><div><h3>Investigation queue</h3><p>Choose a cause from the signal, not from guesswork</p></div><span class="alert-count">${incidents.length}</span></div><div class="alert-list">${incidents.map(node => `<div class="alert-row alert-row-expanded"><span class="alert-indicator ${statusClass(node.health)}" aria-hidden="true">!</span><div class="alert-copy"><strong>${node.health === "Offline" ? "Heartbeat missed" : "Response / capacity threshold exceeded"}</strong><small>${esc(node.name)} · ${signalSummary(node)}</small>${node.investigation ? `<small class="decision-note">Owner: ${esc(node.investigation.owner)} · Cause: ${esc(node.investigation.cause)} · Action: ${esc(node.investigation.action)}</small>` : ""}</div><div class="alert-actions">${button(node.investigation ? "Record recovery" : "Investigate", node.investigation ? "health-recover" : "health-investigate", "button button-secondary button-small", `data-id="${node.id}"`)}${button("Create incident ticket", "health-ticket", "button button-quiet button-small", `data-id="${node.id}"`)}</div></div>`).join("") || `<div class="empty-state compact"><span class="empty-check" aria-hidden="true">✓</span>All clear. No active alerts.</div>`}</div>`)}${card(`<div class="card-header"><div><h3>Signal interpretation</h3><p>Current fixture against illustrative thresholds</p></div></div><div class="signal-guide"><div><span>ERP host CPU</span>${thresholdSignal(erp.signals.cpu, 80, "%", "High")}</div><div><span>ERP sign-in queue</span>${thresholdSignal(erp.signals.queueDepth, 25, "", "High")}</div><div><span>Core switch port use</span>${thresholdSignal(core.signals.portUtilization, 80, "%", "High")}</div><div><span>Core interface errors</span>${thresholdSignal(core.signals.interfaceErrors, 1, "%", "High")}</div><div><span>AP missed heartbeats</span>${thresholdSignal(accessPoint.signals.missedHeartbeats, 3, " missed", "Offline")}</div><p>Correlate resource pressure with response latency. Confirm the path before assigning a network cause.</p></div>`)}</div>`;
}
function thresholdSignal(value, threshold, unit, highText) {
  const exceeds = Number(value) > threshold;
  return `<b>${esc(value)}${unit}<i class="${exceeds ? "signal-high" : "signal-ok"}">${exceeds ? `${highText} · &gt; ${threshold}${unit}` : "Within threshold"}</i></b>`;
}
function signalSummary(node) {
  if (node.id === "app-srv-02") return `CPU ${esc(node.signals.cpu)}% · queue ${esc(node.signals.queueDepth)}`;
  if (node.id === "ap-east-14") return `${esc(node.signals.missedHeartbeats)} missed heartbeats · PoE ${esc(node.signals.poeDraw)} W`;
  if (node.id === "core-sw-01") return `Port use ${esc(node.signals.portUtilization)}% · errors ${esc(node.signals.interfaceErrors)}%`;
  if (node.signals.connectionUtilization !== undefined) return `DB connection pool ${esc(node.signals.connectionUtilization)}% · storage ${esc(node.signals.storage)}%`;
  return `Firewall CPU ${esc(node.signals.cpu)}% · session utilization ${esc(node.signals.sessionUtilization)}%`;
}
function renderSecurity() {
  const openCritical = state.findings.filter(f => f.severity === "Critical" && f.status !== "Resolved").length;
  return `${title("Security findings", "Prioritize risk using asset impact and exposure, then record remediation ownership and evidence.", `<button class="button button-secondary" data-action="security-export">↓ &nbsp;Export findings</button>`)}
  ${engineeringBrief("security")}
  <div class="security-priority-note"><span class="priority-note-icon" aria-hidden="true">!</span><div><strong>${openCritical ? `${openCritical} critical finding needs an owned response` : "No critical findings remain open"}</strong><p>Severity is a triage input. Exposure, business impact, and a verifiable fix determine the response plan.</p></div><span class="synthetic-label">SYNTHETIC RISK REGISTER</span></div>
  <div class="security-metrics"><div class="severity-card critical"><span>CRITICAL</span><strong>${state.findings.filter(f => f.severity === "Critical" && f.status !== "Resolved").length}</strong><small>Illustrative · same-day</small></div><div class="severity-card high"><span>HIGH</span><strong>${state.findings.filter(f => f.severity === "High" && f.status !== "Resolved").length}</strong><small>Illustrative · 1 business day</small></div><div class="severity-card medium"><span>MEDIUM</span><strong>${state.findings.filter(f => f.severity === "Medium" && f.status !== "Resolved").length}</strong><small>Example · planned remediation</small></div><div class="severity-card low"><span>LOW</span><strong>${state.findings.filter(f => f.severity === "Low" && f.status !== "Resolved").length}</strong><small>Example · confirm owner</small></div></div>
  ${card(`<div class="table-header"><div><h3>Findings <span class="count-pill">${state.findings.length}</span></h3><p>Filter by severity and triage state</p></div><div class="table-controls"><label class="sr-only" for="severityFilter">Filter by severity</label><select id="severityFilter" class="select-control"><option value="All">All severities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><label class="sr-only" for="findingStatusFilter">Filter by status</label><select id="findingStatusFilter" class="select-control"><option value="Active">Active findings</option><option value="All">All findings</option><option>Open</option><option>Investigating</option><option>Resolved</option></select></div></div><div class="finding-list">${state.findings.map(finding => `<article class="finding-row" data-severity="${esc(finding.severity)}" data-status="${esc(finding.status)}"><span class="finding-icon sev-${statusClass(finding.severity)}" aria-hidden="true">${finding.severity === "Critical" ? "!" : "◈"}</span><div class="finding-main"><div><strong>${esc(finding.title)}</strong><span class="severity-tag sev-${statusClass(finding.severity)}">${esc(finding.severity)} · CVSS ${esc(finding.cvss)}</span></div><p>${esc(finding.description)}</p><div class="finding-meta"><span>${esc(finding.id)}</span><span>Asset · ${esc(finding.asset)}</span><span>${esc(finding.exposure)}</span></div><div class="finding-impact"><b>Business impact</b> ${esc(finding.impact)}</div>${finding.responsePlan ? `<div class="finding-plan"><b>Owner:</b> ${esc(finding.owner)} · <b>Plan:</b> ${esc(finding.responsePlan)}</div>` : ""}${finding.resolution ? `<div class="finding-plan resolution-note"><b>Resolution evidence:</b> ${esc(finding.resolution)}</div>` : ""}</div><div class="finding-right"><span class="status-pill ${statusClass(finding.status)}"><i></i>${esc(finding.status)}</span>${finding.status === "Resolved" ? `<span class="resolved-check">✓ Evidence recorded</span>` : `${button(finding.status === "Open" ? "Start triage" : "Resolve with evidence", finding.status === "Open" ? "finding-triage" : "finding-resolve", `button ${finding.status === "Open" ? "button-primary" : "button-secondary"} button-small`, `data-id="${esc(finding.id)}"`)}${finding.id === "SEC-2418" && finding.status === "Investigating" ? button("Plan patch change", "finding-change", "button button-quiet button-small", `data-id="${esc(finding.id)}"`) : ""}`}</div></article>`).join("")}<div id="findingFilterEmpty" class="empty-state compact" role="status" hidden>No findings match these filters.</div></div><div class="table-bottom"><span>CVSS and exposure are fictional scenario inputs, not a security scan</span><span>${state.findings.filter(f => f.status !== "Resolved").length} active</span></div>`)}
  <div class="info-strip"><span class="info-icon" aria-hidden="true">i</span><div><strong>Triage decision record</strong><p>Open findings need an accountable owner and actionable response plan. Resolution requires a verification note.</p></div><a href="#maintenance">Plan controlled remediation →</a></div>`;
}
function ticketSla(ticket) {
  const sla = assessTicketSla(ticket);
  return `<span class="sla-pill sla-${statusClass(sla.state)}" data-ticket-sla="${esc(ticket.id)}"><i aria-hidden="true"></i>${esc(sla.label)}</span>`;
}
function renderHelpdesk() {
  const overdue = state.tickets.filter(ticket => assessTicketSla(ticket).state === "Breached").length;
  const slaSummary = overdue ? `${overdue} response target${overdue === 1 ? "" : "s"} breached` : "No first-response breaches";
  return `${title("IT helpdesk", "Work the request from intake through an owned update and a clear resolution record.", `<button class="button button-primary" data-action="open-ticket-form">＋ &nbsp;New ticket</button>`)}
  ${engineeringBrief("helpdesk")}
  <div class="ticket-metrics"><div class="ticket-metric"><span class="metric-symbol blue" aria-hidden="true">▤</span><div><small>Open tickets</small><strong>${state.tickets.filter(t => t.status !== "Resolved").length}</strong></div><span class="metric-trend">All queues</span></div><div class="ticket-metric"><span class="metric-symbol coral" aria-hidden="true">◷</span><div><small>High priority</small><strong>${state.tickets.filter(t => t.priority === "High" && t.status !== "Resolved").length}</strong></div><span class="metric-trend">Needs attention</span></div><div class="ticket-metric"><span class="metric-symbol mint" aria-hidden="true">✓</span><div><small>Resolved</small><strong>${state.tickets.filter(t => t.status === "Resolved").length}</strong></div><span class="metric-trend">Recorded</span></div><div class="ticket-metric sla-summary"><span class="metric-symbol violet" aria-hidden="true">◎</span><div><small>First response SLA</small><strong>${esc(slaSummary)}</strong></div></div></div>
  ${card(`<div class="table-header"><div><h3>Service queue <span class="count-pill">${state.tickets.length}</span></h3><p>First-response example · High 15 min · Normal / low 30 min</p></div><div class="table-controls"><label class="sr-only" for="ticketFilter">Filter tickets by status</label><select id="ticketFilter" class="select-control"><option value="Active">Active tickets</option><option value="All">All tickets</option><option>New</option><option>In progress</option><option>Waiting</option><option>Resolved</option></select><button class="button button-quiet button-small" data-action="ticket-refresh" aria-label="Refresh ticket queue">↻</button></div></div><div class="table-wrap" role="region" tabindex="0" aria-label="Service queue table" aria-describedby="service-table-scroll-help"><p id="service-table-scroll-help" class="sr-only">Focus this region and use the left and right arrow keys to view all columns.</p><table><thead><tr><th>TICKET / REQUEST</th><th>REQUESTER</th><th>PRIORITY</th><th>FIRST RESPONSE</th><th>ASSIGNEE</th><th>STATUS</th><th></th></tr></thead><tbody>${state.tickets.map(ticket => `<tr data-ticket-status="${ticket.status}" data-ticket-id="${esc(ticket.id)}"><td><div class="ticket-subject"><small>${esc(ticket.id)} · ${esc(ticket.category)}${ticket.relatedAssetId ? ` · ${esc(ticket.relatedAssetId)}` : ""}</small><strong>${esc(ticket.subject)}</strong></div></td><td>${esc(ticket.requester)}</td><td><span class="priority ${statusClass(ticket.priority)}"><i></i>${ticket.priority}</span></td><td>${ticketSla(ticket)}</td><td>${esc(ticket.assignee)}</td><td><span class="status-pill ${statusClass(ticket.status)}"><i></i>${ticket.status}</span></td><td><button class="button button-quiet button-small" data-action="ticket-review" data-id="${ticket.id}" aria-label="Review ${esc(ticket.id)}">Review</button></td></tr>`).join("")}<tr id="ticketFilterEmpty" hidden><td colspan="7"><div class="empty-state compact" role="status">No tickets match this filter.</div></td></tr></tbody></table></div><div class="table-bottom"><span>Training targets only: High 15 min · Normal/low 30 min · not a service commitment</span><span>Ticket updates are saved to the local casebook</span></div>`)}
  <div class="split-grid">${card(`<div class="card-header"><div><h3>Queue by status</h3><p>Current service workload</p></div></div><div class="queue-bars">${["New", "In progress", "Waiting", "Resolved"].map((status, i) => `<div><span>${status}</span><div class="queue-track"><i style="width:${Math.max(8, state.tickets.filter(t => t.status === status).length / Math.max(1, state.tickets.length) * 100)}%;--q:${["#7188ff", "#42c6a5", "#efb756", "#a78bfa"][i]}"></i></div><b>${state.tickets.filter(t => t.status === status).length}</b></div>`).join("")}</div>`)}${card(`<div class="card-header"><div><h3>Good service-desk practice</h3><p>Each update should help the next engineer</p></div></div><div class="note-items"><div><span>01</span><p><strong>Capture impact and scope</strong>Record who is affected and when it started.</p></div><div><span>02</span><p><strong>Assign a clear owner</strong>Keep the requester informed at each handoff.</p></div><div><span>03</span><p><strong>Close with evidence</strong>Note the recovery check and user confirmation.</p></div></div>`)}</div>
  `;
}
function renderNetwork() {
  return `${title("Network fault isolation", "Follow the test results to a defensible fault domain and choose the next discriminating check.", `<span class="date-chip">◉ &nbsp;Offline diagnostic simulator</span>`)}
  ${engineeringBrief("network")}
  <div class="network-intro"><div><span class="network-badge" aria-hidden="true">⌘</span><div><h2>Guided connectivity check</h2><p>Symptoms narrow the path. The selected scope determines which comparison tests are meaningful.</p></div></div><span class="sim-tag"><i></i> NO LIVE PROBES</span></div>
  <div class="network-layout"><div class="diagnostic-card">${card(`<div class="card-header"><div><h3>Incident details</h3><p>Record the reported symptom before testing</p></div><span class="step-count">4 TEST POINTS</span></div><form id="diagnosticForm" class="diagnostic-form"><label>Site or location<select name="site" required><option ${optionSelected("site", "North campus")}>North campus</option><option ${optionSelected("site", "East wing")}>East wing</option><option ${optionSelected("site", "Head office")}>Head office</option><option ${optionSelected("site", "Cloud region A")}>Cloud region A</option></select></label><label>Observed symptom<select name="symptom" required><option ${optionSelected("symptom", "Slow connection")}>Slow connection</option><option ${optionSelected("symptom", "Packet loss")}>Packet loss</option><option ${optionSelected("symptom", "No connectivity")}>No connectivity</option><option ${optionSelected("symptom", "Name lookup failure")}>Name lookup failure</option></select></label><label>Impact scope<select name="scope" required><option ${optionSelected("scope", "Single room")}>Single room</option><option ${optionSelected("scope", "Single user")}>Single user</option><option ${optionSelected("scope", "Multiple sites")}>Multiple sites</option><option ${optionSelected("scope", "Entire floor")}>Entire floor</option></select></label><button class="button button-primary full-width" type="submit">Run isolation sequence &nbsp;→</button><p class="form-footnote">Results are reproducible scenario data. Confirm against live counters before remediation.</p></form>`)}<div id="diagnosticResults" role="region" aria-live="polite" aria-atomic="true" aria-label="Network diagnostic results">${networkResult ? renderDiagnosticResults() : diagnosticPlaceholder()}</div></div>
  <aside class="network-aside">${card(`<div class="card-header"><div><h3>Isolation sequence</h3><p>Move outward one boundary at a time</p></div></div><div class="sequence-list">${[["01", "Confirm impact", "Scope and location"], ["02", "Check client link", "Local interface / Wi-Fi"], ["03", "Test gateway", "Default route response"], ["04", "Verify service", "DNS or upstream path"], ["05", "Choose next test", "Compare at the fault boundary"]].map((item, i) => { const result = networkResult?.checks[i]; const tone = result ? `sequence-${result[2]}` : ""; const marker = result ? (result[2] === "pass" ? "✓" : result[2] === "blocked" ? "–" : "!") : item[0]; return `<div class="sequence-item ${tone}"><span aria-hidden="true">${marker}</span><div><strong>${item[1]}</strong><small>${item[2]}</small></div>${i < 4 ? "<i>›</i>" : ""}</div>`; }).join("")}</div>`)}${card(`<div class="help-callout"><span aria-hidden="true">✧</span><strong>Engineering note</strong><p>A failed ping identifies a boundary, not a device. Compare a known-good endpoint or interface counter before changing configuration.</p></div>`)}</aside></div>`;
}
function optionSelected(field, value) {
  return networkInputs[field] === value ? "selected" : "";
}
function diagnosticPlaceholder(inputsChanged = false) {
  const heading = inputsChanged ? "Inputs changed" : "Ready to isolate the fault";
  const hint = inputsChanged ? "Run the isolation sequence again before reviewing or handing off diagnostic evidence." : "Choose the symptom and affected scope. Each checkpoint will show supporting evidence.";
  return `<div class="diagnostic-placeholder"><div class="placeholder-art" aria-hidden="true"><span>⌘</span><i></i><i></i><i></i></div><strong>${heading}</strong><p>${hint}</p></div>`;
}
function renderDiagnosticResults() {
  const result = networkResult;
  return card(`<div class="diagnostic-result-head"><div><span class="result-icon" aria-hidden="true">⌁</span><div><h3>Isolation sequence complete</h3><p>${esc(result.site)} · ${esc(result.symptom)} · ${esc(result.scope)}</p></div></div><button class="text-action" data-action="diagnostic-clear">Clear</button></div><div class="result-summary"><span class="result-alert" aria-hidden="true">!</span><div><strong>Likely fault domain: ${esc(result.likelyCause)}</strong><p>${esc(result.confidence)}</p></div></div><div class="check-list">${result.checks.map((check, i) => `<div class="check-row"><span class="check-index" aria-hidden="true">0${i + 1}</span><span>${esc(check[0])}</span><strong class="check-${statusClass(check[2])}"><i aria-hidden="true">${check[2] === "pass" ? "✓" : check[2] === "blocked" ? "–" : "!"}</i>${esc(check[1])}</strong></div>`).join("")}</div><div class="next-test"><b>Next discriminating test</b><p>${esc(result.nextAction)}</p></div><button class="button button-secondary full-width" data-action="diagnostic-ticket">Create handoff ticket &nbsp;→</button>`);
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
    return `<article class="change-item"><div class="change-item-top"><span class="change-id">${esc(change.id)} · ${esc(change.owner)}</span><span class="status-pill ${statusClass(change.status)}"><i></i>${esc(change.status)}</span></div><h3>${esc(change.title)}</h3><div class="change-meta"><span>▣ ${esc(change.system)}</span><span>◷ ${esc(change.window)}</span><span>Risk · <b class="risk-${statusClass(change.risk)}">${esc(change.risk)}</b></span></div>${change.findingId ? `<div class="change-impact"><b>Linked finding</b><a href="#security">${esc(change.findingId)} · View finding →</a></div>` : ""}${change.impact ? `<div class="change-impact"><b>Impact assessment</b>${esc(change.impact)}</div>` : ""}${change.validationPlan ? `<div class="change-impact"><b>Post-change validation</b>${esc(change.validationPlan)}</div>` : ""}<div class="rollback-box"><span aria-hidden="true">↶</span><div><strong>Rollback plan</strong><p>${esc(change.rollback)}</p></div></div>${readiness}<div class="change-actions">${actions}</div>${change.history?.length ? `<div class="change-history"><b>Decision log</b>${change.history.map(entry => `<span>${esc(entry)}</span>`).join("")}</div>` : ""}</article>`;
  }).join("") || `<div class="empty-state"><span>◷</span><strong>No change requests yet</strong><p>Create a request to start a review workflow.</p></div>`}</div>`)}
  </div><aside>${card(`<div class="card-header"><div><h3>Decision standard</h3><p>Evidence expected at each gate</p></div><span class="checklist-mark" aria-hidden="true">✓</span></div><div class="decision-standard"><div><b>1 · Review</b><span>Scope, impact, window, owner, and rollback.</span></div><div><b>2 · Implement</b><span>Start only within the approved window.</span></div><div><b>3 · Validate</b><span>Record a health check and user-impact result.</span></div><div><b>4 · Recover</b><span>Failed checks require documented rollback.</span></div></div>`)}${card(`<div class="approval-note"><span aria-hidden="true">ⓘ</span><p><strong>Simulation only.</strong> Approval, validation, and rollback write a local SQLite audit trail. They do not trigger infrastructure changes.</p></div>`)}</aside></div>`;
}

function render() {
  clearInterval(slaTicker);
  slaTicker = null;
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
  if (currentRoute === "helpdesk") {
    slaTicker = setInterval(refreshTicketSla, 30_000);
  }
  setPersistenceStatus(persistenceMode);
}
function refreshTicketSla() {
  if (currentRoute !== "helpdesk" || document.querySelector(".dialog-root")) return;
  for (const ticket of state.tickets) {
    const pill = document.querySelector(`[data-ticket-sla="${CSS.escape(ticket.id)}"]`);
    if (!pill) continue;
    const sla = assessTicketSla(ticket);
    pill.className = `sla-pill sla-${statusClass(sla.state)}`;
    pill.innerHTML = `<i aria-hidden="true"></i>${esc(sla.label)}`;
  }
  const overdue = state.tickets.filter(ticket => assessTicketSla(ticket).state === "Breached").length;
  const summary = document.querySelector(".sla-summary strong");
  if (summary) summary.textContent = overdue ? `${overdue} response target${overdue === 1 ? "" : "s"} breached` : "No first-response breaches";
}
function openDialog({ eyebrow = "ENGINEERING CASE", heading, description, content, submit = "Record decision", onSubmit, cancel = "Cancel" }) {
  const previousFocus = document.activeElement;
  const shell = document.querySelector(".shell");
  const wasInert = shell?.inert || false;
  const previousOverflow = document.body.style.overflow;
  const root = document.createElement("div");
  root.className = "dialog-root";
  const headingId = `dialog-${Math.random().toString(36).slice(2)}`;
  const descriptionId = `${headingId}-description`;
  root.innerHTML = `<div class="modal-backdrop"><section class="modal-card dialog-card" role="dialog" aria-modal="true" aria-labelledby="${headingId}" aria-describedby="${descriptionId}"><div class="modal-heading"><div><span class="eyebrow">${esc(eyebrow)}</span><h2 id="${headingId}">${esc(heading)}</h2><p id="${descriptionId}">${esc(description)}</p></div><button type="button" class="modal-close" data-close-dialog aria-label="Close dialog">×</button></div><form class="dialog-form">${content}<div class="modal-actions"><button type="button" class="button button-secondary" data-close-dialog>${esc(cancel)}</button><button class="button button-primary" type="submit">${esc(submit)}</button></div></form></section></div>`;
  if (shell) shell.inert = true;
  document.body.style.overflow = "hidden";
  document.body.append(root);
  const close = () => {
    root.remove();
    if (shell) shell.inert = wasInert;
    document.body.style.overflow = previousOverflow;
    const returnTarget = previousFocus?.isConnected ? previousFocus : document.querySelector("#app");
    returnTarget?.focus();
  };
  root.querySelectorAll("[data-close-dialog]").forEach(el => el.addEventListener("click", close));
  root.querySelector(".modal-backdrop").addEventListener("click", event => { if (event.target === event.currentTarget) close(); });
  const ticketStatus = root.querySelector('select[name="status"]');
  const outcomeNote = root.querySelector('textarea[name="note"]');
  const resolutionVerified = root.querySelector('input[name="resolutionVerified"]');
  if (ticketStatus && outcomeNote && resolutionVerified) {
    const applyResolutionGate = () => {
      const resolving = ticketStatus.value === "resolve";
      outcomeNote.minLength = resolving ? 20 : 8;
      resolutionVerified.required = resolving;
      resolutionVerified.setAttribute("aria-required", String(resolving));
    };
    ticketStatus.addEventListener("change", applyResolutionGate);
    applyResolutionGate();
  }
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
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
    "app-srv-02": { owner: "R. Patel", cause: "CPU saturation", action: "Scale the ERP worker pool and drain the hottest process" },
    "ap-east-14": { owner: "T. Brown", cause: "PoE supply or access-switch port", action: "Check switch PoE budget and reseat the AP uplink" },
    "core-sw-01": { owner: "R. Patel", cause: "Oversubscribed uplink queue", action: "Review top talkers and rebalance the uplink queue" }
  }[node.id] || { cause: "Resource threshold", action: "Compare the affected service with a known-good peer" };
  const causeOptions = node.id === "app-srv-02" ? ["CPU saturation", "Memory pressure", "Upstream dependency latency"] : node.id === "ap-east-14" ? ["PoE supply or access-switch port", "Radio interference", "Upstream gateway"] : ["Oversubscribed uplink queue", "Duplex mismatch", "Upstream congestion"];
  const ownerOptions = ["R. Patel", "T. Brown", "Jamie Diaz", "Security operations"];
  openDialog({ eyebrow: "INCIDENT TRIAGE · SYNTHETIC", heading: `Investigate ${node.id}`, description: `${node.name}. Signal: ${signalSummary(node)} · ${node.latency === null ? "no heartbeat" : `${node.latency} ms response`}. Assign an owner, record a likely cause, and choose a testable action.`, submit: "Record investigation", content: `<label>Incident owner<select name="owner" required><option value="">Assign an owner</option>${ownerOptions.map(owner => `<option ${owner === defaults.owner ? "selected" : ""}>${esc(owner)}</option>`).join("")}</select></label><label>Likely cause<select name="cause" required>${causeOptions.map(cause => `<option ${cause === defaults.cause ? "selected" : ""}>${esc(cause)}</option>`).join("")}</select></label><label>First action / discriminating check<input name="action" required value="${esc(defaults.action)}" maxlength="140"></label><p class="dialog-hint">A hypothesis is not a confirmed cause. Keep the alert open until a post-action check passes.</p>`, onSubmit: form => {
    const index = state.nodes.findIndex(item => item.id === node.id);
    state.nodes[index] = recordIncidentInvestigation(node, form);
    addEvent(`${node.id} assigned to ${form.owner} · ${form.cause}`);
    save(); render(); toast("Investigation recorded; verify recovery before closing the alert.");
  } });
}
function openIncidentRecovery(node) {
  openDialog({ eyebrow: "INCIDENT RECOVERY · SYNTHETIC", heading: "Record recovery check", description: `Investigation: ${node.investigation.cause}. Confirm the result that would justify closing this demo incident.`, submit: "Record passing check", content: `<label>Post-action verification<select name="verification" required><option value="">Choose a check</option>${recoveryChecks(node).map(check => `<option>${esc(check)}</option>`).join("")}</select></label><label>Evidence note<textarea name="notes" rows="3" required minlength="8" placeholder="Record the measured result and who confirmed service recovery."></textarea></label>`, onSubmit: form => {
    const index = state.nodes.findIndex(item => item.id === node.id);
    const recovered = recordIncidentRecovery(node, form);
    if (recovered === node) { toast("Select the verification for this asset and record at least eight characters of evidence."); return false; }
    state.nodes[index] = recovered;
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
    const resolved = resolveFinding(finding, form);
    if (resolved === finding) { toast("Resolution requires written evidence and explicit verification."); return false; }
    state.findings[index] = resolved;
    addEvent(`${finding.id} resolved · evidence recorded`);
    save(); render(); toast("Resolution evidence recorded.");
  } });
}
function openTicketReview(ticket) {
  const allowed = { "New": [["start", "In progress"]], "In progress": [["wait", "Waiting"], ["resolve", "Resolved"]], "Waiting": [["start", "In progress"], ["resolve", "Resolved"]], "Resolved": [["reopen", "In progress"]] }[ticket.status] || [];
  const sla = assessTicketSla(ticket);
  openDialog({ eyebrow: `SERVICE DESK · ${ticket.id}`, heading: ticket.subject, description: `${ticket.requester} · ${ticket.category} · ${ticket.priority} priority · ${sla.label}.`, submit: "Save ticket update", content: `<div class="ticket-detail-box"><b>Request context</b><p>${esc(ticket.details || "No extra detail provided.")}</p><b>Update history</b><ul>${(ticket.updates || []).map(item => `<li>${esc(item)}</li>`).join("") || "<li>Ticket created · awaiting first update</li>"}</ul></div><div class="form-row"><label>Next status<select name="status" required>${allowed.map(([action, status]) => `<option value="${action}">${status}</option>`).join("")}</select></label><label>Assignee<select name="assignee" required>${["Unassigned", "R. Patel", "T. Brown", "Jamie Diaz"].map(owner => `<option ${ticket.assignee === owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label></div><label>Work note<textarea name="note" rows="3" required minlength="8" placeholder="What was checked, changed, or communicated? For resolution, record the fix and validation outcome."></textarea></label><label class="confirm-check"><input type="checkbox" name="resolutionVerified" value="yes"><span>Requester or service owner confirmed recovery (required to resolve).</span></label>`, onSubmit: form => {
    const index = state.tickets.findIndex(item => item.id === ticket.id);
    const updated = updateTicket(ticket, { ...form, resolutionVerified: form.resolutionVerified === "yes" });
    if (updated === ticket) { toast(form.assignee === "Unassigned" ? "Assign an owner before changing the ticket status." : form.status === "resolve" ? "Resolution needs a 20-character outcome note and requester validation." : "Choose a valid next status and add an update note."); return false; }
    state.tickets[index] = updated;
    addEvent(`${ticket.id} moved to ${updated.status} · ${form.note}`);
    save(); render(); toast(`${ticket.id} updated with an audit note.`);
  } });
}
function showTicketForm(prefill = {}) {
  const values = typeof prefill === "string" ? { subject: prefill } : prefill;
  openDialog({ eyebrow: "SERVICE DESK · SYNTHETIC", heading: "Create a ticket", description: "Capture impact, assign ownership, and set a response priority.", submit: "Create ticket", content: `<label>Request summary<input name="subject" required maxlength="90" value="${esc(values.subject || "")}" placeholder="What does the requester need help with?"></label><div class="form-row"><label>Requester<input name="requester" required value="${esc(values.requester || "")}" placeholder="Name"></label><label>Category<select name="category">${["Access & accounts", "Hardware", "Network", "Software", "Other"].map(x => `<option ${values.category === x ? "selected" : ""}>${x}</option>`).join("")}</select></label></div><div class="form-row"><label>Priority<select name="priority">${["Normal", "High", "Low"].map(x => `<option ${values.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>Assign to<select name="assignee">${["Unassigned", "R. Patel", "T. Brown", "Jamie Diaz"].map(x => `<option ${values.assignee === x ? "selected" : ""}>${x}</option>`).join("")}</select></label></div><label>Impact and troubleshooting details<textarea name="details" rows="3" required minlength="8" placeholder="Who is affected, when did it start, and what has been checked?">${esc(values.details || "")}</textarea></label>`, onSubmit: form => {
    const ticket = { id: nextTicketId(state.tickets), subject: form.subject.trim(), requester: form.requester.trim(), category: form.category, priority: form.priority, status: "New", assignee: form.assignee, created: nowLabel(), createdAt: new Date().toISOString(), ageMinutes: 0, firstResponseMinutes: null, details: form.details.trim(), relatedAssetId: values.relatedAssetId || "", updates: ["Ticket created · awaiting first response"] };
    state.tickets.unshift(ticket);
    addEvent(`${ticket.id} created · ${ticket.subject}`);
    save(); render(); toast(`${ticket.id} created; first-response clock started.`);
  } });
}
function openChangeDecision(change, decision) {
  const reject = decision === "reject";
  const reviewerOptions = ["R. Patel", "T. Brown", "Jamie Diaz", "Security operations"].filter(name => name !== change.owner);
  const peerReviewer = !reject && change.risk === "High" ? `<label>Independent peer reviewer<select name="peerReviewer" required><option value="">Choose reviewer</option>${reviewerOptions.map(name => `<option>${esc(name)}</option>`).join("")}</select></label>` : "";
  openDialog({ eyebrow: `CHANGE CONTROL · ${change.id}`, heading: reject ? "Reject this request" : "Approve after readiness review", description: `${change.title} · ${change.risk} risk · ${change.window}. ${reject ? "Record the reason so the requester can revise the plan." : "Confirm why the plan is acceptable and its control evidence."}`, submit: reject ? "Record rejection" : "Record approval", content: `${peerReviewer}<label>${reject ? "Rejection reason" : "Approval rationale"}<textarea name="note" rows="3" required minlength="12" placeholder="Summarize impact, controls, and decision basis."></textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    if (!reject && change.risk === "High" && (!form.peerReviewer || form.peerReviewer === change.owner)) { toast("High-risk approval needs an independent reviewer who is not the change owner."); return false; }
    const updated = maintenanceAction(change, decision, { peerReviewer: form.peerReviewer, evidence: form.note });
    if (updated === change) { toast("Approval is locked until all required readiness checks are complete."); return false; }
    const reviewerRecord = form.peerReviewer ? ` · Peer review by ${form.peerReviewer}` : "";
    updated.history = [...(change.history || []), `${nowLabel()} · ${reject ? "Rejected" : "Approved"} by Jamie Diaz${reviewerRecord} · ${form.note.trim()}`];
    state.maintenance[index] = updated;
    addEvent(`${change.id} ${reject ? "rejected" : "approved"} · ${form.note.trim()}`);
    save(); render(); toast(`Change ${reject ? "rejection" : "approval"} recorded.`);
  } });
}
function openValidationDecision(change) {
  openDialog({ eyebrow: `CHANGE VALIDATION · ${change.id}`, heading: "Record post-change checks", description: `Implemented: ${change.title}. Record the measured outcome. A failed check routes the request to rollback.`, submit: "Record validation result", content: `<label>Validation outcome<select name="outcome" required><option value="">Choose result</option><option value="passed">Passed · service health within expected range</option><option value="failed">Failed · service impact or threshold breach remains</option></select></label><label>Evidence / observation<textarea name="note" rows="3" required minlength="12" placeholder="Health check result, user impact, and comparison with baseline."></textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    const action = form.outcome;
    const updated = maintenanceAction(change, action, { evidence: form.note });
    if (updated === change) { toast("This request is not ready for a validation outcome."); return false; }
    updated.history = [...(change.history || []), `${nowLabel()} · Validation ${action} · ${form.note.trim()}`];
    updated.validationEvidence = form.note.trim();
    state.maintenance[index] = updated;
    addEvent(`${change.id} validation ${action} · ${form.note.trim()}`);
    save(); render(); toast(action === "passed" ? "Change closed after a passing check." : "Rollback required after failed validation.");
  } });
}
function openChangeStart(change) {
  openDialog({ eyebrow: `IMPLEMENTATION WINDOW · ${change.id}`, heading: "Confirm the maintenance window", description: `${change.title} · approved window: ${change.window}. This simulation records an implementation start only after the operator confirms the window is open and stakeholders are ready.`, submit: "Confirm window and start", content: `<label class="confirm-check"><input type="checkbox" name="windowOpen" value="yes" required><span>I confirm the approved maintenance window is open and required notifications are complete.</span></label><label>Pre-change checkpoint<textarea name="note" rows="3" required minlength="12" placeholder="Record the last pre-change health check and service baseline."></textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    const updated = maintenanceAction(change, "start", { windowOpenConfirmed: form.windowOpen === "yes", evidence: form.note });
    if (updated === change) { toast("Confirm the approved window before starting implementation."); return false; }
    updated.history = [...(change.history || []), `${nowLabel()} · Implementation started in approved window · ${form.note.trim()}`];
    updated.preChangeEvidence = form.note.trim();
    state.maintenance[index] = updated;
    addEvent(`${change.id} implementation started · window and baseline confirmed`);
    save(); render(); toast("Implementation start recorded with the pre-change checkpoint.");
  } });
}
function openRollback(change) {
  openDialog({ eyebrow: `RECOVERY · ${change.id}`, heading: "Execute documented rollback", description: `Rollback plan: ${change.rollback}. Record the recovery action and service check.`, submit: "Record rollback", content: `<label>Rollback evidence<textarea name="note" rows="3" required minlength="12" placeholder="What was reverted and which service check passed?">${esc(change.rollback)}</textarea></label>`, onSubmit: form => {
    const index = state.maintenance.findIndex(item => item.id === change.id);
    const updated = maintenanceAction(change, "rollback", { evidence: form.note });
    if (updated === change) return false;
    updated.history = [...(change.history || []), `${nowLabel()} · Rollback executed · ${form.note.trim()}`];
    updated.rollbackEvidence = form.note.trim();
    state.maintenance[index] = updated;
    addEvent(`${change.id} rollback recorded · recovery check documented`);
    save(); render(); toast("Rollback decision and recovery evidence recorded.");
  } });
}
function showChangeForm(prefill = {}) {
  const systems = ["Application server · ERP", "Primary database · Finance", "Core switch · North campus", "Edge firewall · HQ"];
  const owners = ["R. Patel", "T. Brown", "Jamie Diaz", "Security operations"];
  openDialog({ eyebrow: prefill.findingId ? `SECURITY HANDOFF · ${prefill.findingId}` : "CHANGE CONTROL · SYNTHETIC", heading: "New change request", description: "Define ownership, agreed window, impact, validation, and a workable recovery path.", submit: "Submit for readiness review", content: `<label>Change title<input name="title" required maxlength="90" value="${esc(prefill.title || "")}" placeholder="e.g. Apply monthly security updates"></label><div class="form-row"><label>System<select name="system">${systems.map(system => `<option ${prefill.system === system ? "selected" : ""}>${esc(system)}</option>`).join("")}</select></label><label>Change owner<select name="owner" required><option value="">Assign owner</option>${owners.map(owner => `<option ${prefill.owner === owner ? "selected" : ""}>${esc(owner)}</option>`).join("")}</select></label></div><div class="form-row"><label>Maintenance window<input name="window" required value="${esc(prefill.window || "")}" placeholder="e.g. Friday · 22:00–23:00"></label><label>Risk level<select name="risk">${["Low", "Medium", "High"].map(risk => `<option ${prefill.risk === risk || (!prefill.risk && risk === "Medium") ? "selected" : ""}>${risk}</option>`).join("")}</select></label></div><label>Service impact assessment<textarea name="impact" rows="2" required minlength="12" placeholder="Affected users, expected impact, and communication plan.">${esc(prefill.impact || "")}</textarea></label><label>Post-change validation plan<textarea name="validationPlan" rows="2" required minlength="12" placeholder="Health check, baseline comparison, and user confirmation.">${esc(prefill.validationPlan || "")}</textarea></label><label>Rollback plan<textarea name="rollback" rows="3" required minlength="12" placeholder="Pre-change state, restore steps, owner, and recovery validation.">${esc(prefill.rollback || "")}</textarea></label><label class="confirm-check"><input type="checkbox" name="windowConfirmed" value="yes" required><span>I confirmed this maintenance window with the service owner.</span></label>`, onSubmit: form => {
    const next = Math.max(208, ...state.maintenance.map(change => Number(change.id.split("-")[1]) || 208)) + 1;
    const change = { id: `CHG-${next}`, title: form.title.trim(), system: form.system, window: form.window.trim(), risk: form.risk, status: "Pending approval", owner: form.owner, rollback: form.rollback.trim(), impact: form.impact.trim(), validationPlan: form.validationPlan.trim(), findingId: prefill.findingId || "", readiness: { scopeOwner: true, windowConfirmed: form.windowConfirmed === "yes", impactAssessed: true, rollbackDocumented: true, validationReady: true }, history: [`${nowLabel()} · Request submitted by ${form.owner}${prefill.findingId ? ` · linked to ${prefill.findingId}` : ""} · readiness review required`] };
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
    } else if (action === "health-ticket") {
      const node = state.nodes.find(item => item.id === id);
      if (node?.health !== "Healthy") {
        const investigation = node.investigation ? `Recorded hypothesis owner: ${node.investigation.owner}. Cause: ${node.investigation.cause}. First action: ${node.investigation.action}.` : "No cause has been confirmed yet; begin with the next discriminating check.";
        const prefill = { subject: `Infrastructure alert · ${node.name}`, requester: "ICT Operations", category: node.type === "Network" || node.type === "Access point" ? "Network" : "Software", priority: "High", details: `Synthetic monitor alert for ${node.id}. Status: ${node.health}. Signal: ${signalSummary(node)}. ${investigation} Keep the alert open until a post-action service check passes.`, relatedAssetId: node.id };
        location.hash = "#helpdesk";
        setTimeout(() => showTicketForm(prefill), 30);
      }
    } else if (action === "finding-triage") {
      const finding = state.findings.find(item => item.id === id); if (finding) openFindingTriage(finding);
    } else if (action === "finding-resolve") {
      const finding = state.findings.find(item => item.id === id); if (finding) openFindingResolution(finding);
    } else if (action === "finding-change") {
      const finding = state.findings.find(item => item.id === id);
      if (finding?.id === "SEC-2418" && finding.status === "Investigating") {
        const prefill = { findingId: finding.id, title: `Patch remediation · ${finding.title}`, system: "Application server · ERP", owner: finding.owner, risk: "High", impact: `${finding.impact}. ${finding.exposure}. Coordinate the restart window with Finance.`, validationPlan: "Confirm the kernel package version, ERP sign-in, host response time, and queue depth after restart.", rollback: "Restore the pre-change VM snapshot, revert the package set, then verify ERP sign-in and host response time." };
        location.hash = "#maintenance";
        setTimeout(() => showChangeForm(prefill), 30);
      }
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
      const change = state.maintenance.find(item => item.id === id); if (change) openChangeStart(change);
    } else if (action === "change-validation") {
      const change = state.maintenance.find(item => item.id === id); if (change) openValidationDecision(change);
    } else if (action === "change-rollback") {
      const change = state.maintenance.find(item => item.id === id); if (change) openRollback(change);
    }
  };
  app.onchange = event => {
    const input = event.target.closest('[data-action="change-check"]');
    if (!input) return;
    const change = state.maintenance.find(item => item.id === input.dataset.id);
    if (!change || change.status !== "Pending approval") return;
    change.readiness[input.dataset.key] = input.checked;
    const changedKey = input.dataset.key;
    const changedId = input.dataset.id;
    addEvent(`${change.id} readiness updated · ${input.dataset.key} ${input.checked ? "confirmed" : "cleared"}`);
    if (!save()) toast("Readiness updated only for this session.");
    render();
    [...document.querySelectorAll('[data-action="change-check"]')].find(item => item.dataset.id === changedId && item.dataset.key === changedKey)?.focus();
  };
  const diagnosticForm = document.querySelector("#diagnosticForm");
  if (diagnosticForm) {
    diagnosticForm.addEventListener("change", () => {
      networkInputs = Object.fromEntries(new FormData(diagnosticForm));
      if (!networkResult) return;
      networkResult = null;
      document.querySelector("#diagnosticResults").innerHTML = diagnosticPlaceholder(true);
    });
    diagnosticForm.onsubmit = event => {
      event.preventDefault();
      networkInputs = Object.fromEntries(new FormData(diagnosticForm));
      networkResult = diagnoseNetwork(networkInputs);
      render();
    };
  }
  const severity = document.querySelector("#severityFilter"), findingStatus = document.querySelector("#findingStatusFilter");
  const applyFindings = () => {
    let visible = 0;
    document.querySelectorAll(".finding-row").forEach(row => {
      const severityMatches = !severity || severity.value === "All" || row.dataset.severity === severity.value;
      const statusMatches = !findingStatus || findingStatus.value === "All" || (findingStatus.value === "Active" && row.dataset.status !== "Resolved") || row.dataset.status === findingStatus.value;
      row.hidden = !(severityMatches && statusMatches);
      if (!row.hidden) visible++;
    });
    const empty = document.querySelector("#findingFilterEmpty");
    if (empty) empty.hidden = visible > 0;
  };
  severity?.addEventListener("change", applyFindings);
  findingStatus?.addEventListener("change", applyFindings);
  applyFindings();
  const ticketFilter = document.querySelector("#ticketFilter");
  const applyTickets = () => {
    if (!ticketFilter) return;
    let visible = 0;
    document.querySelectorAll("[data-ticket-status]").forEach(row => {
      row.hidden = !((ticketFilter.value === "All") || (ticketFilter.value === "Active" && row.dataset.ticketStatus !== "Resolved") || row.dataset.ticketStatus === ticketFilter.value);
      if (!row.hidden) visible++;
    });
    const empty = document.querySelector("#ticketFilterEmpty");
    if (empty) empty.hidden = visible > 0;
  };
  ticketFilter?.addEventListener("change", applyTickets);
  applyTickets();
  document.querySelectorAll(".table-wrap[tabindex='0']").forEach(region => region.addEventListener("keydown", event => {
    if (event.target !== region || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    region.scrollLeft += (event.key === "ArrowRight" ? 1 : -1) * Math.max(40, Math.round(region.clientWidth * 0.35));
  }));
}
function reset() {
  state = cloneSeed(); networkResult = null; networkInputs = { site: "North campus", symptom: "Slow connection", scope: "Single room" }; save(); render(); toast("Synthetic casebook restored to its starting state.");
}
window.addEventListener("hashchange", () => {
  if (!appReady) return;
  if (currentRoute !== "network") networkResult = null;
  render();
  app.querySelector("h1")?.focus();
});
document.querySelector("#downloadConflict")?.addEventListener("click", downloadConflictBackup);
document.querySelector("#reloadShared")?.addEventListener("click", useServerCopy);
document.querySelector("#retrySync")?.addEventListener("click", retryBackendSync);
initializeApp();
