const $ = (id) => document.getElementById(id);
let currentProject = null;
let ws = null;

function setStatus(msg, bad) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = bad ? "var(--bad)" : "var(--muted)";
}

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    setStatus((data && data.error) || res.statusText, true);
    throw new Error((data && data.error) || res.statusText);
  }
  setStatus(method + " " + path + " ok");
  return data;
}

function memberRow(name = "", role = "fullstack", skills = "") {
  const div = document.createElement("div");
  div.className = "member";
  div.innerHTML = `
    <input class="m-name" placeholder="Name" value="${esc(name)}" />
    <select class="role">
      ${["frontend", "backend", "devops", "fullstack"]
        .map((r) => `<option ${r === role ? "selected" : ""}>${r}</option>`)
        .join("")}
    </select>
    <input class="m-skills" placeholder="Skills (comma sep)" value="${esc(skills)}" />`;
  return div;
}

function readTeam() {
  return [...document.querySelectorAll("#members .member")]
    .map((row) => ({
      name: row.querySelector(".m-name").value.trim(),
      role: row.querySelector(".role").value,
      skills: row.querySelector(".m-skills").value.split(",").map((s) => s.trim()).filter(Boolean),
    }))
    .filter((m) => m.name);
}

async function loadProjects() {
  const projects = await api("GET", "/projects");
  const sel = $("projectSel");
  sel.innerHTML = `<option value="">— Select —</option>`;
  for (const p of projects) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.name} (${p.status})`;
    sel.appendChild(o);
  }
  if (currentProject) sel.value = currentProject;
}

async function createProject() {
  const body = { name: $("pName").value, description: $("pDesc").value, team: readTeam() };
  if (!body.name.trim()) return setStatus("Project name required", true);
  const p = await api("POST", "/projects", body);
  await loadProjects();
  selectProject(p.id);
  $("setupHint").textContent = `Created "${p.name}". Click "Plan with Claude" to generate the roadmap.`;
}

async function decompose() {
  if (!currentProject) return setStatus("Select or create a project first", true);
  setStatus("Planning via Claude… (needs ANTHROPIC_API_KEY)");
  $("decomposeBtn").disabled = true;
  try {
    await api("PUT", `/projects/${currentProject}/decompose`);
    await refresh();
  } finally {
    $("decomposeBtn").disabled = false;
  }
}

function selectProject(id) {
  currentProject = id || null;
  $("projectSel").value = id || "";
  if (currentProject) {
    connectWs(currentProject);
    refresh();
  }
}

let teamById = {};

async function refresh() {
  if (!currentProject) return;
  const state = await api("GET", `/projects/${currentProject}`);
  teamById = Object.fromEntries(state.project.team.map((m) => [m.id, m]));
  renderTree(state);
  renderKanban(state.tasks);
  renderEditing(state.locks, state.sessions);
  renderDecisions(state.deltas, state.debates);
}

const who = (id) => (teamById[id] ? teamById[id].name : id ? id.slice(0, 8) : "unassigned");

function renderTree(state) {
  const el = $("tree");
  if (!state.phases.length) {
    el.innerHTML = '<span class="empty">No roadmap yet — run "Plan with Claude"</span>';
    return;
  }
  const titleById = Object.fromEntries(state.tasks.map((t) => [t.id, t.title]));
  el.innerHTML = state.phases.map((ph, pi) => {
    const tasks = state.tasks.filter((t) => t.phaseId === ph.id);
    const mp = ph.mergePoint && ph.mergePoint.reached
      ? '<span class="badge ok">Merge point reached</span>'
      : ph.contractsLocked ? '<span class="badge warn">Contracts locked</span>' : "";
    return `
      <div class="phase" style="animation-delay:${pi * 0.08}s">
        <div class="phase-head"><span class="phase-dot"></span>${esc(ph.name)} ${mp}</div>
        <div class="phase-body">
          ${tasks.map((t, ti) => `
            <div class="node" style="animation-delay:${(pi * 0.08) + (ti * 0.05) + 0.1}s">
              <div class="t">${esc(t.title)} <span class="badge">${t.status.replace("_", " ")}</span></div>
              <div class="meta">
                ${t.assigneeId ? `→ ${esc(who(t.assigneeId))}` : "Unassigned"}
                ${t.dependencies.length ? ` · <span class="deps">depends on: ${t.dependencies.map((d) => esc(titleById[d] || d)).join(", ")}</span>` : ""}
                ${t.interfaceContracts.length ? ` · ${t.interfaceContracts.length} contract(s)` : ""}
              </div>
            </div>`).join("")}
        </div>
      </div>`;
  }).join("");
}

const COLS = [["todo", "To Do"], ["in_progress", "In Progress"], ["review", "Review"], ["merge_point", "Merge Point"], ["done", "Done"]];

function renderKanban(tasks) {
  const container = $("kanban");
  container.innerHTML = COLS.map(([key, label]) => {
    const items = tasks.filter((t) => t.status === key);
    return `
      <div class="col">
        <h3>${label}</h3>
        ${items.map((t, i) => `
          <div class="card" style="animation-delay:${i * 0.04}s">
            <div>${esc(t.title)}</div>
            <div class="who">${esc(who(t.assigneeId))}</div>
          </div>`).join("") || '<span class="empty"></span>'}
      </div>`;
  }).join("");
}

function renderEditing(locks, sessions) {
  const online = sessions.map((s) => who(s.memberId) || s.id).join(", ");
  const editing = locks.map((l) =>
    `${esc(who(l.lockedBy) || l.lockedBy)} → ${esc(l.path)}${l.lineStart != null ? `:${l.lineStart}-${l.lineEnd ?? l.lineStart}` : ""}`
  );
  $("editing").innerHTML =
    (sessions.length ? `Online: ${esc(online)}` : "") +
    (editing.length ? ` · Editing: ${editing.join("; ")}` : "");
}

function renderDecisions(deltas, debates) {
  const el = $("decisions");
  const items = [];

  for (const d of deltas) {
    items.push({
      ts: d.timestamp,
      html: `
        <div class="decision ${d.type}">
          <div class="h"><span class="who">${esc(who(d.sourceSessionId) || d.sourceSessionId)}</span>
            <span class="badge">${d.type.replace("_", " ")}</span>
            <span class="badge ${d.severity === "blocking" ? "bad" : d.severity === "warning" ? "warn" : ""}">${d.severity}</span>
            ${d.conflictsWith.length ? `<span class="badge bad">Conflicts: ${d.conflictsWith.length}</span>` : ""}
            ${d.acknowledgedBy.length ? `<span class="badge ok">Ack ${d.acknowledgedBy.length}</span>` : ""}
          </div>
          <div class="body">${esc(d.content)}</div>
          <div class="when">${fmt(d.timestamp)}</div>
        </div>`,
    });
  }

  for (const db of debates) {
    const status = db.status === "resolved" ? "ok" : db.status === "escalated" ? "bad" : "warn";
    items.push({
      ts: db.createdAt,
      html: `
        <div class="debate">
          <div class="h"><strong>${esc(db.topic)}</strong>
            <span class="badge ${status}">${db.status} · Round ${db.round}</span></div>
          ${db.messages.map((m) => `<div class="msg"><span class="s">${esc(who(m.sessionId) || m.sessionId)}:</span> ${esc(m.message)}</div>`).join("")}
          ${db.proposedResolution ? `<div class="msg"><span class="badge ok">Resolution</span> ${esc(db.proposedResolution)}</div>` : ""}
        </div>`,
    });
  }

  if (!items.length) {
    el.innerHTML = '<span class="empty">No agent activity yet — agents push context deltas and open debates via MCP as they work</span>';
    return;
  }
  items.sort((a, b) => b.ts.localeCompare(a.ts));
  el.innerHTML = items.map((i) => i.html).join("");
  const decisionEls = el.querySelectorAll(".decision, .debate");
  decisionEls.forEach((el, i) => {
    el.style.animationDelay = `${i * 0.05}s`;
  });
}

function connectWs(projectId) {
  if (ws) ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?projectId=${projectId}`);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    const feed = $("feed");
    const div = document.createElement("div");
    div.className = "e";
    div.textContent = `${fmt(e.ts || new Date().toISOString())} · ${e.event}`;
    feed.prepend(div);
    if (["task_update", "lock_changed", "delta_received", "debate_update", "sync_complete", "presence"].includes(e.event)) {
      refresh();
    }
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmt(iso) {
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

$("addMember").onclick = () => $("members").appendChild(memberRow());
$("createBtn").onclick = createProject;
$("decomposeBtn").onclick = decompose;
$("refreshBtn").onclick = refresh;
$("projectSel").onchange = (e) => selectProject(e.target.value);

$("members").appendChild(memberRow("Alice", "backend", "node, postgres"));
$("members").appendChild(memberRow("Bob", "frontend", "react"));
loadProjects().catch((e) => setStatus(e.message, true));
