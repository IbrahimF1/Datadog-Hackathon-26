# PeerCode Coordination Server — Design Spec

Date: 2026-05-23
Status: Approved for planning
Scope: Build the PeerCode server completely, plus a very simple static UI to exercise it end-to-end.

---

## 1. Goal

A central TypeScript/Node coordination server that lets multiple Claude Code sessions
work in parallel on one project while keeping context in sync. It exposes three transports
over one process — a REST API (for the web UI), a WebSocket server (live notifications),
and an MCP server over HTTP streamable transport (for Claude Code sessions) — all backed by
one shared service layer.

This spec covers the server and a minimal static test UI. The full Next.js dual-pane UI is
deferred.

---

## 2. Hard requirements (must use)

- **TypeScript + Node/Express** — single codebase for REST + WS + MCP.
- **ClickHouse** — durable, queryable, append-only store for context deltas, debate messages,
  the WebSocket event log, and the audit trail. Used for its sweet spot (append-heavy data),
  NOT for mutable coordination state.
- **Datadog LLM Observability ("LapDog")** — instrument the agent and server with `dd-trace`
  + `llmobs`. Build the agent AND observe it.
- **Nimble (agent web search)** — ground LLM reasoning with live web data. Replaces context7's
  role. context7 is used NOWHERE. Nimble is scoped to exactly two flows: planning and debates.
- **Real Anthropic API** — planning/decomposition (server-side, key from env).
- **MCP over HTTP streamable transport** — multiple remote Claude sessions connect to one
  central server.

---

## 3. Architecture

```
┌──────────────────── Express app (single Node process) ──────────────────┐
│                                                                          │
│  REST API          WebSocket server         MCP server (HTTP streamable) │
│  (web UI)          (live notifications)      (Claude Code sessions)      │
│       └─────────────────┬────────────────────────────┘                  │
│                         ▼                                                │
│              Domain / Service layer                                      │
│   Project · Task · Lock · Delta · Debate · Planning · SyncCoordination · │
│   Presence · EventBus · Sweeper                                          │
│       ┌─────────────────┴───────────────┐                               │
│       ▼                                 ▼                                │
│  LiveStore (in-memory)            StreamStore (ClickHouse)               │
│  projects, tasks, locks,          context_deltas, debate_messages,      │
│  presence, active debates,        events, audit                          │
│  sessions, sync token                                                    │
│                                                                          │
│  Integrations:  AnthropicClient · NimbleClient · (optional read-only     │
│                 GitHubClient) · Datadog llmobs                           │
└──────────────────────────────────────────────────────────────────────────┘
```

Principles:
- No business logic in routes / WS handlers / MCP tool handlers — they are thin adapters over
  the service layer.
- Services depend on storage **interfaces** (`LiveStore`, `StreamStore`), so the in-memory live
  store can later move to SQLite/Postgres without touching logic.
- The **EventBus** is the spine: every domain mutation emits an event, fanned out to (a) WebSocket
  subscribers and (b) the ClickHouse `events` table.

---

## 4. Storage split

### 4.1 LiveStore (in-memory, behind `LiveStore` interface)
Mutable coordination state — fast and transactional-enough for lock correctness; resets on restart.
- projects, phases, tasks
- file locks
- presence / sessions
- current state of active debates
- the global sync token (who is currently syncing)

### 4.2 StreamStore (ClickHouse, behind `StreamStore` interface)
Append-only history — durable + queryable. Tables use `MergeTree` ordered by `(project_id, ts)`:
- `context_deltas` — every pushed delta
- `debate_messages` — every debate message
- `events` — every domain event mirrored from the EventBus
- `audit` — security-relevant actions (lock ops, sync ops, session register)

