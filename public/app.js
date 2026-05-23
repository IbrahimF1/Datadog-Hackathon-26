const $ = (id) => document.getElementById(id);
const sessionId = () => $("sessionId").value.trim() || "anon";
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
    headers: { "Content-Type": "application/json", "x-session-id": sessionId() },
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

// ---- projects ----
async function loadProjects() {
  const projects = await api("GET", "/projects");
  const sel = $("projectSel");
  sel.innerHTML = "";
  for (const p of projects) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.name} (${p.status})`;
    sel.appendChild(o);
  }
  if (projects.length && !currentProject) selectProject(projects[0].id);
}

function parseTeam(str) {
  return str
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, role, skills] = entry.split(":");
      return {
        name: (name || "").trim(),
        role: (role || "fullstack").trim(),
        skills: (skills || "").split(",").map((s) => s.trim()).filter(Boolean),
      };
    });
}

async function createProject() {
  const body = {
    name: $("pName").value,
    description: $("pDesc").value,
    team: parseTeam($("pTeam").value),
  };
  const p = await api("POST", "/projects", body);
  await loadProjects();
  selectProject(p.id);
}

async function decompose() {
  if (!currentProject) return;
  setStatus("decomposing via Claude… (needs ANTHROPIC_API_KEY)");
  await api("PUT", `/projects/${currentProject}/decompose`);
  await selectProject(currentProject);
}

function selectProject(id) {
  currentProject = id;
  $("projectSel").value = id;
  connectWs(id);
  return refresh();
}

async function refresh() {
  if (!currentProject) return;
  const state = await api("GET", `/projects/${currentProject}`);
  renderRoadmap(state);
  renderKanban(state.tasks);
  renderLocks(state.locks);
  renderDeltas(state.deltas);
  renderDebates(state.debates);
  renderQuestions(state.project);
}

// ---- renderers ----
function renderQuestions(project) {
  const el = $("questions");
  const qs = (project.questions || []).filter((q) => !q.answer);
  if (!qs.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<h2 style="margin-top:12px">Planning questions</h2>` +
    qs.map((q) => `<div class="card">${esc(q.question)}</div>`).join("");
}

function renderRoadmap(state) {
  const el = $("roadmap");
  if (!state.phases.length) { el.innerHTML = '<span class="muted">no phases — run decompose</span>'; return; }
  const tasksByPhase = (pid) => state.tasks.filter((t) => t.phaseId === pid);
  el.innerHTML = state.phases.map((ph) => `
    <div class="phase">
      <strong>${esc(ph.name)}</strong>
      ${ph.mergePoint && ph.mergePoint.reached ? '<span class="tag" style="color:var(--ok)">merge point reached</span>' : ph.contractsLocked ? '<span class="tag" style="color:var(--warn)">contracts locked</span>' : ""}
      ${tasksByPhase(ph.id).map((t) => `<div class="card">${esc(t.title)} <span class="tag">${t.status}</span></div>`).join("")}
    </div>`).join("");
}

const COLS = ["todo", "in_progress", "review", "merge_point", "done"];
function renderKanban(tasks) {
  $("kanban").innerHTML = COLS.map((c) => `
    <div class="col"><h3>${c.replace("_", " ")}</h3>
      ${tasks.filter((t) => t.status === c).map((t) => `
        <div class="card">
          <div>${esc(t.title)}</div>
          <a class="link" onclick="advance('${t.id}','${c}')">advance →</a>
        </div>`).join("")}
    </div>`).join("");
}

window.advance = async (taskId, from) => {
  const next = COLS[Math.min(COLS.indexOf(from) + 1, COLS.length - 1)];
  await api("PUT", `/projects/${currentProject}/tasks/${taskId}/status`, { status: next });
  refresh();
};

function renderLocks(locks) {
  const el = $("locks");
  if (!locks.length) { el.innerHTML = '<span class="muted">no locks</span>'; return; }
  el.innerHTML = locks.map((l) => `
    <div class="lock">
      <span class="a">${esc(l.path)}${l.lineStart != null ? `:${l.lineStart}-${l.lineEnd ?? l.lineStart}` : ""}</span>
      <span class="tag">${esc(l.lockedBy)}</span>
      <a class="link" onclick="releaseLock('${l.lockId}')">release</a>
    </div>`).join("");
}

window.releaseLock = async (lockId) => {
  await api("DELETE", `/projects/${currentProject}/tasks/x/lock`, { lockId });
  refresh();
};

