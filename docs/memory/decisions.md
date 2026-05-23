# Decisions

2026-05-23 - Server tech stack
Chose TypeScript + Node/Express over Python/FastAPI. One codebase shared with future Next.js UI, smoothest path for the official MCP TypeScript SDK, type sharing across REST/WS/MCP.

2026-05-23 - Hybrid storage (ClickHouse + in-memory)
Chose ClickHouse for append-only streams (context deltas, debate messages, WebSocket/sync events, audit trail) and an in-memory store behind an interface for mutable live coordination state (projects, tasks, locks, presence, active debate state). Reason: ClickHouse is OLAP — poor at frequent updates/deletes, no row locking or real transactions, so it is unsafe as the sole store for the concurrency-control core, but ideal for the append-heavy event log. Storage interfaces keep business logic decoupled so live state can later move to SQLite/Postgres.

2026-05-23 - Real external integrations from the start
Chose real Anthropic API (planning/decomposition) rather than stubs. Requires ANTHROPIC_API_KEY in env config.

2026-05-23 - GitHub pushes done by Claude sessions; merge points are sync barriers, NOT main merges
The actual git commit/push/pull/conflict-resolution to peer-progress is performed by each individual Claude Code session locally (it has the repo checked out). The server does NOT push, does NOT create PRs, and NEVER merges to main. The `peercode_sync_github` MCP tool is a sync-COORDINATION tool: serialize pushes via a sync token, record sync events, tell a session which peer commit SHAs to pull first, broadcast sync_complete. A MERGE POINT is a phase-boundary SYNC BARRIER on the peer-progress branch: every session pushes its work, resolves conflicts locally, and pulls the integrated HEAD so all sessions are in sync before the next phase unlocks. Contracts lock at the merge point. No PR, no main, no GitHub merge. Octokit is at most optional read-only (verify peer-progress HEAD / commit list to confirm everyone is in sync) and can be omitted in the first build. Reason: user directive — sessions own all git; merge points only synchronize peers on peer-progress.

2026-05-23 - Datadog observed via Lapdog LOCAL agent (not agentless cloud)
"LapDog" = Lapdog (DataDog/dd-apm-test-agent). It runs a LOCAL trace agent on :8126 (dashboard http://localhost:8126/leash/), needs NO Datadog account/API key for local use, and sets DD_TRACE_AGENT_URL when it wraps the process via `lapdog <run-command>`. So dd-trace must run in AGENT mode: DD_LLMOBS_AGENTLESS_ENABLED=0 (set in .env). No DD_API_KEY needed locally. **How to run + observe:** `brew install datadog/lapdog/lapdog` then `lapdog npm start`. dd-trace init verified (agent mode, no crash even when agent absent). Manual llmobs spans wrap planning workflow, LLM calls, MCP tool calls; Nimble retrieval spans dormant (Nimble dropped).

2026-05-23 - Nimble dropped for now; focus = Datadog + ClickHouse (+GitHub)
User said forget Nimble for now. NimbleClient code remains but inert (no creds); planning's web_search tool and the peercode_web_search MCP tool are only registered when Nimble is configured. Active integrations: Datadog/Lapdog + ClickHouse Cloud + read-only GitHub.

2026-05-23 - Distribute MCP+skill as a Claude Code plugin/marketplace
PeerCode is the orchestration tool, NOT the project teammates build — they never clone the server repo; they build any NEW project from scratch and PeerCode coordinates it. To "publish" the MCP + skill in one install step, created peercode-plugin/ (a marketplace repo): .claude-plugin/marketplace.json + plugin/ with .claude-plugin/plugin.json, .mcp.json (HTTP MCP server pointing at the tunnel URL), and skills/peercode/SKILL.md (project-agnostic, no Nimble web_search). Teammates: `/plugin marketplace add <owner>/<repo>` then `/plugin install peercode@peercode`. **Caveat:** the cloudflared quick-tunnel URL is EPHEMERAL (changes each restart). Current: https://compare-affect-contract-wma.trycloudflare.com. On restart, update plugin/.mcp.json + push + teammates run `/plugin marketplace update`. For stability use a cloudflared NAMED tunnel or a real deploy. Server confirmed reachable publicly via the tunnel (/health ok, /mcp initialize 200).

2026-05-23 - Server holds NO GitHub credentials (per-developer local git)
Removed GitHubClient, GITHUB_TOKEN/GITHUB_REPO server env, the read-only remoteStatus() + /sync/status endpoint, and the @octokit/rest dep. Reason: the server is shared deployable infra and must not embed any one person's PAT; each teammate's Claude session uses their own local git/GitHub config. The server coordinates pushes purely via the sync token + session-reported commit SHAs (peercode_sync_github) — it never talks to GitHub. Project.githubRepo remains as optional human-set metadata (a name string, not a credential).

2026-05-23 - ClickHouse Cloud + GitHub wired and verified live
ClickHouse Cloud (qzvrb3bh1v.us-west-2.aws.clickhouse.cloud:8443, user default) connected: schema auto-created, events written AND read back via /events round-trip. GitHub repo IbrahimF1/Datadog-Hackathon-26 (user is collaborator, classic PAT) reachable read-only (available:true; peer-progress branch not created yet). Secrets live ONLY in gitignored .env.

2026-05-23 - SECURITY: exposed secrets need rotation; .env.example is tracked
User pasted live Anthropic key, ClickHouse password, and GitHub PAT into chat, and the Anthropic key is also sitting in the git-TRACKED .env.example. **How to apply:** recommend rotating all three after the hackathon; .env.example must be sanitized back to placeholders before any commit (do NOT commit it with the real key). Real values belong only in gitignored .env. Never echo these values back in chat.

2026-05-23 - ClickHouse Cloud + flexible Nimble config
User will use ClickHouse Cloud (HTTPS endpoint :8443, default user + password in .env). Nimble endpoint/auth left flexible (user unsure which product) — NimbleClient supports Bearer (NIMBLE_API_KEY), Basic (NIMBLE_USERNAME/PASSWORD), or raw NIMBLE_AUTH_HEADER; default base URL = SERP api.webit.live. **How to apply:** if user later confirms the Nimble product, update NIMBLE_BASE_URL default + request shape. Keys go in user's .env (gitignored); never paste secrets in chat.

2026-05-23 - Nimble agent web search, NOT context7
Must use Nimble (agent web search API) to ground LLM reasoning with live web data, replacing context7's role. Do NOT use context7 anywhere. Nimble usage is scoped to ONLY two flows: (1) planning/decomposition, (2) debates. Implemented as a NimbleClient exposed as a tool to the Anthropic planning call and to the debate flow (and as an MCP tool whose skill docs restrict usage to debates/planning). Env: NIMBLE_API_KEY.

2026-05-23 - MCP transport over HTTP (streamable)
Chose HTTP streamable MCP transport over stdio so multiple remote Claude Code sessions connect to one central coordination server, matching the spec's central-server architecture.

2026-05-23 - UI is human observability only; agent mechanics are NOT UI controls
The UI exposes ONLY: project description input, team-members input, a live roadmap TREE, a Kanban board (planning + progress), and a READ-ONLY view of how the agents made decisions (their context deltas + debate negotiations + merge points). File locks, pushing deltas, starting/responding to debates, and git sync are LLM-facing MCP tools — the UI must NOT have interactive controls for them (no acquire-lock, push-delta, start-debate, advance-task, sync buttons). Reason: user directive — those are for the LLM agents; humans only watch planning/progress/decisions. Built as minimal vanilla-JS served by Express (no Next.js yet).