Schema is created on startup if absent (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## 5. Domain types

Implements TECH_SPEC §2 verbatim where possible: `Project`, `TeamMember`, `Phase`, `Task`,
`FileLock`, `Contract`, `ContextDelta`, `Debate`, `DebateMessage`, plus:
- `Session { id, memberId, projectId, connectedAt, lastSeen }`
- `SyncRecord { sessionId, commitSha, syncedAt }`
- `MergePointState { phaseId, reached, syncedSessionIds[], headSha? }`

Task status enum: `todo | in_progress | review | merge_point | done`.

---

## 6. Transports

### 6.1 REST API (for web UI)
All endpoints from TECH_SPEC §2:
```
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id/decompose
POST   /api/projects/:id/team
GET    /api/projects/:id/team/:memberId/questions
POST   /api/projects/:id/team/:memberId/answers
GET    /api/projects/:id/tasks
PUT    /api/projects/:id/tasks/:taskId/assign
PUT    /api/projects/:id/tasks/:taskId/status
PUT    /api/projects/:id/tasks/:taskId/lock
DELETE /api/projects/:id/tasks/:taskId/lock
POST   /api/mcp/context           (push delta — also a REST entry for the UI)
GET    /api/mcp/context/:projectId
POST   /api/mcp/debate
GET    /api/mcp/debate/:debateId
POST   /api/projects/:id/sync
GET    /api/projects/:id/conflicts
POST   /api/projects/:id/conflicts/:conflictId/resolve
```

### 6.2 WebSocket server
Clients subscribe per `projectId`. Broadcasts the 5 event types from TECH_SPEC §9:
`delta_received`, `lock_changed`, `debate_update`, `sync_complete`, `task_update`.

### 6.3 MCP server (HTTP streamable)
12 tools. Each call carries a `sessionId` (the calling Claude session). Tools are thin wrappers
over services and are each wrapped in a Datadog agent-action span.

| Tool | Service |
|------|---------|
| `peercode_get_project` | ProjectService |
| `peercode_lock_file` | LockService |
| `peercode_release_lock` | LockService |
| `peercode_heartbeat` | LockService (extend lock TTL) |
| `peercode_push_delta` | DeltaService |
| `peercode_get_deltas` | DeltaService |
| `peercode_ack_delta` | DeltaService |
| `peercode_start_debate` | DebateService |
| `peercode_respond_debate` | DebateService |
| `peercode_get_debate` | DebateService |
| `peercode_sync_github` | SyncCoordinationService |
| `peercode_web_search` | NimbleClient (debate/planning use only — enforced by skill docs) |

(12 tools total: 11 coordination tools + `peercode_web_search`. Beyond TECH_SPEC §4's original 10,
this adds `peercode_heartbeat` for the 5-min heartbeat in §5 and `peercode_web_search` for Nimble.)

---

## 7. Lock semantics (concurrency core)

A lock: `{ lockId, projectId, path, lineStart?, lineEnd?, lockedBy (sessionId), lockedAt, expiresAt }`.

- **Granularity:** file (no lines), section (`lineStart..lineEnd`), line (`n..n`).
- **Hierarchical blocking on acquire — reject if:**
  - a file-level lock exists on the path, OR
  - the new lock is file-level and any lock exists on the path, OR
  - the requested line range overlaps an existing section/line lock on the path.
  - Rejection returns the holder's `sessionId` so the caller can wait / request release / debate.
- **Auto-expiry:** `expiresAt = now + LOCK_TTL` (30 min). Sweeper removes expired locks and emits
  `lock_changed`.
- **Heartbeat:** `peercode_heartbeat` extends `expiresAt`. Release requires the owning `sessionId`.
- **Anti-spoof:** every lock op validates that the `sessionId` owns the lock.

---

## 8. Delta propagation + conflict detection

- `push_delta` → append to ClickHouse `context_deltas`, attach to the task's history, emit
  `delta_received` to peers, audit-log.
- **Conflict rule (rule-based first pass):** a `contract_change` delta referencing
  `affectedContracts[]` flags conflict against any OTHER active task whose `interfaceContracts`
  include those contract IDs. `severity:"blocking"` always flags. Flagged deltas set
  `requiresAction:true` in `get_deltas`.
- `ack_delta` → records acknowledgement in the delta's `acknowledgedBy`.

---

## 9. Debate logic

- `start_debate` → create active debate in LiveStore (initiator, responder, conflictingDeltaId,
  position/constraints/proposals); first message appended to ClickHouse `debate_messages`;
  emit `debate_update`.
- `respond_debate` → append message, increment round.
  - Round cap = `DEBATE_MAX_ROUNDS` (5; from TECH_SPEC §8 protocol — overrides the skill's "3").
    Exceeding the cap → status `escalated`.
  - `proposeResolution` + counterparty agreement → `resolved`, contract updated.
  - `escalateToHuman:true` → immediate `escalated`.
- Timeout escalation (no response in `DEBATE_TIMEOUT` = 10 min) handled by the sweeper.
- During debates, agents may call `peercode_web_search` (Nimble) to bring live web evidence.

---

## 10. Planning (real Anthropic + Nimble)

- `PUT /api/projects/:id/decompose` → PlanningService sends the TECH_SPEC §7 planning prompt
  (project description + team) to Anthropic and requests **structured JSON output** (phases →
  tasks with dependencies, required skills, interface contracts, merge points, and per-member
  questions). Parsed into LiveStore phases/tasks.
- Model: `claude-opus-4-7`.
- The planning call is given a **Nimble-backed `web_search` tool** so the architect can ground
  the plan in current facts (frameworks, APIs). This is one of the two sanctioned Nimble uses.
- Server-side only; `ANTHROPIC_API_KEY` from env. Wrapped in a Datadog `planning.decompose`
  workflow span containing the LLM span(s) and any Nimble retrieval spans.

---

## 11. GitHub sync coordination (sessions push; merge points are sync barriers)

The server NEVER pushes, NEVER creates PRs, NEVER touches `main`. Sessions do all git
(push/pull/conflict-resolution) on `peer-progress`. `SyncCoordinationService`:

- **Per-sync (`peercode_sync_github`):** a session about to push calls it → server grants a
  serialized **sync token** (one syncer at a time so pushes integrate cleanly) and returns the
  peer commit SHAs the session should `git pull` first. If another sync is in flight → returns
  `wait`. The session pulls, resolves conflicts locally, pushes, then reports its new SHA →
  server releases the token, logs to ClickHouse, broadcasts `sync_complete` so peers pull.
- **Merge point = phase-boundary sync barrier on peer-progress.** Reached when (1) all tasks in
  the phase are at `merge_point` status, and (2) every session assigned in the phase has pushed
  and pulled the integrated `peer-progress` HEAD (server tracks reported SHAs and confirms
  everyone is at the same HEAD). At the barrier, contracts **lock** and the server **unlocks the
  next phase**. No PR, no `main`.
- **GitHub credentials:** none required server-side for the core flow. Octokit is optional,
  read-only (verify `peer-progress` HEAD / list commits to confirm everyone is in sync) and may
  be omitted in the first build. The push credential lives only with each session.

---

## 12. Observability — Datadog LLM Observability

`dd-trace` initialized first in `index.ts`; `llmobs` enabled; ML app `peercode`.

- **Workflow spans:** `planning.decompose`, `debate.round`.
- **LLM spans:** every Anthropic call (model, token usage, prompt/response).
- **Tool/retrieval spans:** every Nimble web-search call.
- **Agent-action spans:** every MCP tool invocation, tagged `sessionId` + `projectId`, so each
  agent's actions are observable in real time.
- Env: `DD_API_KEY`, `DD_SITE`, `DD_LLMOBS_ENABLED=1`, `DD_LLMOBS_ML_APP=peercode`.
- Exact Node `llmobs` API to be confirmed against current Datadog docs via WebFetch during
  implementation (not context7).

---

## 13. Nimble web search

`NimbleClient` wraps the Nimble agent web-search API (`NIMBLE_API_KEY`). Exposed in exactly two
places, never general-purpose:
1. **Planning** — as a `web_search` tool on the Anthropic decomposition call.
2. **Debates** — as the `peercode_web_search` MCP tool; the skill file documents it as usable
   ONLY during debates and planning Q&A.

context7 is used nowhere.

---

## 14. Simple test UI

A single static page (`public/index.html` + vanilla JS, no build step) served by Express. Panels:
- Create project (description + team) → trigger decompose → render phases/tasks.
- Live event feed (WebSocket).
- Locks table with acquire/release buttons (simulating an agent session).
- Deltas + debates viewer.
- "Simulate MCP call" box to fire any of the 11 tools and view responses.

Lets the user exercise the whole server without standing up real Claude sessions.

---

## 15. Configuration

`config.ts` reads env with sensible defaults:
- `PORT` (default 3000)
- `ANTHROPIC_API_KEY` (required for planning)
- `NIMBLE_API_KEY` (required for web search)
- `DD_API_KEY`, `DD_SITE`, `DD_LLMOBS_ENABLED`, `DD_LLMOBS_ML_APP`
- `CLICKHOUSE_URL` (+ user/password/database)
- `GITHUB_TOKEN` (optional, read-only)
- Constants: `LOCK_TTL=30m`, `HEARTBEAT_INTERVAL=5m`, `DEBATE_MAX_ROUNDS=5`,
  `DEBATE_TIMEOUT=10m`, `SWEEPER_INTERVAL=30s`.

If a required external key is missing, the dependent endpoint returns a clear error; the server
still boots so the rest is testable.

---

## 16. Error handling

- Services throw typed errors: `LockConflictError`, `NotFoundError`, `ValidationError`,
  `ExternalServiceError`.
- Transport mapping: REST → HTTP status + JSON; MCP → structured `{ error }` result; WS → no-op.
- External calls (Anthropic / Nimble / ClickHouse / GitHub) are wrapped so a failure returns a
  clear message and never crashes the process.

---

## 17. Testing

- **Unit:** lock overlap/hierarchy, delta conflict detection, debate round/escalation, sync-token
  serialization, merge-point barrier readiness.
- **Integration smoke:** boot server, hit REST endpoints, drive a mock MCP client through
  lock → delta → debate → sync.
- Anthropic / Nimble / ClickHouse / GitHub mocked in tests (real at runtime).

---

## 18. File layout

```
src/
  config.ts
  index.ts                       bootstraps dd-trace, Express, WS, MCP; starts sweeper
  domain/types.ts
  storage/
    liveStore.ts                 interface
    inMemoryLiveStore.ts
    streamStore.ts               interface
    clickhouseStreamStore.ts     impl + schema bootstrap
  services/
    eventBus.ts  projectService.ts  taskService.ts  lockService.ts
    deltaService.ts  debateService.ts  planningService.ts
    syncCoordinationService.ts  presenceService.ts  sweeper.ts
    errors.ts
  integrations/
    anthropicClient.ts  nimbleClient.ts  githubClient.ts (optional read-only)
  observability/datadog.ts
  transports/
    rest/                        Express routers
    ws/                          WebSocket server
    mcp/                         MCP server + 11 tool definitions
public/                          static test UI (index.html + app.js)
test/                            unit + integration tests
skills/peercode.md               Claude skill file (TECH_SPEC §3, updated)
```

---

## 19. Out of scope (this build)

- Full Next.js dual-pane UI (roadmap tree + Kanban + graph).
- Durable live state (SQLite/Postgres) — interface is ready for it later.
- Multi-server scaling (Redis pub/sub for WS/locks).
- GitHub PR / main-merge automation (by design — sessions own git; merge points only sync peers).