function renderDeltas(deltas) {
  const el = $("deltas");
  if (!deltas.length) { el.innerHTML = '<span class="muted">no deltas</span>'; return; }
  el.innerHTML = deltas.slice().reverse().map((d) => `
    <div class="delta ${d.severity === "blocking" ? "blocking" : ""}">
      <span class="tag">${d.type}</span> <span class="tag">${d.severity}</span>
      ${d.conflictsWith.length ? `<span class="tag" style="color:var(--bad)">conflicts: ${d.conflictsWith.length}</span>` : ""}
      <div>${esc(d.content)}</div>
      <div class="muted">${esc(d.sourceSessionId)} · ${shortId(d.id)}
        <a class="link" onclick="ackDelta('${d.id}')">ack</a></div>
    </div>`).join("");
}

window.ackDelta = async (deltaId) => {
  await api("POST", `/mcp/context/${currentProject}/${deltaId}/ack`);
  refresh();
};

function renderDebates(debates) {
  const el = $("debates");
  if (!debates.length) { el.innerHTML = '<span class="muted">no debates</span>'; return; }
  el.innerHTML = debates.map((d) => `
    <div class="debate">
      <span class="tag">${d.status}</span> round ${d.round} · ${esc(d.topic)}
      <div class="muted">${shortId(d.id)}</div>
      ${d.status === "active" ? `
        <div class="row" style="margin-top:4px">
          <input id="resp_${d.id}" placeholder="response" />
          <button onclick="respond('${d.id}')">reply</button>
          <button onclick="respond('${d.id}', true)">resolve</button>
        </div>` : ""}
    </div>`).join("");
}

window.respond = async (debateId, resolve) => {
  const msg = $(`resp_${debateId}`).value || (resolve ? "I agree, let's resolve." : "...");
  await api("POST", "/mcp/debate", {
    action: "respond", projectId: currentProject, debateId,
    message: msg, proposeResolution: !!resolve,
  });
  refresh();
};

// ---- actions ----
async function acquireLock() {
  const body = {
    path: $("lockPath").value,
    lineStart: $("lockStart").value ? Number($("lockStart").value) : undefined,
    lineEnd: $("lockEnd").value ? Number($("lockEnd").value) : undefined,
    reason: $("lockReason").value,
  };
  await api("PUT", `/projects/${currentProject}/tasks/x/lock`, body);
  refresh();
}

async function pushDelta() {
  await api("POST", "/mcp/context", {
    projectId: currentProject,
    type: $("deltaType").value,
    severity: $("deltaSev").value,
    content: $("deltaContent").value,
  });
  $("deltaContent").value = "";
  refresh();
}

async function startDebate() {
  await api("POST", "/mcp/debate", {
    projectId: currentProject,
    position: $("debatePos").value,
    conflictingDeltaId: $("debateDelta").value || undefined,
    constraints: [], proposedAlternatives: [],
  });
  refresh();
}

async function syncStart() {
  const out = await api("POST", `/projects/${currentProject}/sync`, { action: "start" });
  $("syncOut").innerHTML = `<pre>${esc(JSON.stringify(out, null, 2))}</pre>`;
}
async function syncDone() {
  const out = await api("POST", `/projects/${currentProject}/sync`, {
    action: "complete", commitSha: $("syncSha").value || ("sha-" + Date.now()),
  });
  $("syncOut").innerHTML = `<pre>${esc(JSON.stringify(out, null, 2))}</pre>`;
  refresh();
}

// ---- websocket ----
function connectWs(projectId) {
  if (ws) ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?projectId=${projectId}`);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    const feed = $("feed");
    const div = document.createElement("div");
    div.className = "e";
    div.innerHTML = `<span class="tag">${e.event}</span> ${esc(JSON.stringify(e.payload || {}).slice(0, 160))}`;
    feed.prepend(div);
    if (["task_update", "lock_changed", "delta_received", "debate_update", "sync_complete"].includes(e.event)) {
      refresh();
    }
  };
}

// ---- utils ----
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function shortId(s) { return String(s).slice(0, 14); }

// ---- wire up ----
$("refreshBtn").onclick = refresh;
$("createBtn").onclick = createProject;
$("decomposeBtn").onclick = decompose;
$("projectSel").onchange = (e) => selectProject(e.target.value);
$("lockBtn").onclick = acquireLock;
$("deltaBtn").onclick = pushDelta;
$("debateBtn").onclick = startDebate;
$("syncStart").onclick = syncStart;
$("syncDone").onclick = syncDone;

loadProjects().catch((e) => setStatus(e.message, true));
