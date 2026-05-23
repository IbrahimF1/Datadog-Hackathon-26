# Decisions

2026-05-23 - Server tech stack
Chose TypeScript + Node/Express over Python/FastAPI. One codebase shared with future Next.js UI, smoothest path for the official MCP TypeScript SDK, type sharing across REST/WS/MCP.

2026-05-23 - Hybrid storage (ClickHouse + in-memory)
Chose ClickHouse for append-only streams (context deltas, debate messages, WebSocket/sync events, audit trail) and an in-memory store behind an interface for mutable live coordination state (projects, tasks, locks, presence, active debate state). Reason: ClickHouse is OLAP — poor at frequent updates/deletes, no row locking or real transactions, so it is unsafe as the sole store for the concurrency-control core, but ideal for the append-heavy event log. Storage interfaces keep business logic decoupled so live state can later move to SQLite/Postgres.

2026-05-23 - Real external integrations from the start
Chose real Anthropic API (planning/decomposition) rather than stubs. Requires ANTHROPIC_API_KEY in env config.

2026-05-23 - GitHub pushes done by Claude sessions; merge points are sync barriers, NOT main merges
The actual git commit/push/pull/conflict-resolution to peer-progress is performed by each individual Claude Code session locally (it has the repo checked out). The server does NOT push, does NOT create PRs, and NEVER merges to main. The `peercode_sync_github` MCP tool is a sync-COORDINATION tool: serialize pushes via a sync token, record sync events, tell a session which peer commit SHAs to pull first, broadcast sync_complete. A MERGE POINT is a phase-boundary SYNC BARRIER on the peer-progress branch: every session pushes its work, resolves conflicts locally, and pulls the integrated HEAD so all sessions are in sync before the next phase unlocks. Contracts lock at the merge point. No PR, no main, no GitHub merge. Octokit is at most optional read-only (verify peer-progress HEAD / commit list to confirm everyone is in sync) and can be omitted in the first build. Reason: user directive — sessions own all git; merge points only synchronize peers on peer-progress.

2026-05-23 - Datadog LLM Observability is a hard requirement ("LapDog")
Must instrument the agent/server with Datadog LLM Observability (dd-trace Node SDK, llmobs). Trace: planning workflow, debate flow, every MCP tool call (agent actions), Anthropic calls, and Nimble web-search calls. Env: DD_API_KEY, DD_SITE, DD_LLMOBS_ENABLED, DD_LLMOBS_ML_APP=peercode. Goal: build the agent AND observe it.

2026-05-23 - ClickHouse Cloud + flexible Nimble config
User will use ClickHouse Cloud (HTTPS endpoint :8443, default user + password in .env). Nimble endpoint/auth left flexible (user unsure which product) — NimbleClient supports Bearer (NIMBLE_API_KEY), Basic (NIMBLE_USERNAME/PASSWORD), or raw NIMBLE_AUTH_HEADER; default base URL = SERP api.webit.live. **How to apply:** if user later confirms the Nimble product, update NIMBLE_BASE_URL default + request shape. Keys go in user's .env (gitignored); never paste secrets in chat.

2026-05-23 - Nimble agent web search, NOT context7
Must use Nimble (agent web search API) to ground LLM reasoning with live web data, replacing context7's role. Do NOT use context7 anywhere. Nimble usage is scoped to ONLY two flows: (1) planning/decomposition, (2) debates. Implemented as a NimbleClient exposed as a tool to the Anthropic planning call and to the debate flow (and as an MCP tool whose skill docs restrict usage to debates/planning). Env: NIMBLE_API_KEY.

2026-05-23 - MCP transport over HTTP (streamable)
Chose HTTP streamable MCP transport over stdio so multiple remote Claude Code sessions connect to one central coordination server, matching the spec's central-server architecture.

2026-05-23 - Test UI is a lightweight static dashboard
Building the test UI as a minimal vanilla-JS single page served by the Express server (no Next.js/build step yet) since the goal is just to exercise the server end-to-end. Full Next.js dual-pane UI is deferred.
